import { describe, expect, it } from 'vitest';
import { nextDifficulty, blockWork } from './consensus.js';
import {
  DIFFICULTY_WINDOW,
  EMERGENCY_DROP_MULT,
  GENESIS_DIFFICULTY_COMPACT,
  MAX_RETARGET_FACTOR_DOWN,
  MAX_RETARGET_FACTOR_UP,
  MTP_WINDOW,
  TARGET_BLOCK_TIME_S,
} from './genesis.js';
import type { BlockHeader } from './block.js';
import { compactToTarget, targetToCompact } from '../util/binary.js';

function fakeHeader(height: number, timestamp: number, difficulty: number): BlockHeader {
  return {
    height,
    prevHash: new Uint8Array(32),
    txRoot: new Uint8Array(32),
    stateRoot: new Uint8Array(32),
    timestamp,
    difficulty,
    nonce: 0,
    miner: new Uint8Array(32),
  };
}

const LOOKBACK = DIFFICULTY_WINDOW + MTP_WINDOW - 1;

describe('difficulty (per-block sliding window, MTP-derived, asymmetric clamp)', () => {
  it('keeps difficulty unchanged when blocks land exactly at target', () => {
    const headers: BlockHeader[] = [];
    for (let i = 0; i <= 100; i++) headers.push(fakeHeader(i, 1_000 + i * TARGET_BLOCK_TIME_S, GENESIS_DIFFICULTY_COMPACT));
    const candidateTs = headers[headers.length - 1]!.timestamp + TARGET_BLOCK_TIME_S;
    const next = nextDifficulty(101, headers, candidateTs);
    expect(next).toBe(GENESIS_DIFFICULTY_COMPACT);
  });

  it('makes difficulty harder (smaller target) when blocks are too fast', () => {
    const headers: BlockHeader[] = [];
    for (let i = 0; i < LOOKBACK; i++) {
      headers.push(fakeHeader(i, 1_000 + i * (TARGET_BLOCK_TIME_S / 2), GENESIS_DIFFICULTY_COMPACT));
    }
    const candidateTs = headers[headers.length - 1]!.timestamp + Math.floor(TARGET_BLOCK_TIME_S / 2);
    const next = nextDifficulty(LOOKBACK, headers, candidateTs);
    expect(compactToTarget(next)).toBeLessThan(compactToTarget(GENESIS_DIFFICULTY_COMPACT));
  });

  it('makes difficulty easier (larger target) when blocks are too slow', () => {
    const headers: BlockHeader[] = [];
    for (let i = 0; i < LOOKBACK; i++) {
      headers.push(fakeHeader(i, 1_000 + i * TARGET_BLOCK_TIME_S * 2, GENESIS_DIFFICULTY_COMPACT));
    }
    const candidateTs = headers[headers.length - 1]!.timestamp + TARGET_BLOCK_TIME_S * 2;
    const next = nextDifficulty(LOOKBACK, headers, candidateTs);
    expect(compactToTarget(next)).toBeGreaterThan(compactToTarget(GENESIS_DIFFICULTY_COMPACT));
  });

  it('asymmetric clamp: extreme-fast blocks clamp UP by at most MAX_RETARGET_FACTOR_UP', () => {
    const headers: BlockHeader[] = [];
    for (let i = 0; i < LOOKBACK; i++) {
      // ~100x faster than expected — should clamp to UP factor (e.g. 2x harder, target /= 2).
      headers.push(fakeHeader(i, 1_000 + i, GENESIS_DIFFICULTY_COMPACT));
    }
    const candidateTs = headers[headers.length - 1]!.timestamp + 1;
    const next = nextDifficulty(LOOKBACK, headers, candidateTs);
    const oldTarget = compactToTarget(GENESIS_DIFFICULTY_COMPACT);
    const newTarget = compactToTarget(next);
    // target must not have shrunk more than 1/MAX_RETARGET_FACTOR_UP.
    expect(newTarget * BigInt(MAX_RETARGET_FACTOR_UP)).toBeGreaterThanOrEqual(oldTarget - 1n);
  });

  it('asymmetric clamp: extreme-slow blocks clamp DOWN by at most MAX_RETARGET_FACTOR_DOWN', () => {
    const headers: BlockHeader[] = [];
    for (let i = 0; i < LOOKBACK; i++) {
      // 100x slower than expected — should clamp to DOWN factor (e.g. 4x easier, target *= 4).
      headers.push(fakeHeader(i, 1_000 + i * TARGET_BLOCK_TIME_S * 100, GENESIS_DIFFICULTY_COMPACT));
    }
    const candidateTs = headers[headers.length - 1]!.timestamp + TARGET_BLOCK_TIME_S;
    const next = nextDifficulty(LOOKBACK, headers, candidateTs);
    const oldTarget = compactToTarget(GENESIS_DIFFICULTY_COMPACT);
    const newTarget = compactToTarget(next);
    // target must not have grown more than MAX_RETARGET_FACTOR_DOWN.
    expect(newTarget).toBeLessThanOrEqual(oldTarget * BigInt(MAX_RETARGET_FACTOR_DOWN) + 1n);
    // and should be at or near the DOWN cap (well above old target).
    expect(newTarget).toBeGreaterThan(oldTarget);
  });

  it('asymmetric: rises slower than it falls (UP factor < DOWN factor)', () => {
    expect(MAX_RETARGET_FACTOR_UP).toBeLessThan(MAX_RETARGET_FACTOR_DOWN);
  });

  it('emergency drop fires when candidate timestamp is >EMERGENCY_DROP_MULT × target past parent', () => {
    const headers: BlockHeader[] = [];
    for (let i = 0; i < LOOKBACK; i++) headers.push(fakeHeader(i, 1_000 + i * TARGET_BLOCK_TIME_S, GENESIS_DIFFICULTY_COMPACT));
    const prevTs = headers[headers.length - 1]!.timestamp;
    // Candidate timestamp is way past — emergency drop should halve difficulty.
    const candidateTs = prevTs + (EMERGENCY_DROP_MULT + 1) * TARGET_BLOCK_TIME_S;
    const next = nextDifficulty(LOOKBACK, headers, candidateTs);
    const oldTarget = compactToTarget(GENESIS_DIFFICULTY_COMPACT);
    const newTarget = compactToTarget(next);
    // newTarget should be ~2× oldTarget (difficulty halved).
    expect(newTarget).toBeGreaterThan(oldTarget);
    expect(newTarget).toBeLessThanOrEqual(oldTarget * 2n + 1n);
  });

  it('first retarget does NOT make difficulty easier because of stale genesis timestamp', () => {
    const headers: BlockHeader[] = [];
    headers.push(fakeHeader(0, 1_700_000_000, GENESIS_DIFFICULTY_COMPACT)); // genesis
    const now = 1_779_000_000;
    for (let i = 1; i < DIFFICULTY_WINDOW; i++) {
      headers.push(fakeHeader(i, now + i, GENESIS_DIFFICULTY_COMPACT));
    }
    const candidateTs = now + DIFFICULTY_WINDOW;
    const next = nextDifficulty(DIFFICULTY_WINDOW, headers, candidateTs);
    // Blocks came every ~1 sec but target is 150 sec → must get HARDER.
    expect(compactToTarget(next)).toBeLessThan(compactToTarget(GENESIS_DIFFICULTY_COMPACT));
  });

  it('retargets every block, not only at boundaries', () => {
    const headers: BlockHeader[] = [];
    headers.push(fakeHeader(0, 1_700_000_000, GENESIS_DIFFICULTY_COMPACT));
    const start = 1_779_000_000;
    for (let i = 1; i <= 5; i++) headers.push(fakeHeader(i, start + i, GENESIS_DIFFICULTY_COMPACT));
    const candidateTs = start + 6;
    const next = nextDifficulty(6, headers, candidateTs);
    expect(compactToTarget(next)).toBeLessThan(compactToTarget(GENESIS_DIFFICULTY_COMPACT));
  });

  it('holds difficulty for the first two mined blocks (not enough data)', () => {
    const headers: BlockHeader[] = [
      fakeHeader(0, 1_700_000_000, GENESIS_DIFFICULTY_COMPACT),
      fakeHeader(1, 1_779_000_000, GENESIS_DIFFICULTY_COMPACT),
    ];
    const next = nextDifficulty(2, headers, 1_779_000_001);
    expect(next).toBe(GENESIS_DIFFICULTY_COMPACT);
  });

  it('block work goes up as target shrinks', () => {
    const easy = blockWork(GENESIS_DIFFICULTY_COMPACT);
    const hardCompact = targetToCompact(compactToTarget(GENESIS_DIFFICULTY_COMPACT) / 4n);
    const hard = blockWork(hardCompact);
    expect(hard).toBeGreaterThan(easy);
  });

  it('MTP smooths a single-timestamp lie — one bad timestamp barely moves retarget', () => {
    // Two identical chains except for one outlier timestamp in the middle.
    // Because retargeting uses MTP-derived spans, a single lying header
    // shouldn't visibly move difficulty.
    const cleanHeaders: BlockHeader[] = [];
    for (let i = 0; i < LOOKBACK; i++) cleanHeaders.push(fakeHeader(i, 1_000 + i * TARGET_BLOCK_TIME_S, GENESIS_DIFFICULTY_COMPACT));

    const cheatedHeaders = cleanHeaders.map((h) => ({ ...h }));
    // Push one middle timestamp far into the future. Without MTP, this would
    // shrink the apparent span; with MTP-of-11 it stays a non-median outlier.
    const midIdx = Math.floor(cheatedHeaders.length / 2);
    cheatedHeaders[midIdx]!.timestamp += TARGET_BLOCK_TIME_S * 100;

    const ts = cleanHeaders[cleanHeaders.length - 1]!.timestamp + TARGET_BLOCK_TIME_S;
    const clean = nextDifficulty(LOOKBACK, cleanHeaders, ts);
    const cheated = nextDifficulty(LOOKBACK, cheatedHeaders, ts);
    expect(cheated).toBe(clean);
  });
});
