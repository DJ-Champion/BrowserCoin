import { spawn } from 'node:child_process';
import { powHash } from '../src/crypto/pow.js';
import { bytesToHex } from '../src/util/binary.js';

async function main(): Promise<void> {
  const header = new Uint8Array(148);
  for (let i = 0; i < header.length; i++) header[i] = (i * 17 + 3) & 0xff;
  const headerHex = bytesToHex(header);
  const tsHash = bytesToHex(await powHash(header));

  const rustOut = await runCargo([
    'run',
    '--manifest-path',
    'rust-core/Cargo.toml',
    '--quiet',
    '--',
    'hash',
    '--header',
    headerHex,
  ]);
  const parsed = JSON.parse(rustOut.trim()) as { hash?: string };
  if (parsed.hash !== tsHash) {
    throw new Error(`Rust hash mismatch\nTS:   ${tsHash}\nRust: ${parsed.hash ?? '<missing>'}`);
  }

  console.log(`rust-core hash matches TypeScript powHash: ${tsHash}`);
}

function runCargo(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('cargo', args, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`cargo exited ${code}\n${err}\n${out}`));
    });
  });
}

void main().catch((err) => {
  console.error((err as Error).stack ?? (err as Error).message);
  process.exitCode = 1;
});
