import { Worker } from 'node:worker_threads';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { encodeBlock, type Block } from '../chain/block.js';
import { Mempool } from '../chain/mempool.js';
import { decodeTx, type Transaction } from '../chain/transaction.js';
import { MAX_BLOCK_BYTES } from '../chain/genesis.js';
import { bytesToHex, hexToBytes } from '../util/binary.js';
import type { KeyPair } from '../crypto/keys.js';
import { resolvedWorkerCount } from './config.js';
import { HelperClient } from './helperClient.js';
import { ChainSync } from './sync.js';
import { buildRewardOnlyTemplate } from './template.js';
import type { MinerConfig, MinerStats, RewardOnlyTemplate, WorkerIn, WorkerOut } from './types.js';

interface ManagedWorker {
  worker: Worker;
  id: number;
}

type RustOut =
  | { type: 'stats'; hashes: number; elapsedMs: number; hashesPerSecond: number }
  | { type: 'solved'; nonce: number; hash: string; header: string }
  | { type: 'exhausted' };

export class ExternalMinerController {
  private client: HelperClient;
  private sync: ChainSync;
  private workers: ManagedWorker[] = [];
  private rustProcess: ChildProcessWithoutNullStreams | null = null;
  private rustLineBuffer = '';
  private generation = 0;
  private running = false;
  private template: RewardOnlyTemplate | null = null;
  private lastTipHash = '';
  private lastStatsAt = performance.now();
  private hashWindow = 0;
  private stats: MinerStats = {
    totalHashes: 0,
    hashesPerSecond: 0,
    accepted: 0,
    rejected: 0,
    stale: 0,
    candidateHeight: 0,
  };

  constructor(private config: MinerConfig, private wallet: KeyPair) {
    this.client = new HelperClient(config.apiUrl);
    this.sync = new ChainSync(this.client);
  }

  async mine(): Promise<void> {
    this.running = true;
    this.installSignalHandlers();
    await this.sync.syncToHelper();
    this.lastTipHash = bytesToHex(this.sync.chain.tip.hash);
    this.spawnWorkers();
    await this.startTemplate();

    while (this.running) {
      await delay(this.config.resyncIntervalSec * 1000);
      await this.pollTip();
    }

    this.stopWorkers();
  }

  async benchmark(): Promise<void> {
    this.running = true;
    this.spawnWorkers();
    const template = {
      ...buildRewardOnlyTemplate(this.sync.chain, this.wallet.publicKey),
      targetHex: '0'.repeat(64),
    };
    this.template = template;
    this.stats.candidateHeight = template.block.header.height;
    this.startWorkers(template, 1000);
    if (this.config.warmupSec > 0) {
      this.log('info', `warming up for ${this.config.warmupSec}s`);
      await delay(this.config.warmupSec * 1000);
      this.resetHashStats();
    }
    await delay(this.config.durationSec * 1000);
    this.running = false;
    this.printStats(true);
    this.stopWorkers();
  }

