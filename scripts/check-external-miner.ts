import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const port = Number(process.env.BROWSERCOIN_MINER_CHECK_PORT ?? 19_090);
const api = `http://localhost:${port}`;
const root = process.cwd();
const walletPath = path.join(root, `.miner-check-wallet-${port}.json`);
const chainPath = path.join(root, 'server', `chain-${port}.json`);
const backupPath = path.join(root, 'server', `backups-${port}`);

async function main(): Promise<void> {
  await assertPathAbsent(chainPath);
  await assertPathAbsent(backupPath);
  await assertPathAbsent(walletPath);

  const server = spawnNode(['--import', 'tsx', 'server/api.ts', '--port', String(port)]);
  let serverLog = '';
  server.stdout.on('data', (chunk: Buffer) => { serverLog += chunk.toString(); });
  server.stderr.on('data', (chunk: Buffer) => { serverLog += chunk.toString(); });

  try {
    await waitForTip();
    const miner = spawnNode([
      '--import',
      'tsx',
      'src/cli/miner.ts',
      'mine',
      '--once',
      '--api',
      api,
      '--workers',
      '1',
      '--wallet',
      walletPath,
      '--stats-interval',
      '1',
    ]);
    const minerOutput = await collect(miner, 120_000);
    if (!minerOutput.includes('accepted height=')) {
      throw new Error(`miner did not accept a block:\n${minerOutput}`);
    }
    console.log(minerOutput.trim());
    console.log(`external miner live check passed on ${api}`);
  } finally {
    server.kill();
    await delay(500);
    await cleanup();
    if (server.exitCode !== null && server.exitCode !== 0 && serverLog) {
      console.error(serverLog.trim());
    }
  }
}

function spawnNode(args: string[]): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
}

async function waitForTip(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${api}/tip`);
      if (res.ok) return;
    } catch {
      // Server is still starting.
    }
    await delay(250);
  }
  throw new Error(`helper did not start at ${api}`);
}

async function collect(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<string> {
  let out = '';
  child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
  child.stderr.on('data', (chunk: Buffer) => { out += chunk.toString(); });

  const code = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`process timed out after ${timeoutMs}ms:\n${out}`));
    }, timeoutMs);
    child.on('exit', (exitCode) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
    child.on('error', reject);
  });
  if (code !== 0) throw new Error(`process exited ${code}:\n${out}`);
  return out;
}

async function assertPathAbsent(p: string): Promise<void> {
  try {
    await fs.stat(p);
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return;
    throw err;
  }
  throw new Error(`${p} already exists; refusing to clobber integration-check artifacts`);
}

async function cleanup(): Promise<void> {
  await fs.rm(walletPath, { force: true });
  await fs.rm(chainPath, { force: true });
  await fs.rm(backupPath, { recursive: true, force: true });
}

void main().catch((err) => {
  console.error((err as Error).stack ?? (err as Error).message);
  process.exitCode = 1;
});
