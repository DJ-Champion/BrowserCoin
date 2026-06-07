import { encodeHeader, computeTxRoot, type BlockHeader } from '../chain/block.js';
import type { Blockchain } from '../chain/blockchain.js';
import { nextDifficulty } from '../chain/consensus.js';
import { DIFFICULTY_WINDOW, MTP_WINDOW } from '../chain/genesis.js';
import { applyBlockTxs, cloneState, stateRoot } from '../chain/state.js';
import { compactToTarget } from '../util/binary.js';
import type { PublicKey } from '../crypto/keys.js';
import type { RewardOnlyTemplate } from './types.js';
import type { Transaction } from '../chain/transaction.js';

export function buildRewardOnlyTemplate(
  chain: Blockchain,
  miner: PublicKey,
  timestamp = Math.floor(Date.now() / 1000),
  txs: Transaction[] = [],
): RewardOnlyTemplate {
  const parent = chain.tip.block.header;
  const height = parent.height + 1;
  const recent = chain.getRecentHeaders(DIFFICULTY_WINDOW + MTP_WINDOW - 1);
  const difficulty = nextDifficulty(height, recent, timestamp);

  const sim = cloneState(chain.tipState);
  const err = applyBlockTxs(sim, height, miner, txs);
  if (err) throw new Error(`reward-only template apply failed: ${err}`);

  const header: BlockHeader = {
    height,
    prevHash: chain.tip.hash,
    txRoot: computeTxRoot(txs),
    stateRoot: stateRoot(sim),
    timestamp,
    difficulty,
    nonce: 0,
    miner,
  };
  const target = compactToTarget(difficulty);
  if (target <= 0n) throw new Error(`invalid compact difficulty: ${difficulty.toString(16)}`);
  return {
    block: { header, transactions: txs },
    headerBytes: encodeHeader(header),
    targetHex: target.toString(16).padStart(64, '0'),
  };
}
