import type { Block } from './block.js';

/** Network identity baked into tx signatures to prevent cross-chain replay. */
export const CHAIN_ID = 0xc01dfeed;

/** Smallest unit: 1 BRC = 1e8 wei. */
export const COIN = 100_000_000n;

/** Initial block reward (50 BRC), halved every HALVING_INTERVAL blocks. */
export const INITIAL_REWARD = 50n * COIN;
export const HALVING_INTERVAL = 210_000;

/**
 * Hard cap on any single monetary value in a transaction. Post-Bitcoin-2010
 * defense-in-depth — bigint can't overflow, but capping fields makes the
 * "impossible" attack literally inexpressible. Equal to max supply (21M),
 * so no tx can claim more value than will ever exist on the chain.
 */
export const MAX_MONEY = 21_000_000n * COIN;

/** Target one block every 2.5 minutes (150 s) — 4x faster than Bitcoin. */
export const TARGET_BLOCK_TIME_S = 150;

/**
 * Sliding-window size for per-block difficulty retargeting (see consensus.ts).
 * Every block compares average block-time over the last DIFFICULTY_WINDOW
 * blocks against TARGET_BLOCK_TIME_S and adjusts within the asymmetric caps.
 *
 * Bitcoin retargets every 2016 blocks because its global hashrate barely
 * moves. BrowserCoin's hashrate swings 100× when one tab joins or closes, so
 * we retarget every block over a short window. 50 blocks (~2 h at target)
 * gives reasonable statistical convergence without being too laggy.
 */
export const DIFFICULTY_WINDOW = 50;

/**
 * Number of historical timestamps used to compute MTP. Retargeting uses MTP
 * (not raw timestamps) on both ends of the window so that miner-supplied
 * timestamps can't be ground in either direction to game difficulty.
 */
export const MTP_WINDOW = 11;

/**
 * Symmetric retarget step caps, per block.
 *
 * Both directions clamped to 2× per block. Earlier asymmetric form (2× up,
 * 4× down) was the "miners-left-quickly" defense, but combined with the
 * emergency-drop rule it let target run from genesis to MAX_TARGET in 3–4
 * blocks after a stall — gifting the next miner hundreds of zero-work
 * blocks. The difficulty floor in consensus.ts plus symmetric retarget
 * makes that class of failure structurally impossible.
 */
export const MAX_RETARGET_FACTOR_UP = 2;   // target / 2 (difficulty *2) per block
export const MAX_RETARGET_FACTOR_DOWN = 2; // target * 2 (difficulty /2) per block

/**
 * Emergency drop: if the candidate block's timestamp is more than this many
 * target intervals past the parent's timestamp, the chain is presumed stalled
 * and the next block may use prev.difficulty / 2 without the normal window
 * calculation. Prevents indefinite stalls when a large miner suddenly leaves.
 */
export const EMERGENCY_DROP_MULT = 6;

/**
 * Reject blocks whose timestamp is more than 10 minutes in the future.
 * Tighter than Bitcoin's 2h because the smaller window is what bounds a
 * lone miner's ability to fabricate two consecutive "slow" intervals and
 * fire the emergency drop (see consensus.ts). 10 min still leaves ample
 * room for clock skew across browser tabs.
 */
export const MAX_FUTURE_TIME_S = 10 * 60;

/** Max serialized block size (browser-friendly cap). */
export const MAX_BLOCK_BYTES = 256 * 1024;

/** Mempool size cap. */
export const MAX_MEMPOOL_TXS = 5_000;

/** Min fee per byte (in wei). Cheap but non-zero to discourage spam. */
export const MIN_FEE_PER_BYTE = 1n;

/**
 * Initial difficulty target. Sized for memory-hard Argon2id PoW (see
 * POW_PARAMS in src/crypto/pow.ts — currently 32 MB / 1 iter, ~40–125 ms
 * per hash on a laptop). Bootstrap blocks land in a few hundred ms;
 * per-block retarget then pulls difficulty up toward TARGET_BLOCK_TIME_S
 * as real miners join.
 *
 * Compact 0x20400000 → target = 0x400000 << 232 = 2^254, giving
 * P(success) = 1/4 (~4 expected attempts).
 *
 * Must equal targetToCompact(compactToTarget(GENESIS_DIFFICULTY_COMPACT))
 * (canonical normalized form) so per-window retargets that hit the target
 * pace return identically. Mantissa's high bit must be clear (>=0x800000
 * normalizes to a higher exponent).
 */
export const GENESIS_DIFFICULTY_COMPACT = 0x20400000;

/** Maximum hash value treated as "infinity" target — used in chain-work math. */
export const MAX_TARGET = (1n << 256n) - 1n;

/** Coinbase reward at a given height (account-model implicit coinbase). */
export function blockReward(height: number): bigint {
  const halvings = Math.floor(height / HALVING_INTERVAL);
  if (halvings >= 64) return 0n; // subsidy exhausted
  return INITIAL_REWARD >> BigInt(halvings);
}

/**
 * Genesis block. Mined offline at "build time" (well — at first launch).
 * Zero prev-hash, height 0, no transactions, no miner reward credited.
 * Tests and the initial chain construct this deterministically.
 *
 * Timestamp is set near v3 launch so that block 1's retarget math doesn't
 * inherit a multi-year gap to genesis. The old v2 value (1700000000, Nov
 * 2023) caused the bootstrap retarget window to be dominated by the
 * genesis-era timestamp, which combined with the emergency-drop rule
 * crashed difficulty on the very first real block.
 */
export const GENESIS: Block = {
  header: {
    height: 0,
    prevHash: new Uint8Array(32),
    txRoot: new Uint8Array(32),
    stateRoot: new Uint8Array(32),
    timestamp: 1779000000, // ~2026-05-22 06:40 UTC — near v3 launch
    difficulty: GENESIS_DIFFICULTY_COMPACT,
    nonce: 0,
    miner: new Uint8Array(32),
  },
  transactions: [],
};
