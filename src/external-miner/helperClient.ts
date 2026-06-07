import type { BlocksResponse, BlockSubmitResponse, TipResponse } from './types.js';

export class HelperClient {
  private base: string;

  constructor(apiUrl: string) {
    this.base = apiUrl.replace(/\/+$/, '');
  }

  async getTip(): Promise<TipResponse> {
    return this.getJson<TipResponse>('/tip');
  }

  async getBlocks(fromHeight: number, max = 200): Promise<string[]> {
    const res = await this.getJson<BlocksResponse>(`/blocks?fromHeight=${fromHeight}&max=${max}`);
    if (!Array.isArray(res.blocks)) throw new Error('/blocks response missing blocks array');
    return res.blocks;
  }

  async getStats(): Promise<unknown> {
    return this.getJson<unknown>('/stats');
  }

  async getMempool(): Promise<string[]> {
    const res = await this.getJson<{ txs?: string[] }>('/mempool');
    if (!Array.isArray(res.txs)) throw new Error('/mempool response missing txs array');
    return res.txs;
  }

  async submitBlock(blockHex: string): Promise<BlockSubmitResponse> {
    const res = await fetch(`${this.base}/block`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ block: blockHex }),
    });
    if (!res.ok) throw new Error(`POST /block failed: HTTP ${res.status} ${await res.text()}`);
    const body = await res.json() as BlockSubmitResponse;
    if (body.status !== 'added' && body.status !== 'orphan' && body.status !== 'invalid') {
      throw new Error(`POST /block returned unknown status: ${JSON.stringify(body)}`);
    }
    return body;
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await fetch(`${this.base}${path}`);
    if (!res.ok) throw new Error(`GET ${path} failed: HTTP ${res.status} ${await res.text()}`);
    return await res.json() as T;
  }
}
