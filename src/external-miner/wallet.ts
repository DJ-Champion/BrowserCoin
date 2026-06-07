import fs from 'node:fs/promises';
import path from 'node:path';
import { generateKeyPair, fromPrivateKey, type KeyPair } from '../crypto/keys.js';
import { bytesToHex, hexToBytes } from '../util/binary.js';
import type { WalletFile } from './types.js';

export async function loadOrCreateWallet(walletPath: string): Promise<KeyPair> {
  try {
    const text = await fs.readFile(walletPath, 'utf-8');
    const data = JSON.parse(text) as Partial<WalletFile>;
    if (data.version !== 1) throw new Error('wallet version must be 1');
    if (typeof data.privateKey !== 'string') throw new Error('wallet privateKey missing');
    if (typeof data.publicKey !== 'string') throw new Error('wallet publicKey missing');
    const keyPair = fromPrivateKey(hexToBytes(data.privateKey));
    if (bytesToHex(keyPair.publicKey) !== data.publicKey) {
      throw new Error('wallet publicKey does not match privateKey');
    }
    return keyPair;
  } catch (err) {
    const e = err as { code?: string };
    if (e.code !== 'ENOENT') throw err;
  }

  const keyPair = generateKeyPair();
  const file: WalletFile = {
    version: 1,
    publicKey: bytesToHex(keyPair.publicKey),
    privateKey: bytesToHex(keyPair.privateKey),
    createdAt: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(walletPath), { recursive: true });
  await fs.writeFile(walletPath, JSON.stringify(file, null, 2) + '\n', { flag: 'wx' });
  return keyPair;
}
