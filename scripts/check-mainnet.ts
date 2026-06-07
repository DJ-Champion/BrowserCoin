import { computeTxRoot, decodeBlock, hashHeader, type Block } from '../src/chain/block.js';
import { checkPoW } from '../src/chain/consensus.js';
import { bytesToHex, compareBytes, hexToBytes } from '../src/util/binary.js';

const DEFAULT_APIS = ['https://api1.browsercoin.org', 'https://api2.browsercoin.org'];

interface Options {
  apis: string[];
  window: number;
  skipPow: boolean;
}

interface Tip {
  height: number;
  tipHash: string;
}

interface Stats {
  serverHeight?: number;
  serverTip?: string;
  latestHeight?: number;
  minersActive?: number;
  peerCount?: number;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`apis=${opts.apis.join(', ')} window=${opts.window} pow=${opts.skipPow ? 'skipped' : 'on'}`);

  const reports = [];
  for (const api of opts.apis) {
    reports.push(await checkApi(api, opts));
  }

  const ok = reports.filter((r) => r.ok).length;
  if (ok === 0) throw new Error('no API helper passed the read-only mainnet check');

  const tips = reports
    .filter((r) => r.ok)
    .map((r) => `${r.api}@${r.height}:${r.tipHash.slice(0, 16)}`);
  console.log(`mainnet check passed (${ok}/${reports.length} helpers): ${tips.join(' | ')}`);
}

async function checkApi(api: string, opts: Options): Promise<{ api: string; ok: boolean; height: number; tipHash: string }> {
  try {
    const tip = await getJson<Tip>(api, '/tip');
    if (!Number.isInteger(tip.height) || tip.height < 0) throw new Error('bad /tip height');
    if (!/^[0-9a-f]{64}$/i.test(tip.tipHash)) throw new Error('bad /tip tipHash');

    const stats = await tryGetStats(api);
    if (stats) {
      console.log(
        `${api} stats height=${stats.serverHeight ?? '?'} latest=${stats.latestHeight ?? '?'} ` +
          `peers=${stats.peerCount ?? '?'} miners=${stats.minersActive ?? '?'}`,
      );
    }

    const fromHeight = Math.max(0, tip.height - opts.window + 1);
    const blockHexes = await getBlocks(api, fromHeight, opts.window);
    if (blockHexes.length === 0) throw new Error('no blocks returned');

    const blocks = blockHexes.map((hex) => decodeBlock(hexToBytes(hex)));
    await verifyWindow(blocks, tip, opts);

    const mempool = await tryGetMempool(api);
    if (mempool) console.log(`${api} mempool=${mempool.length}`);

    console.log(`${api} ok height=${tip.height} tip=${tip.tipHash.slice(0, 16)} verifiedBlocks=${blocks.length}`);
    return { api, ok: true, height: tip.height, tipHash: tip.tipHash };
  } catch (err) {
    console.error(`${api} failed: ${(err as Error).message}`);
    return { api, ok: false, height: -1, tipHash: '' };
  }
}

async function verifyWindow(blocks: Block[], tip: Tip, opts: Options): Promise<void> {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (i > 0) {
      const prev = blocks[i - 1]!;
      if (block.header.height !== prev.header.height + 1) throw new Error('non-contiguous block heights');
      const prevHash = hashHeader(prev.header);
      if (compareBytes(prevHash, block.header.prevHash) !== 0) {
        throw new Error(`prevHash mismatch at height ${block.header.height}`);
      }
    }

    const expectedTxRoot = computeTxRoot(block.transactions);
    if (compareBytes(expectedTxRoot, block.header.txRoot) !== 0) {
      throw new Error(`txRoot mismatch at height ${block.header.height}`);
    }
    if (!opts.skipPow && !(await checkPoW(block.header))) {
      throw new Error(`PoW invalid at height ${block.header.height}`);
    }
  }

  const last = blocks[blocks.length - 1]!;
  if (last.header.height !== tip.height) {
    throw new Error(`latest returned height ${last.header.height} does not match /tip ${tip.height}`);
  }
  const lastHash = bytesToHex(hashHeader(last.header));
  if (lastHash !== tip.tipHash) {
    throw new Error(`latest returned hash ${lastHash} does not match /tip ${tip.tipHash}`);
  }
}

async function getBlocks(api: string, fromHeight: number, max: number): Promise<string[]> {
  const res = await getJson<{ blocks?: string[] }>(api, `/blocks?fromHeight=${fromHeight}&max=${max}`);
  if (!Array.isArray(res.blocks)) throw new Error('/blocks response missing blocks array');
  return res.blocks;
}

async function tryGetStats(api: string): Promise<Stats | null> {
  try {
    return await getJson<Stats>(api, '/stats');
  } catch {
    return null;
  }
}

async function tryGetMempool(api: string): Promise<string[] | null> {
  try {
    const res = await getJson<{ txs?: string[] }>(api, '/mempool');
    return Array.isArray(res.txs) ? res.txs : null;
  } catch {
    return null;
  }
}

async function getJson<T>(api: string, path: string): Promise<T> {
  const res = await fetch(new URL(path, api).toString());
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}: ${await res.text()}`);
  return await res.json() as T;
}

function parseArgs(args: string[]): Options {
  const opts: Options = { apis: [], window: 10, skipPow: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    switch (arg) {
      case '--api':
        opts.apis.push(requireValue(args, ++i, arg));
        break;
      case '--window':
        opts.window = parsePositiveInt(requireValue(args, ++i, arg), arg);
        break;
      case '--skip-pow':
        opts.skipPow = true;
        break;
      case '--help':
      case '-h':
        throw new Error(usage());
      default:
        throw new Error(`unknown option: ${arg}\n\n${usage()}`);
    }
  }
  if (opts.apis.length === 0) opts.apis = DEFAULT_APIS;
  return opts;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function parsePositiveInt(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a positive integer`);
  return n;
}

function usage(): string {
  return [
    'Usage:',
    '  npm run miner:mainnet-check -- [--api <url>] [--window <blocks>] [--skip-pow]',
    '',
    'Defaults to api1/api2.browsercoin.org and verifies the latest 10 blocks read-only.',
  ].join('\n');
}

void main().catch((err) => {
  const message = (err as Error).message;
  console.error(message);
  process.exitCode = message.startsWith('Usage:') ? 0 : 1;
});