  private spawnWorkers(): void {
    this.stopWorkers();
    if (this.config.backend === 'rust') return;
    const count = resolvedWorkerCount(this.config.workers);
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), {
        execArgv: ['--import', 'tsx'],
      });
      worker.on('message', (msg: WorkerOut) => void this.onWorkerMessage(msg));
      worker.on('error', (err) => {
        this.log('info', `worker ${i} error: ${err.message}`);
        this.stats.rejected++;
        void this.restartTemplate();
      });
      this.workers.push({ worker, id: i });
    }
  }

  private stopWorkers(): void {
    this.generation++;
    if (this.rustProcess) {
      this.rustProcess.kill();
      this.rustProcess = null;
      this.rustLineBuffer = '';
    }
    for (const entry of this.workers) {
      entry.worker.postMessage({ type: 'stop', generation: this.generation } satisfies WorkerIn);
      entry.worker.terminate();
    }
    this.workers = [];
  }

  private async startTemplate(): Promise<void> {
    const txs = await this.fetchMineableTxs();
    this.template = buildRewardOnlyTemplate(this.sync.chain, this.wallet.publicKey, Math.floor(Date.now() / 1000), txs);
    this.stats.candidateHeight = this.template.block.header.height;
    this.startWorkers(this.template);
  }

  private startWorkers(template: RewardOnlyTemplate, reportEveryMs = Math.max(1000, this.config.statsIntervalSec * 1000)): void {
    this.generation++;
    const generation = this.generation;
    const count = this.workerCountForDisplay();
    if (this.config.backend === 'rust') {
      this.startRust(template, generation, reportEveryMs);
      this.log('info', `mining height=${template.block.header.height} workers=${count} backend=rust difficulty=${template.block.header.difficulty.toString(16)}`);
      return;
    }
    for (const entry of this.workers) {
      entry.worker.postMessage({
        type: 'start',
        generation,
        headerBytes: template.headerBytes,
        targetHex: template.targetHex,
        startNonce: entry.id,
        stride: count,
        reportEveryMs,
      } satisfies WorkerIn);
    }
    this.log('info', `mining height=${template.block.header.height} workers=${count} backend=wasm difficulty=${template.block.header.difficulty.toString(16)}`);
  }

  private async restartTemplate(): Promise<void> {
    if (!this.running) return;
    this.generation++;
    if (this.rustProcess) {
      this.rustProcess.kill();
      this.rustProcess = null;
      this.rustLineBuffer = '';
    }
    for (const entry of this.workers) {
      entry.worker.postMessage({ type: 'stop', generation: this.generation } satisfies WorkerIn);
    }
    await this.sync.syncToHelper();
    this.lastTipHash = bytesToHex(this.sync.chain.tip.hash);
    await this.startTemplate();
  }

  private startRust(template: RewardOnlyTemplate, generation: number, reportEveryMs: number): void {
    if (this.rustProcess) this.rustProcess.kill();
    this.rustLineBuffer = '';
    const headerHex = bytesToHex(template.headerBytes);
    const statsInterval = Math.max(0.001, reportEveryMs / 1000);
    const coreArgs = [
      'mine',
      '--header',
      headerHex,
      '--target',
      template.targetHex,
      '--workers',
      String(resolvedWorkerCount(this.config.workers)),
      '--stats-interval',
      String(statsInterval),
    ];
    const child = this.spawnRustCore(coreArgs);
    this.rustProcess = child;
    child.stdout.on('data', (chunk: Buffer) => this.onRustStdout(generation, chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) this.log('debug', `[rust] ${text}`);
    });
    child.on('error', (err) => {
      if (generation !== this.generation) return;
      this.log('info', `rust backend error: ${err.message}`);
      this.stats.rejected++;
      void this.restartTemplate();
    });
    child.on('exit', (code) => {
      if (generation !== this.generation || !this.running) return;
      if (code !== 0) {
        this.log('info', `rust backend exited ${code}`);
        this.stats.rejected++;
        void this.restartTemplate();
      }
    });
  }

  private spawnRustCore(args: string[]): ChildProcessWithoutNullStreams {
    if (this.config.rustCorePath) {
      const child = spawn(this.config.rustCorePath, args, { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
      child.stdin.end();
      return child;
    }
    const child = spawn('cargo', ['run', '--manifest-path', 'rust-core/Cargo.toml', '--quiet', '--', ...args], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.end();
    return child;
  }

  private onRustStdout(generation: number, text: string): void {
    this.rustLineBuffer += text;
    let nl = this.rustLineBuffer.indexOf('\n');
    while (nl >= 0) {
      const line = this.rustLineBuffer.slice(0, nl).trim();
      this.rustLineBuffer = this.rustLineBuffer.slice(nl + 1);
      if (line) void this.onRustLine(generation, line);
      nl = this.rustLineBuffer.indexOf('\n');
    }
  }

  private async onRustLine(generation: number, line: string): Promise<void> {
    if (generation !== this.generation) return;
    let msg: RustOut;
    try {
      msg = JSON.parse(line) as RustOut;
    } catch {
      this.log('debug', `[rust] ${line}`);
      return;
    }
    if (msg.type === 'stats') {
      this.stats.totalHashes += msg.hashes;
      this.hashWindow += msg.hashes;
      this.maybePrintStats();
      return;
    }
    if (msg.type === 'exhausted') {
      this.stats.stale++;
      await this.restartTemplate();
      return;
    }
    if (msg.type === 'solved') {
      await this.submitSolution(msg.nonce);
    }
  }

  private async fetchMineableTxs(): Promise<Transaction[]> {
    if (!this.config.includeTxs) return [];
    const pool = new Mempool();
    let decoded = 0;
    let admitted = 0;
    try {
      const txHexes = await this.client.getMempool();
      for (const hex of txHexes) {
        decoded++;
        try {
          const tx = decodeTx(hexToBytes(hex)).tx;
          const err = pool.add(tx, this.sync.chain.tipState);
          if (!err) admitted++;
          else this.log('debug', `mempool tx skipped: ${err}`);
        } catch (err) {
          this.log('debug', `mempool tx decode failed: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.log('info', `mempool fetch failed; mining reward-only: ${(err as Error).message}`);
      return [];
    }
    const budget = MAX_BLOCK_BYTES - 1024;
    const picked = pool.selectForBlock(this.sync.chain.tipState, budget);
    this.log('debug', `mempool decoded=${decoded} admitted=${admitted} selected=${picked.length}`);
    return picked;
  }

  private async onWorkerMessage(msg: WorkerOut): Promise<void> {
    if (msg.generation !== this.generation) return;
    if (msg.type === 'hashrate') {
      this.stats.totalHashes += msg.hashes;
      this.hashWindow += msg.hashes;
      this.maybePrintStats();
      return;
    }
    if (msg.type === 'error') {
      this.log('info', `worker error: ${msg.error}`);
      this.stats.rejected++;
      await this.restartTemplate();
      return;
    }
    if (msg.type === 'exhausted') {
      this.stats.stale++;
      await this.restartTemplate();
      return;
    }
    if (msg.type === 'solved') {
      await this.submitSolution(msg.nonce);
    }
  }

  private async submitSolution(nonce: number): Promise<void> {
    const template = this.template;
    if (!template || !this.running) return;
    this.generation++;
    if (this.rustProcess) {
      this.rustProcess.kill();
      this.rustProcess = null;
      this.rustLineBuffer = '';
    }
    for (const entry of this.workers) {
      entry.worker.postMessage({ type: 'stop', generation: this.generation } satisfies WorkerIn);
    }

    const solved: Block = {
      header: { ...template.block.header, nonce },
      transactions: template.block.transactions,
    };
    const blockHex = bytesToHex(encodeBlock(solved));
    try {
      const res = await this.client.submitBlock(blockHex);
      if (res.status === 'added') {
        this.stats.accepted++;
        this.log('info', `accepted height=${solved.header.height} nonce=${nonce}`);
        if (this.config.once) {
          this.running = false;
          this.stopWorkers();
          return;
        }
      } else if (res.status === 'orphan') {
        this.stats.stale++;
        this.log('info', `orphan height=${solved.header.height} parentNeeded=${res.parentNeeded ?? '<unknown>'}`);
      } else {
        this.stats.rejected++;
        this.log('info', `rejected height=${solved.header.height}: ${res.error ?? '<unknown>'}`);
      }
    } catch (err) {
      this.stats.rejected++;
      this.log('info', `submit failed: ${(err as Error).message}`);
    }
    await this.restartTemplate();
  }

  private async pollTip(): Promise<void> {
    if (!this.running) return;
    try {
      const tip = await this.client.getTip();
      if (tip.tipHash !== this.lastTipHash) {
        this.stats.stale++;
        this.log('debug', `tip changed ${this.lastTipHash.slice(0, 16)} -> ${tip.tipHash.slice(0, 16)}`);
        await this.restartTemplate();
      }
    } catch (err) {
      this.log('info', `tip poll failed: ${(err as Error).message}`);
    }
  }

  private maybePrintStats(): void {
    const now = performance.now();
    const elapsed = now - this.lastStatsAt;
    if (elapsed < this.config.statsIntervalSec * 1000) return;
    this.stats.hashesPerSecond = this.hashWindow / (elapsed / 1000);
    this.hashWindow = 0;
    this.lastStatsAt = now;
    this.printStats(false);
  }

  private printStats(final: boolean): void {
    if (this.config.logLevel === 'quiet') return;
    if (final) this.updateHashrate();
      const prefix = final ? 'final' : 'stats';
    console.log(
      `${prefix} height=${this.stats.candidateHeight} workers=${this.workerCountForDisplay()} ` +
        `backend=${this.config.backend} ` +
        `hashrate=${this.stats.hashesPerSecond.toFixed(2)}H/s total=${this.stats.totalHashes} ` +
        `accepted=${this.stats.accepted} rejected=${this.stats.rejected} stale=${this.stats.stale}`,
    );
  }

  private workerCountForDisplay(): number {
    return this.config.backend === 'rust' ? resolvedWorkerCount(this.config.workers) : this.workers.length;
  }

  private resetHashStats(): void {
    this.stats.totalHashes = 0;
    this.stats.hashesPerSecond = 0;
    this.hashWindow = 0;
    this.lastStatsAt = performance.now();
  }

  private updateHashrate(): void {
    const now = performance.now();
    const elapsed = now - this.lastStatsAt;
    if (elapsed <= 0) return;
    this.stats.hashesPerSecond = this.hashWindow / (elapsed / 1000);
  }

  private installSignalHandlers(): void {
    const stop = (): void => {
      this.running = false;
      this.stopWorkers();
      this.printStats(true);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }

  private log(level: 'info' | 'debug', message: string): void {
    if (this.config.logLevel === 'quiet') return;
    if (level === 'debug' && this.config.logLevel !== 'debug') return;
    console.log(message);
  }
}
