import type { Block } from '../chain/block.js';

export type MinerCommand = 'benchmark' | 'mine';
export type LogLevel = 'info' | 'debug' | 'quiet';
export type WorkerCountOption = number | 'auto';

export interface MinerConfig {
  command: MinerCommand;
  apiUrl: string;
  walletPath: string;
  workers: WorkerCountOption;
  statsIntervalSec: number;
  resyncIntervalSec: number;
  once: boolean;
  includeTxs: boolean;
  logLevel: LogLevel;
  durationSec: number;
  warmupSec: number;
}

export interface WalletFile {
  version: 1;
  publicKey: string;
  privateKey: string;
  createdAt: string;
}

export type BlockSubmitResponse =
  | { status: 'added' }
  | { status: 'orphan'; parentNeeded?: string }
  | { status: 'invalid'; error?: string };

export interface TipResponse {
  height: number;
  tipHash: string;
}

export interface BlocksResponse {
  blocks: string[];
}

export interface RewardOnlyTemplate {
  block: Block;
  headerBytes: Uint8Array;
  targetHex: string;
}

export interface MinerStats {
  totalHashes: number;
  hashesPerSecond: number;
  accepted: number;
  rejected: number;
  stale: number;
  candidateHeight: number;
}

export type WorkerIn =
  | {
      type: 'start';
      generation: number;
      headerBytes: Uint8Array;
      targetHex: string;
      startNonce: number;
      stride: number;
      reportEveryMs: number;
    }
  | { type: 'stop'; generation?: number };

export type WorkerOut =
  | { type: 'hashrate'; generation: number; hashes: number; elapsedMs: number }
  | { type: 'solved'; generation: number; nonce: number; hash: Uint8Array }
  | { type: 'exhausted'; generation: number }
  | { type: 'error'; generation: number; error: string };
