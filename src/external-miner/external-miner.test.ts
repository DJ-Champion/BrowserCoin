import { describe, expect, it } from 'vitest';
import { encodeBlock, decodeBlock, encodeHeader, decodeHeader, HEADER_LEN, type Block, type BlockHeader } from '../chain/block.js';
import { Blockchain } from '../chain/blockchain.js';
import { checkPoW } from '../chain/consensus.js';
import { generateKeyPair } from '../crypto/keys.js';
import { powHash } from '../crypto/pow.js';
import { compareBytes, compactToTarget, hashMeetsTarget } from '../util/binary.js';
import { buildRewardOnlyTemplate } from './template.js';
import { writeNonceBe, NONCE_OFFSET } from './worker.js';
import { COIN, MIN_FEE_PER_BYTE } from '../chain/genesis.js';
import { signTx } from '../chain/transaction.js';

describe('external miner reuse surface', () => {
  it('round-trips header encoding byte-for-byte', () => {
    const header = sampleHeader();
    const encoded = encodeHeader(header);
    const decoded = decodeHeader(encoded);
    expect(encodeHeader(decoded)).toEqual(encoded);
  });

  it('round-trips block encoding byte-for-byte', () => {
    const block: Block = { header: sampleHeader(), transactions: [] };
    const encoded = encodeBlock(block);
    const decoded = decodeBlock(encoded);
    expect(encodeBlock(decoded)).toEqual(encoded);
  });

  it('computes deterministic PoW hashes for fixed headers', async () => {
    const headerBytes = new Uint8Array(HEADER_LEN);
    headerBytes[0] = 7;
    headerBytes[100] = 1;
    const a = await powHash(headerBytes);
    const b = await powHash(headerBytes);
    expect(a).toEqual(b);
  });

  it('checks compact targets against big-endian PoW hashes', () => {
    const floorTarget = compactToTarget(0x20020000);
    expect(floorTarget).toBeGreaterThan(0n);

    const target = 1n << 255n;
    const below = new Uint8Array(32);
    below[0] = 0x7f;
    const equal = new Uint8Array(32);
    equal[0] = 0x80;
    expect(hashMeetsTarget(below, target)).toBe(true);
    expect(hashMeetsTarget(equal, target)).toBe(false);
  });

  it('writes nonce bytes in-place without changing other header bytes', () => {
    const header = new Uint8Array(HEADER_LEN);
    for (let i = 0; i < header.length; i++) header[i] = i & 0xff;
    const before = header.slice();

    writeNonceBe(header, 0x1234_abcd);

    expect(header.slice(NONCE_OFFSET, NONCE_OFFSET + 4)).toEqual(new Uint8Array([0x12, 0x34, 0xab, 0xcd]));
    header.set(before.slice(NONCE_OFFSET, NONCE_OFFSET + 4), NONCE_OFFSET);
    expect(header).toEqual(before);
  });

  it('builds a reward-only template accepted by Blockchain after PoW is found', async () => {
    const chain = new Blockchain();
    const miner = generateKeyPair();
    const template = buildRewardOnlyTemplate(chain, miner.publicKey);

    const solved = await solve(template.block.header);
    const block: Block = { header: solved, transactions: [] };
    const err = await chain.addBlock(block);

    expect(err).toBeNull();
    expect(chain.height).toBe(1);
    expect(compareBytes(chain.tip.block.header.stateRoot, solved.stateRoot)).toBe(0);
  });

  it('builds a tx-inclusive template accepted by Blockchain after PoW is found', async () => {
    const chain = new Blockchain();
    const funder = generateKeyPair();
    const recipient = generateKeyPair();
    const miner = generateKeyPair();

    const fundingTemplate = buildRewardOnlyTemplate(chain, funder.publicKey);
    const fundingHeader = await solve(fundingTemplate.block.header);
    expect(await chain.addBlock({ header: fundingHeader, transactions: [] })).toBeNull();

    const tx = signTx(
      {
        from: funder.publicKey,
        to: recipient.publicKey,
        amount: 1n * COIN,
        fee: MIN_FEE_PER_BYTE * 152n,
        nonce: 0,
      },
      funder.privateKey,
    );
    const template = buildRewardOnlyTemplate(chain, miner.publicKey, fundingHeader.timestamp + 1, [tx]);
    expect(template.block.transactions).toHaveLength(1);

    const solved = await solve(template.block.header);
    const err = await chain.addBlock({ header: solved, transactions: template.block.transactions });

    expect(err).toBeNull();
    expect(chain.height).toBe(2);
  });
});

async function solve(base: BlockHeader): Promise<BlockHeader> {
  for (let nonce = 0; nonce < 0x7fff_ffff; nonce++) {
    const candidate = { ...base, nonce };
    if (await checkPoW(candidate)) return candidate;
    if ((nonce & 0x7) === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('failed to solve test header');
}

function sampleHeader(): BlockHeader {
  return {
    height: 1,
    prevHash: filled(0x11),
    txRoot: filled(0x22),
    stateRoot: filled(0x33),
    timestamp: 1779700150,
    difficulty: 0x20020000,
    nonce: 0x0102_0304,
    miner: filled(0x44),
  };
}

function filled(value: number): Uint8Array {
  return new Uint8Array(32).fill(value);
}
