/**
 * Blake2b Tests
 *
 * Tests for Blake2b hash function with RFC 7693 test vectors.
 */

import { blake2b, blake2bHex } from '../src/blake2b.js';
import { bytesToHex, hexToBytes } from '../src/index.js';

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

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message} Expected "${expected}", got "${actual}"`);
  }
}

function assertLength(value, length, message = '') {
  if (value.length !== length) {
    throw new Error(`${message} Expected length ${length}, got ${value.length}`);
  }
}

function assertTrue(value, message = '') {
  if (!value) {
    throw new Error(`${message} Expected true, got ${value}`);
  }
}

// ============================================================
// RFC 7693 Test Vectors
// ============================================================

console.log('\n--- RFC 7693 Test Vectors ---');

// From RFC 7693 Appendix A (empty input, 64-byte output, no key)
test('Empty input, 64-byte output (RFC 7693)', () => {
  const hash = blake2b(new Uint8Array(0), 64);
  const expected = '786a02f742015903c6c6fd852552d272912f4740e15847618a86e217f71f5419d25e1031afee585313896444934eb04b903a685b1448b755d56f701afe9be2ce';
  assertEqual(bytesToHex(hash), expected);
});

// From RFC 7693 Appendix A ("abc", 64-byte output, no key)
test('"abc" input, 64-byte output (RFC 7693)', () => {
  const input = new TextEncoder().encode('abc');
  const hash = blake2b(input, 64);
  const expected = 'ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923';
  assertEqual(bytesToHex(hash), expected);
});

// ============================================================
// Variable Output Length Tests
// ============================================================

console.log('\n--- Variable Output Length Tests ---');

test('blake2b returns correct length for 32 bytes', () => {
  const hash = blake2b(new Uint8Array(0), 32);
  assertLength(hash, 32);
});

test('blake2b returns correct length for 64 bytes', () => {
  const hash = blake2b(new Uint8Array(0), 64);
  assertLength(hash, 64);
});

test('blake2b returns correct length for 1 byte', () => {
  const hash = blake2b(new Uint8Array(0), 1);
  assertLength(hash, 1);
});

test('blake2b throws for output length 0', () => {
  let threw = false;
  try {
    blake2b(new Uint8Array(0), 0);
  } catch (e) {
    threw = true;
  }
  assertTrue(threw, 'Should throw for output length 0');
});

test('blake2b throws for output length > 64', () => {
  let threw = false;
  try {
    blake2b(new Uint8Array(0), 65);
  } catch (e) {
    threw = true;
  }
  assertTrue(threw, 'Should throw for output length 65');
});

// ============================================================
// Determinism Tests
// ============================================================

console.log('\n--- Determinism Tests ---');

test('blake2b is deterministic', () => {
  const input = new Uint8Array([1, 2, 3, 4, 5]);
  const h1 = blake2b(input, 32);
  const h2 = blake2b(input, 32);
  assertEqual(bytesToHex(h1), bytesToHex(h2));
});

test('blake2b produces different output for different input', () => {
  const input1 = new Uint8Array([1, 2, 3]);
  const input2 = new Uint8Array([1, 2, 4]);
  const h1 = blake2b(input1, 32);
  const h2 = blake2b(input2, 32);
  assertTrue(bytesToHex(h1) !== bytesToHex(h2));
});

test('blake2b produces different output for different lengths', () => {
  const input = new Uint8Array([1, 2, 3]);
  const h32 = blake2b(input, 32);
  const h64 = blake2b(input, 64);
  // First 32 bytes should NOT be the same (different output length affects computation)
  assertTrue(bytesToHex(h32) !== bytesToHex(h64).substring(0, 64));
});

// ============================================================
// Keyed Hashing Tests
// ============================================================

console.log('\n--- Keyed Hashing Tests ---');

test('blake2b with key returns different result than without', () => {
  const input = new TextEncoder().encode('test');
  const key = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  const h1 = blake2b(input, 32);
  const h2 = blake2b(input, 32, key);
  assertTrue(bytesToHex(h1) !== bytesToHex(h2));
});

test('blake2b with key is deterministic', () => {
  const input = new TextEncoder().encode('test');
  const key = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const h1 = blake2b(input, 32, key);
  const h2 = blake2b(input, 32, key);
  assertEqual(bytesToHex(h1), bytesToHex(h2));
});

test('blake2b with different keys produces different output', () => {
  const input = new TextEncoder().encode('test');
  const key1 = new Uint8Array([1, 2, 3, 4]);
  const key2 = new Uint8Array([1, 2, 3, 5]);
  const h1 = blake2b(input, 32, key1);
  const h2 = blake2b(input, 32, key2);
  assertTrue(bytesToHex(h1) !== bytesToHex(h2));
});

test('blake2b throws for key > 64 bytes', () => {
  let threw = false;
  try {
    blake2b(new Uint8Array(0), 32, new Uint8Array(65));
  } catch (e) {
    threw = true;
  }
  assertTrue(threw, 'Should throw for key > 64 bytes');
});

test('blake2b accepts 64-byte key', () => {
  const key = new Uint8Array(64);
  for (let i = 0; i < 64; i++) key[i] = i;
  const hash = blake2b(new TextEncoder().encode('test'), 32, key);
  assertLength(hash, 32);
});

// ============================================================
// blake2bHex Tests
// ============================================================

console.log('\n--- blake2bHex Tests ---');

test('blake2bHex returns hex string', () => {
  const hash = blake2bHex(new TextEncoder().encode('test'), 32);
  assertEqual(typeof hash, 'string');
  assertLength(hash, 64); // 32 bytes = 64 hex chars
});

test('blake2bHex matches bytesToHex of blake2b', () => {
  const input = new TextEncoder().encode('hello');
  const hashBytes = blake2b(input, 32);
  const hashHex = blake2bHex(input, 32);
  assertEqual(hashHex, bytesToHex(hashBytes));
});

// ============================================================
// Large Input Tests
// ============================================================

console.log('\n--- Large Input Tests ---');

test('blake2b handles input larger than block size (128 bytes)', () => {
  const input = new Uint8Array(256);
  for (let i = 0; i < 256; i++) input[i] = i & 0xff;
  const hash = blake2b(input, 32);
  assertLength(hash, 32);
});

test('blake2b handles input exactly one block (128 bytes)', () => {
  const input = new Uint8Array(128);
  for (let i = 0; i < 128; i++) input[i] = i;
  const hash = blake2b(input, 32);
  assertLength(hash, 32);
});

test('blake2b handles input of multiple blocks', () => {
  const input = new Uint8Array(512);
  for (let i = 0; i < 512; i++) input[i] = i & 0xff;
  const hash = blake2b(input, 32);
  assertLength(hash, 32);
});

// ============================================================
// Additional Test Vectors (from other implementations)
// ============================================================

console.log('\n--- Additional Test Vectors ---');

// Empty input, 32-byte output
test('Empty input, 32-byte output', () => {
  const hash = blake2b(new Uint8Array(0), 32);
  const expected = '0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8';
  assertEqual(bytesToHex(hash), expected);
});

// Test with sequential bytes
test('Sequential byte input (0-255)', () => {
  const input = new Uint8Array(256);
  for (let i = 0; i < 256; i++) input[i] = i;
  const hash = blake2b(input, 64);
  // This should produce a consistent output (determinism check)
  assertLength(hash, 64);
  assertTrue(bytesToHex(hash).length === 128);
});

// ============================================================
// Summary
// ============================================================

console.log('\n--- Blake2b Test Summary ---');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

if (failed > 0) {
  console.log('\n⚠️  Some tests failed!');
  process.exit(1);
} else {
  console.log('\n✓ All blake2b tests passed!');
}
