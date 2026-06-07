import fs from 'node:fs/promises';
import { decodeBlock } from '../chain/block.js';
import { encodeBlock } from '../chain/block.js';
import { Blockchain } from '../chain/blockchain.js';
import { bytesToHex, hexToBytes } from '../util/binary.js';
import { HelperClient } from './helperClient.js';

export interface ChainSyncOptions {
  skipExpensiveValidation?: boolean;
  cachePath?: string | null;
  onProgress?: (progress: { localHeight: number; targetHeight: number }) => void;
}

export class ChainSync {
  readonly chain = new Blockchain();

  constructor(private client: HelperClient, private opts: ChainSyncOptions = {}) {}

  async loadCache(): Promise<number> {
    if (!this.opts.cachePath) return 0;
    let text: string;
    try {
      text = await fs.readFile(this.opts.cachePath, 'utf-8');
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') return 0;
      throw err;
    }
    const data = JSON.parse(text) as { version?: number; blocks?: string[] };
    if (data.version !== 1 || !Array.isArray(data.blocks)) {
      throw new Error(`invalid external miner chain cache: ${this.opts.cachePath}`);
    }
    let restored = 0;
    for (const hex of data.blocks) {
      const block = decodeBlock(hexToBytes(hex));
      const err = await this.chain.addValidatedBlock(block);
      if (err) throw new Error(`cached block at height ${block.header.height} rejected locally: ${err}`);
      restored++;
    }
    return restored;
  }

  async saveCache(): Promise<void> {
    if (!this.opts.cachePath) return;
    const blocks: string[] = [];
    for (const cb of this.chain.iterateCanonical()) {
      if (cb.block.header.height > 0) blocks.unshift(bytesToHex(encodeBlock(cb.block)));
    }
    await fs.writeFile(this.opts.cachePath, JSON.stringify({ version: 1, blocks }) + '\n');
  }

  async syncToHelper(): Promise<void> {
    const tip = await this.client.getTip();
    let fromHeight = Math.max(0, this.chain.height + 1);
    if (tip.height < this.chain.height) return;
    this.opts.onProgress?.({ localHeight: this.chain.height, targetHeight: tip.height });

    while (fromHeight <= tip.height) {
      const blocks = await this.client.getBlocks(fromHeight, 200);
      if (blocks.length === 0) break;
      for (const hex of blocks) {
        const block = decodeBlock(hexToBytes(hex));
        if (block.header.height <= this.chain.height && this.chain.hasBlock(Blockchain.hash(block.header))) {
          continue;
        }
        const err = this.opts.skipExpensiveValidation
          ? await this.chain.addValidatedBlock(block)
          : await this.chain.addBlock(block);
        if (err) throw new Error(`helper block at height ${block.header.height} rejected locally: ${err}`);
        fromHeight = Math.max(fromHeight, block.header.height + 1);
      }
      this.opts.onProgress?.({ localHeight: this.chain.height, targetHeight: tip.height });
      if (blocks.length < 200) break;
    }
    await this.saveCache();
  }
}
