/**
 * Crypto Provider Tests — JS vs WASM Equivalence + Benchmark
 *
 * Verifies byte-for-byte equivalence between JS and WASM crypto backends,
 * and benchmarks relative performance.
 */

import {
  setCryptoBackend,
  getCryptoBackend,
  getCurrentBackendType,
  keccak256,
  blake2b,
} from '../src/crypto/index.js';
import { JsCryptoBackend } from '../src/crypto/backend-js.js';
import { hexToBytes, bytesToHex } from '../src/index.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

function assertEqual(a, b, msg) {
  const aHex = a instanceof Uint8Array ? bytesToHex(a) : String(a);
  const bHex = b instanceof Uint8Array ? bytesToHex(b) : String(b);
  if (aHex !== bHex) {
    throw new Error(`${msg || 'Assertion failed'}: ${aHex} !== ${bHex}`);
  }
}

// ─── Test vectors ───────────────────────────────────────────────────────────

const testInputs = [
  new Uint8Array(0),                                           // empty
  new Uint8Array([0x61, 0x62, 0x63]),                         // "abc"
  new Uint8Array(32).fill(0xff),                              // 32 bytes of 0xff
  crypto.getRandomValues(new Uint8Array(1024)),               // 1KB random
];

// Known Keccak-256 vector: keccak256("") with CryptoNote 0x01 padding
// From: https://emn178.github.io/online-tools/keccak_256.html
const KECCAK_EMPTY = 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470';

// ─── Provider tests ─────────────────────────────────────────────────────────

console.log('\n=== Crypto Provider ===\n');

test('default backend is JS', () => {
  assertEqual(getCurrentBackendType(), 'js');
});

test('getCryptoBackend returns JsCryptoBackend by default', () => {
  const backend = getCryptoBackend();
  if (backend.name !== 'js') throw new Error(`Expected js, got ${backend.name}`);
});

await asyncTest('setCryptoBackend("js") works', async () => {
  await setCryptoBackend('js');
  assertEqual(getCurrentBackendType(), 'js');
});

await asyncTest('setCryptoBackend("wasm") works', async () => {
  await setCryptoBackend('wasm');
  assertEqual(getCurrentBackendType(), 'wasm');
  await setCryptoBackend('js'); // reset
});

// ─── Keccak-256 equivalence ─────────────────────────────────────────────────

console.log('\n=== Keccak-256 Equivalence ===\n');

test('JS keccak256 empty matches known vector', () => {
  const js = new JsCryptoBackend();
  const result = js.keccak256(new Uint8Array(0));
  assertEqual(result, hexToBytes(KECCAK_EMPTY));
});

await asyncTest('WASM keccak256 empty matches known vector', async () => {
  await setCryptoBackend('wasm');
  const result = keccak256(new Uint8Array(0));
  assertEqual(result, hexToBytes(KECCAK_EMPTY));
  await setCryptoBackend('js');
});

for (let i = 0; i < testInputs.length; i++) {
  await asyncTest(`keccak256 equivalence: input[${i}] (${testInputs[i].length} bytes)`, async () => {
    const js = new JsCryptoBackend();
    const jsResult = js.keccak256(testInputs[i]);

    await setCryptoBackend('wasm');
    const wasmResult = keccak256(testInputs[i]);
    await setCryptoBackend('js');

    assertEqual(jsResult, wasmResult, 'JS vs WASM mismatch');
  });
}

// ─── Blake2b equivalence ────────────────────────────────────────────────────

console.log('\n=== Blake2b Equivalence ===\n');

const blake2bOutLens = [32, 64];

for (const outLen of blake2bOutLens) {
  for (let i = 0; i < testInputs.length; i++) {
    await asyncTest(`blake2b(outLen=${outLen}) equivalence: input[${i}] (${testInputs[i].length} bytes)`, async () => {
      const js = new JsCryptoBackend();
      const jsResult = js.blake2b(testInputs[i], outLen);

      await setCryptoBackend('wasm');
      const wasmResult = blake2b(testInputs[i], outLen);
      await setCryptoBackend('js');

      assertEqual(jsResult, wasmResult, 'JS vs WASM mismatch');
    });
  }
}

// ─── Blake2b keyed equivalence ──────────────────────────────────────────────

console.log('\n=== Blake2b Keyed Equivalence ===\n');

const testKey = new Uint8Array(32);
testKey.set([0x01, 0x02, 0x03, 0x04]);

for (let i = 0; i < testInputs.length; i++) {
  await asyncTest(`blake2b_keyed(outLen=32) equivalence: input[${i}] (${testInputs[i].length} bytes)`, async () => {
    const js = new JsCryptoBackend();
    const jsResult = js.blake2b(testInputs[i], 32, testKey);

    await setCryptoBackend('wasm');
    const wasmResult = blake2b(testInputs[i], 32, testKey);
    await setCryptoBackend('js');

    assertEqual(jsResult, wasmResult, 'JS vs WASM mismatch');
  });
}

// ─── Benchmark ──────────────────────────────────────────────────────────────

console.log('\n=== Benchmark (10,000 iterations) ===\n');

const benchData = new Uint8Array(256).fill(0x42);
const ITERATIONS = 10_000;

// Keccak-256 benchmark
{
  await setCryptoBackend('js');
  const jsStart = performance.now();
  for (let i = 0; i < ITERATIONS; i++) keccak256(benchData);
  const jsTime = performance.now() - jsStart;

  await setCryptoBackend('wasm');
  const wasmStart = performance.now();
  for (let i = 0; i < ITERATIONS; i++) keccak256(benchData);
  const wasmTime = performance.now() - wasmStart;

  const speedup = (jsTime / wasmTime).toFixed(2);
  console.log(`  keccak256:  JS ${jsTime.toFixed(1)}ms  WASM ${wasmTime.toFixed(1)}ms  (${speedup}x)`);
}

// Blake2b benchmark
{
  await setCryptoBackend('js');
  const jsStart = performance.now();
  for (let i = 0; i < ITERATIONS; i++) blake2b(benchData, 32);
  const jsTime = performance.now() - jsStart;

  await setCryptoBackend('wasm');
  const wasmStart = performance.now();
  for (let i = 0; i < ITERATIONS; i++) blake2b(benchData, 32);
  const wasmTime = performance.now() - wasmStart;

  const speedup = (jsTime / wasmTime).toFixed(2);
  console.log(`  blake2b:    JS ${jsTime.toFixed(1)}ms  WASM ${wasmTime.toFixed(1)}ms  (${speedup}x)`);
}

await setCryptoBackend('js'); // reset

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
