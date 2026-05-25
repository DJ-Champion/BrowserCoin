/**
 * Test utility: mine a block at low difficulty against a chain tip.
 * Lives outside the test files so multiple test suites can reuse it.
 *
 * Default-timestamp strategy: block 1's timestamp anchors well in the past
 * (now − TS_PAST_OFFSET_BLOCKS × target) and each subsequent block adds one
 * target interval. This keeps the per-block retarget seeing blocks-at-target
 * (difficulty stays near genesis) AND keeps every block's timestamp in the
 * past relative to wall clock — required because MAX_FUTURE_TIME_S only
 * grants ~10 minutes of future-timestamp tolerance, so any naive "now + i ×
 * target" scheme runs out after a handful of blocks.
 */
import { hashHeader, computeTxRoot, type Block, type BlockHeader } from './block.js';
import { checkPoW, nextDifficulty } from './consensus.js';
import { DIFFICULTY_WINDOW, MTP_WINDOW, TARGET_BLOCK_TIME_S } from './genesis.js';
import { applyBlockTxs, cloneState, stateRoot, type State } from './state.js';
import type { Transaction } from './transaction.js';
import type { Blockchain } from './blockchain.js';

/**
 * How many block-times to backdate block 1 by. Caps the test chain length we
 * can synthesize without timestamps drifting past `now + MAX_FUTURE_TIME_S`.
 * 200 × 150s = 8h of headroom; plenty for any single test.
 */
const TS_PAST_OFFSET_BLOCKS = 200;

export async function buildBlock(
  chain: Blockchain,
  miner: Uint8Array,
  txs: Transaction[],
  timestampOverride?: number,
): Promise<Block> {
  const parent = chain.tip.block.header;
  const height = parent.height + 1;

  // Block 1: anchor in the past so subsequent +TARGET_BLOCK_TIME_S steps
  // don't run past MAX_FUTURE_TIME_S. Later blocks: parent + one target
  // interval so the retarget sees a perfectly-paced chain.
  const defaultTimestamp = parent.height === 0
    ? Math.floor(Date.now() / 1000) - TS_PAST_OFFSET_BLOCKS * TARGET_BLOCK_TIME_S
    : parent.timestamp + TARGET_BLOCK_TIME_S;
  const timestamp = timestampOverride ?? defaultTimestamp;

  const difficulty = nextDifficulty(
    height,
    chain.getRecentHeaders(DIFFICULTY_WINDOW + MTP_WINDOW - 1),
    timestamp,
  );

  const sim = cloneState(chain.tipState);
  const err = applyBlockTxs(sim, height, miner, txs);
  if (err) throw new Error('test buildBlock apply failed: ' + err);

  const baseHeader: BlockHeader = {
    height,
    prevHash: hashHeader(parent),
    txRoot: computeTxRoot(txs),
    stateRoot: stateRoot(sim),
    timestamp,
    difficulty,
    nonce: 0,
    miner,
  };
  for (let nonce = 0; nonce < 0x7fff_ffff; nonce++) {
    const h: BlockHeader = { ...baseHeader, nonce };
    if (await checkPoW(h)) return { header: h, transactions: txs };
  }
  throw new Error('test buildBlock failed to find PoW');
}

export function emptyMine(chain: Blockchain, miner: Uint8Array, timestampOverride?: number): Promise<Block> {
  return buildBlock(chain, miner, [], timestampOverride);
}

export { stateRoot };
export type { State };
