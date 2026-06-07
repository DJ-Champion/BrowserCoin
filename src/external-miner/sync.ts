import { decodeBlock } from '../chain/block.js';
import { Blockchain } from '../chain/blockchain.js';
import { hexToBytes } from '../util/binary.js';
import { HelperClient } from './helperClient.js';

export class ChainSync {
  readonly chain = new Blockchain();

  constructor(private client: HelperClient) {}

  async syncToHelper(): Promise<void> {
    const tip = await this.client.getTip();
    let fromHeight = Math.max(0, this.chain.height + 1);
    if (tip.height < this.chain.height) return;

    while (fromHeight <= tip.height) {
      const blocks = await this.client.getBlocks(fromHeight, 200);
      if (blocks.length === 0) break;
      for (const hex of blocks) {
        const block = decodeBlock(hexToBytes(hex));
        if (block.header.height <= this.chain.height && this.chain.hasBlock(Blockchain.hash(block.header))) {
          continue;
        }
        const err = await this.chain.addBlock(block);
        if (err) throw new Error(`helper block at height ${block.header.height} rejected locally: ${err}`);
        fromHeight = Math.max(fromHeight, block.header.height + 1);
      }
      if (blocks.length < 200) break;
    }
  }
}
