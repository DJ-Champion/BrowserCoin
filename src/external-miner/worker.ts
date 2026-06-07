import { parentPort } from 'node:worker_threads';
import { powHash } from '../crypto/pow.js';
import { hashMeetsTarget } from '../util/binary.js';
import type { WorkerIn, WorkerOut } from './types.js';

export const NONCE_OFFSET = 112;

let activeGeneration = 0;
let stopped = true;

export function writeNonceBe(header: Uint8Array, nonce: number): void {
  header[NONCE_OFFSET] = (nonce >>> 24) & 0xff;
  header[NONCE_OFFSET + 1] = (nonce >>> 16) & 0xff;
  header[NONCE_OFFSET + 2] = (nonce >>> 8) & 0xff;
  header[NONCE_OFFSET + 3] = nonce & 0xff;
}

if (parentPort) {
  parentPort.on('message', (msg: WorkerIn) => {
    if (msg.type === 'stop') {
      stopped = true;
      if (msg.generation !== undefined) activeGeneration = Math.max(activeGeneration, msg.generation);
      return;
    }
    activeGeneration = msg.generation;
    stopped = false;
    void grind(msg);
  });
}

async function grind(msg: Extract<WorkerIn, { type: 'start' }>): Promise<void> {
  const generation = msg.generation;
  const header = new Uint8Array(msg.headerBytes);
  const target = BigInt('0x' + msg.targetHex);
  let nonce = msg.startNonce >>> 0;
  let hashes = 0;
  let windowStart = performance.now();

  try {
    while (!stopped && activeGeneration === generation) {
      writeNonceBe(header, nonce);
      const hash = await powHash(header);
      hashes++;

      if (hashMeetsTarget(hash, target)) {
        post({ type: 'solved', generation, nonce, hash });
        return;
      }

      const next = nonce + msg.stride;
      if (next > 0xffff_ffff) {
        postStats(generation, hashes, windowStart);
        post({ type: 'exhausted', generation });
        return;
      }
      nonce = next >>> 0;

      const now = performance.now();
      if (now - windowStart >= msg.reportEveryMs) {
        postStats(generation, hashes, windowStart, now);
        hashes = 0;
        windowStart = now;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  } catch (err) {
    post({ type: 'error', generation, error: (err as Error).message });
  }
}

function postStats(generation: number, hashes: number, start: number, end = performance.now()): void {
  if (hashes > 0) post({ type: 'hashrate', generation, hashes, elapsedMs: Math.max(1, end - start) });
}

function post(msg: WorkerOut): void {
  parentPort?.postMessage(msg);
}
