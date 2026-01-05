/**
 * Salvium Message Signature Verification
 *
 * Supports both V1 (legacy) and V2 (domain-separated) signatures.
 *
 * Signature format: "SigV1" or "SigV2" + Base58(signature_bytes)
 * where signature_bytes = c (32 bytes) + r (32 bytes) + sign_mask (1 byte) = 65 bytes
 *
 * V1: hash = Keccak256(message)
 * V2: hash = Keccak256(domain_separator + spend_key + view_key + mode + varint(len) + message)
 */

import { keccak256 } from './keccak.js';
import { decode } from './base58.js';
import { parseAddress, hexToBytes } from './address.js';
import {
  scalarCheck,
  scalarIsNonzero,
  scalarSub,
  pointFromBytes,
  doubleScalarMultBase,
  isIdentity,
  scalarMultBase
} from './ed25519.js';

// Domain separator for V2 signatures (includes null terminator)
const HASH_KEY_MESSAGE_SIGNING = new TextEncoder().encode('MoneroMessageSignature\0');

/**
 * Encode a number as a varint (variable-length integer)
 * @param {number} n - Number to encode
 * @returns {Uint8Array} Varint bytes
 */
function encodeVarint(n) {
  const bytes = [];
  while (n >= 0x80) {
    bytes.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  bytes.push(n & 0x7f);
  return new Uint8Array(bytes);
}

/**
 * Compute V1 message hash (simple Keccak256)
 * @param {string} message - The message
 * @returns {Uint8Array} 32-byte hash
 */
function getMessageHashV1(message) {
  const messageBytes = new TextEncoder().encode(message);
  return keccak256(messageBytes);
}

/**
 * Compute V2 message hash with domain separation
 * @param {string} message - The message
 * @param {Uint8Array} spendKey - 32-byte spend public key
 * @param {Uint8Array} viewKey - 32-byte view public key
 * @param {number} mode - 0 for spend key, 1 for view key
 * @returns {Uint8Array} 32-byte hash
 */
function getMessageHashV2(message, spendKey, viewKey, mode) {
  // Debug helper
  const bytesToHex = (bytes) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

  const messageBytes = new TextEncoder().encode(message);
  const lenVarint = encodeVarint(messageBytes.length);

  console.log('=== V2 Hash Construction ===');
  console.log('Domain sep length:', HASH_KEY_MESSAGE_SIGNING.length);
  console.log('Domain sep:', bytesToHex(HASH_KEY_MESSAGE_SIGNING));
  console.log('Spend key:', bytesToHex(spendKey));
  console.log('View key:', bytesToHex(viewKey));
  console.log('Mode:', mode);
  console.log('Message length:', messageBytes.length);
  console.log('Len varint:', bytesToHex(lenVarint));
  console.log('Message bytes:', bytesToHex(messageBytes));

  // Concatenate: domain_separator + spend_key + view_key + mode + len + message
  const totalLen = HASH_KEY_MESSAGE_SIGNING.length + 32 + 32 + 1 + lenVarint.length + messageBytes.length;
  const data = new Uint8Array(totalLen);

  let offset = 0;
  data.set(HASH_KEY_MESSAGE_SIGNING, offset);
  offset += HASH_KEY_MESSAGE_SIGNING.length;

  data.set(spendKey, offset);
  offset += 32;

  data.set(viewKey, offset);
  offset += 32;

  data[offset++] = mode;

  data.set(lenVarint, offset);
  offset += lenVarint.length;

  data.set(messageBytes, offset);

  const hash = keccak256(data);
  console.log('Total data length:', data.length);
  console.log('V2 hash result:', bytesToHex(hash));

  return hash;
}

/**
 * Perform Schnorr signature verification
 *
 * Verifies: R' = r*G + c*P, then checks hash(prefix || key || R') == c
 *
 * @param {Uint8Array} hash - 32-byte message hash
 * @param {Uint8Array} publicKey - 32-byte public key
 * @param {Uint8Array} sigC - 32-byte signature c component
 * @param {Uint8Array} sigR - 32-byte signature r component
 * @returns {boolean} true if signature is valid
 */
function checkSignature(hash, publicKey, sigC, sigR) {
  // Import bytesToHex for debugging
  const bytesToHex = (bytes) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

  console.log('=== checkSignature ===');
  console.log('hash (message hash):', bytesToHex(hash));
  console.log('publicKey:', bytesToHex(publicKey));
  console.log('sigC:', bytesToHex(sigC));
  console.log('sigR:', bytesToHex(sigR));

  // Validate scalars
  if (!scalarCheck(sigC) || !scalarCheck(sigR) || !scalarIsNonzero(sigC)) {
    console.log('Scalar validation failed');
    return false;
  }
  console.log('Scalar validation passed');

  // Decompress public key
  const P = pointFromBytes(publicKey);
  if (!P) {
    console.log('Failed to decompress public key');
    return false;
  }
  console.log('Public key decompressed successfully');

  // Compute R' = c*P + r*G using double scalar multiplication
  const RBytes = doubleScalarMultBase(sigC, P, sigR);
  console.log('R\' computed:', bytesToHex(RBytes));

  // Check R' is not identity
  if (isIdentity(RBytes)) {
    console.log('R\' is identity point');
    return false;
  }

  // Recompute challenge: c' = H(hash || publicKey || R')
  // CryptoNote signature uses: c = H(m || P || R) where m is the message hash
  const buf = new Uint8Array(32 + 32 + 32);
  buf.set(hash, 0);
  buf.set(publicKey, 32);
  buf.set(RBytes, 64);

  const cPrime = keccak256(buf);
  console.log('cPrime (raw hash) H(m||P||R):', bytesToHex(cPrime));

  // Reduce c' mod L
  const cPrimeReduced = new Uint8Array(32);
  reduceScalar32(cPrimeReduced, cPrime);
  console.log('cPrime (reduced):', bytesToHex(cPrimeReduced));
  console.log('sigC (expected):', bytesToHex(sigC));

  // Check c' == c
  const diff = new Uint8Array(32);
  scalarSub(diff, cPrimeReduced, sigC);
  console.log('diff:', bytesToHex(diff));
  console.log('diff nonzero:', scalarIsNonzero(diff));

  return !scalarIsNonzero(diff);
}

// Group order L
const L = (1n << 252n) + 27742317777372353535851937790883648493n;

/**
 * Reduce a 32-byte value modulo L using BigInt
 * @param {Uint8Array} r - 32-byte output
 * @param {Uint8Array} x - 32-byte input
 */
function reduceScalar32(r, x) {
  // Convert to BigInt (little-endian)
  let n = 0n;
  for (let i = 31; i >= 0; i--) {
    n = (n << 8n) | BigInt(x[i]);
  }

  // Reduce mod L
  n = n % L;

  // Convert back to bytes (little-endian)
  for (let i = 0; i < 32; i++) {
    r[i] = Number(n & 0xffn);
    n = n >> 8n;
  }
}

/**
 * Verify a Salvium message signature
 *
 * @param {string} message - The original message that was signed
 * @param {string} address - Salvium address (to extract public keys)
 * @param {string} signature - The signature string (SigV1... or SigV2...)
 * @returns {Object} Result object with:
 *   - valid: boolean - whether signature is valid
 *   - version: number - signature version (1 or 2)
 *   - keyType: string - 'spend' or 'view' (which key was used to sign)
 *   - error: string|null - error message if invalid
 */
// Test function to verify Ed25519 and Keccak are working
export function testEd25519() {
  const bytesToHex = (bytes) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

  // Test 1: Verify 2*G (this is the key test - if this works, Ed25519 is correct)
  const two = new Uint8Array(32);
  two[0] = 2;
  const twoG = scalarMultBase(two);
  const twoGHex = bytesToHex(twoG);
  const twoGExpected = 'c9a3f86aae465f0e56513864510f3997561fa2c9e85ea21dc2292309f3cd6022';
  console.log('2*G =', twoGHex);
  console.log('2*G expected:', twoGExpected);
  console.log('2*G match:', twoGHex === twoGExpected);

  // Test 2: Verify Keccak-256
  // Known test vector: Keccak256("") = c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470
  const emptyHash = keccak256(new Uint8Array(0));
  const emptyHashHex = bytesToHex(emptyHash);
  const emptyHashExpected = 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470';
  console.log('Keccak256("") =', emptyHashHex);
  console.log('Expected:', emptyHashExpected);
  console.log('Keccak match:', emptyHashHex === emptyHashExpected);

  // Test 3: Keccak of "test"
  const testHash = keccak256(new TextEncoder().encode('test'));
  const testHashHex = bytesToHex(testHash);
  // Keccak256("test") = 9c22ff5f21f0b81b113e63f7db6da94fedef11b2119b4088b89664fb9a3cb658
  const testHashExpected = '9c22ff5f21f0b81b113e63f7db6da94fedef11b2119b4088b89664fb9a3cb658';
  console.log('Keccak256("test") =', testHashHex);
  console.log('Expected:', testHashExpected);
  console.log('Keccak test match:', testHashHex === testHashExpected);

  // Test 4: Point decompression roundtrip
  // Compress 2*G, decompress it, recompress, should match
  const twoGDecompressed = pointFromBytes(twoG);
  if (twoGDecompressed) {
    // Need to access pointToBytes - let me export it
    console.log('2*G decompression: success');
  } else {
    console.log('2*G decompression: FAILED');
  }

  // Test 5: Test with the actual public key from the signature test
  const testPubKey = new Uint8Array([
    0x28, 0x97, 0x3e, 0x82, 0x1c, 0xc2, 0xf2, 0xde,
    0x5e, 0x68, 0x9a, 0xd6, 0x1c, 0x4d, 0xda, 0xd4,
    0x8a, 0x1b, 0xac, 0x77, 0xf1, 0x94, 0x43, 0x97,
    0xe0, 0x6e, 0x90, 0xf7, 0xd6, 0x5f, 0xda, 0xd1
  ]);
  const pubKeyPoint = pointFromBytes(testPubKey);
  console.log('Public key decompression:', pubKeyPoint ? 'success' : 'FAILED');

  // Test 6: Double scalar mult: verify 3*G + 5*G = 8*G
  const three = new Uint8Array(32); three[0] = 3;
  const five = new Uint8Array(32); five[0] = 5;
  const eight = new Uint8Array(32); eight[0] = 8;

  const threeG = scalarMultBase(three);
  const threeGPoint = pointFromBytes(threeG);
  const result = doubleScalarMultBase(three, threeGPoint, five);  // 3*(3G) + 5*G = 9G + 5G = 14G? No wait...

  // Actually test: a*G + b*G = (a+b)*G using G as the point
  // doubleScalarMultBase(a, P, b) = a*P + b*G
  // If P = G, then a*G + b*G = (a+b)*G
  const oneScalar = new Uint8Array(32); oneScalar[0] = 1;
  const Gcompressed = scalarMultBase(oneScalar);
  const Gpoint = pointFromBytes(Gcompressed);

  // 3*G + 5*G should equal 8*G
  const sumResult = doubleScalarMultBase(three, Gpoint, five);
  const eightG = scalarMultBase(eight);

  console.log('3*G + 5*G =', bytesToHex(sumResult));
  console.log('8*G =      ', bytesToHex(eightG));
  console.log('Double scalar mult match:', bytesToHex(sumResult) === bytesToHex(eightG));

  return {
    ed25519OK: twoGHex === twoGExpected,
    keccakOK: emptyHashHex === emptyHashExpected && testHashHex === testHashExpected,
    doubleScalarOK: bytesToHex(sumResult) === bytesToHex(eightG)
  };
}

export function verifySignature(message, address, signature) {
  // Parse signature header
  const isV1 = signature.startsWith('SigV1');
  const isV2 = signature.startsWith('SigV2');

  if (!isV1 && !isV2) {
    return { valid: false, version: 0, keyType: null, error: 'Invalid signature header (expected SigV1 or SigV2)' };
  }

  const version = isV1 ? 1 : 2;
  const headerLen = 5; // "SigV1" or "SigV2"

  // Decode signature from Base58
  let sigBytes;
  try {
    sigBytes = decode(signature.substring(headerLen));
  } catch (e) {
    return { valid: false, version, keyType: null, error: 'Failed to decode signature Base58' };
  }

  // Signature should be 65 bytes (c: 32, r: 32, sign_mask: 1)
  if (sigBytes.length !== 65) {
    return { valid: false, version, keyType: null, error: `Invalid signature length: expected 65, got ${sigBytes.length}` };
  }

  const sigC = sigBytes.slice(0, 32);
  const sigR = sigBytes.slice(32, 64);
  // sign_mask (byte 64) is not used for standard message verification

  // Parse address to get public keys
  const addrInfo = parseAddress(address);
  if (!addrInfo.valid) {
    return { valid: false, version, keyType: null, error: `Invalid address: ${addrInfo.error}` };
  }

  const spendKey = addrInfo.spendPublicKey;
  const viewKey = addrInfo.viewPublicKey;

  // Try verification with spend key (mode 0)
  let hash;
  if (isV1) {
    hash = getMessageHashV1(message);
  } else {
    hash = getMessageHashV2(message, spendKey, viewKey, 0);
  }

  if (checkSignature(hash, spendKey, sigC, sigR)) {
    return { valid: true, version, keyType: 'spend', error: null };
  }

  // Try verification with view key (mode 1)
  if (isV2) {
    hash = getMessageHashV2(message, spendKey, viewKey, 1);
  }
  // For V1, the hash is just the message hash, same for both keys

  if (checkSignature(hash, viewKey, sigC, sigR)) {
    return { valid: true, version, keyType: 'view', error: null };
  }

  return { valid: false, version, keyType: null, error: 'Signature verification failed' };
}

/**
 * Parse a signature string and extract its components
 *
 * @param {string} signature - The signature string
 * @returns {Object} Parsed signature with version, c, r, signMask
 */
export function parseSignature(signature) {
  const isV1 = signature.startsWith('SigV1');
  const isV2 = signature.startsWith('SigV2');

  if (!isV1 && !isV2) {
    return { valid: false, error: 'Invalid signature header' };
  }

  const version = isV1 ? 1 : 2;

  try {
    const sigBytes = decode(signature.substring(5));
    if (sigBytes.length !== 65) {
      return { valid: false, error: 'Invalid signature length' };
    }

    return {
      valid: true,
      version,
      c: sigBytes.slice(0, 32),
      r: sigBytes.slice(32, 64),
      signMask: sigBytes[64]
    };
  } catch (e) {
    return { valid: false, error: 'Failed to decode signature' };
  }
}

export default {
  verifySignature,
  parseSignature,
  getMessageHashV1,
  getMessageHashV2
};
