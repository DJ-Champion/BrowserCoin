import os from 'node:os';
import path from 'node:path';
import type { LogLevel, MinerCommand, MinerConfig, WorkerCountOption } from './types.js';

const DEFAULT_API = 'http://localhost:9000';
const DEFAULT_STATS_INTERVAL_SEC = 5;
const DEFAULT_RESYNC_INTERVAL_SEC = 5;
const DEFAULT_BENCHMARK_DURATION_SEC = 30;
const DEFAULT_BENCHMARK_WARMUP_SEC = 5;

export function defaultWorkerCount(): number {
  return Math.max(1, os.availableParallelism?.() ?? os.cpus().length ?? 1);
}

export function parseMinerConfig(argv: string[]): MinerConfig {
  const args = [...argv];
  const command = parseCommand(args.shift());
  const config: MinerConfig = {
    command,
    apiUrl: DEFAULT_API,
    walletPath: path.resolve('miner-wallet.json'),
    workers: 'auto',
    statsIntervalSec: DEFAULT_STATS_INTERVAL_SEC,
    resyncIntervalSec: DEFAULT_RESYNC_INTERVAL_SEC,
    once: false,
    includeTxs: false,
    logLevel: 'info',
    durationSec: DEFAULT_BENCHMARK_DURATION_SEC,
    warmupSec: DEFAULT_BENCHMARK_WARMUP_SEC,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    switch (arg) {
      case '--api':
        config.apiUrl = requireValue(args, ++i, arg);
        break;
      case '--wallet':
        config.walletPath = path.resolve(requireValue(args, ++i, arg));
        break;
      case '--workers':
        config.workers = parseWorkers(requireValue(args, ++i, arg));
        break;
      case '--stats-interval':
        config.statsIntervalSec = parsePositiveNumber(requireValue(args, ++i, arg), arg);
        break;
      case '--resync-interval':
        config.resyncIntervalSec = parsePositiveNumber(requireValue(args, ++i, arg), arg);
        break;
      case '--duration':
        config.durationSec = parsePositiveNumber(requireValue(args, ++i, arg), arg);
        break;
      case '--warmup':
        config.warmupSec = parseNonNegativeNumber(requireValue(args, ++i, arg), arg);
        break;
      case '--once':
        config.once = true;
        break;
      case '--txs':
        config.includeTxs = true;
        break;
      case '--no-txs':
        config.includeTxs = false;
        break;
      case '--log-level':
        config.logLevel = parseLogLevel(requireValue(args, ++i, arg));
        break;
      case '--backend': {
        const backend = requireValue(args, ++i, arg);
        if (backend !== 'wasm') throw new Error('only --backend wasm is supported in v1');
        break;
      }
      case '--help':
      case '-h':
        throw new Error(usage());
      default:
        throw new Error(`unknown option: ${arg}\n\n${usage()}`);
    }
  }

  return config;
}

export function resolvedWorkerCount(workers: WorkerCountOption): number {
  return workers === 'auto' ? defaultWorkerCount() : workers;
}

export function usage(): string {
  return [
    'Usage:',
    '  npm run miner -- benchmark [--workers <n|auto>] [--duration <sec>]',
    '  npm run miner -- mine [--api <url>] [--wallet <path>] [--workers <n|auto>] [--once]',
    '',
    'Options:',
    '  --api <url>              Helper API URL (default: http://localhost:9000)',
    '  --wallet <path>          Wallet JSON path (default: ./miner-wallet.json)',
    '  --workers <n|auto>       Worker threads (default: auto)',
    '  --stats-interval <sec>   Stats print interval (default: 5)',
    '  --resync-interval <sec>  Tip polling interval (default: 5)',
    '  --duration <sec>         Benchmark duration (default: 30)',
    '  --warmup <sec>           Benchmark warm-up before measuring (default: 5)',
    '  --once                   Mine one accepted block then exit',
    '  --txs                    Include mineable helper mempool transactions',
    '  --no-txs                 Mine reward-only blocks (default)',
    '  --log-level <level>      info, debug, or quiet',
  ].join('\n');
}

function parseCommand(value: string | undefined): MinerCommand {
  if (value === 'benchmark' || value === 'mine') return value;
  throw new Error(`missing or invalid command\n\n${usage()}`);
}

function parseWorkers(value: string): WorkerCountOption {
  if (value === 'auto') return 'auto';
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error('--workers must be a positive integer or auto');
  return n;
}

function parsePositiveNumber(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} must be a positive number`);
  return n;
}

function parseNonNegativeNumber(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${flag} must be a non-negative number`);
  return n;
}

function parseLogLevel(value: string): LogLevel {
  if (value === 'info' || value === 'debug' || value === 'quiet') return value;
  throw new Error('--log-level must be info, debug, or quiet');
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}
