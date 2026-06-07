#!/usr/bin/env node
import { parseMinerConfig, usage } from '../external-miner/config.js';
import { ExternalMinerController } from '../external-miner/controller.js';
import { loadOrCreateWallet } from '../external-miner/wallet.js';
import { bytesToHex } from '../util/binary.js';

async function main(): Promise<void> {
  let config;
  try {
    config = parseMinerConfig(process.argv.slice(2));
  } catch (err) {
    const message = (err as Error).message;
    console.error(message || usage());
    process.exitCode = message.startsWith('Usage:') ? 0 : 1;
    return;
  }

  const wallet = await loadOrCreateWallet(config.walletPath);
  if (config.logLevel !== 'quiet') {
    console.log(`wallet=${config.walletPath} miner=${bytesToHex(wallet.publicKey)}`);
  }

  const controller = new ExternalMinerController(config, wallet);
  if (config.command === 'benchmark') await controller.benchmark();
  else await controller.mine();
}

void main().catch((err) => {
  console.error((err as Error).stack ?? (err as Error).message);
  process.exitCode = 1;
});
