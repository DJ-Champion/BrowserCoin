import { argon2id } from 'hash-wasm';

/**
 * Memory-hard PoW hash. Replaces SHA-256 for the proof-of-work target check.
 *
 * Block IDs / prevHash links still use sha256() (see crypto/hash.ts) — this
 * function is only called from the miner grind loop and from consensus
 * verification. 64 MB per-hash with 2 iterations puts the bottleneck on RAM
 * bandwidth, which is the closest browser-friendly analogue to ASIC
 * resistance — server attackers can't cheaply scale memory bandwidth the way
 * they can scale cores.
 */

// Network-wide fixed salt. The version suffix gives a clean hard-fork path:
// bump to "...v2" to invalidate the old chain.
const SALT = new TextEncoder().encode('browsercoin-pow-v1');

export const POW_PARAMS = {
  memorySize: 64 * 1024, // KiB → 64 MB
  iterations: 2,
  parallelism: 1,
  hashLength: 32,
} as const;

export async function powHash(headerBytes: Uint8Array): Promise<Uint8Array> {
  const out = await argon2id({
    password: headerBytes,
    salt: SALT,
    parallelism: POW_PARAMS.parallelism,
    iterations: POW_PARAMS.iterations,
    memorySize: POW_PARAMS.memorySize,
    hashLength: POW_PARAMS.hashLength,
    outputType: 'binary',
  });
  return out as Uint8Array;
}
