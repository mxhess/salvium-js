/**
 * WASM Crypto Backend
 *
 * Loads Rust-compiled WASM module and wraps it behind the unified backend interface.
 * Falls back gracefully if WASM cannot be loaded.
 *
 * @module crypto/backend-wasm
 */

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let wasmExports = null;

/**
 * Load and instantiate the WASM module from disk
 */
async function loadWasm() {
  if (wasmExports) return wasmExports;

  const wasmPath = join(__dirname, 'wasm', 'salvium_crypto_bg.wasm');
  const wasmBytes = await readFile(wasmPath);

  // Import the JS glue to get the import object and init function
  const glue = await import('./wasm/salvium_crypto.js');

  // Use initSync with the raw WASM bytes (works in Bun/Node, no fetch needed)
  glue.initSync({ module: wasmBytes });
  wasmExports = glue;
  return wasmExports;
}

export class WasmCryptoBackend {
  constructor() {
    this.name = 'wasm';
    this.wasm = null;
  }

  async init() {
    this.wasm = await loadWasm();
  }

  keccak256(data) {
    if (!this.wasm) throw new Error('WASM backend not initialized. Call init() first.');
    return this.wasm.keccak256(data);
  }

  blake2b(data, outLen, key) {
    if (!this.wasm) throw new Error('WASM backend not initialized. Call init() first.');
    if (key) {
      return this.wasm.blake2b_keyed(data, outLen, key);
    }
    return this.wasm.blake2b_hash(data, outLen);
  }
}
