/**
 * Monero/Salvium Base58 Encoding/Decoding
 *
 * This is NOT the same as Bitcoin's Base58Check!
 * Monero uses a block-based encoding where:
 * - Data is split into 8-byte blocks
 * - Each 8-byte block encodes to exactly 11 Base58 characters
 * - Partial blocks use a size mapping table
 */

import { BASE58_ALPHABET, BASE58_FULL_BLOCK_SIZE, BASE58_FULL_ENCODED_BLOCK_SIZE, BASE58_ENCODED_BLOCK_SIZES } from './constants.js';
import { keccak256 } from './keccak.js';

// Build reverse alphabet lookup
const ALPHABET_MAP = new Map();
for (let i = 0; i < BASE58_ALPHABET.length; i++) {
  ALPHABET_MAP.set(BASE58_ALPHABET[i], i);
}

// Build decoded block sizes lookup (reverse of encoded block sizes)
const DECODED_BLOCK_SIZES = new Map();
for (let i = 0; i < BASE58_ENCODED_BLOCK_SIZES.length; i++) {
  DECODED_BLOCK_SIZES.set(BASE58_ENCODED_BLOCK_SIZES[i], i);
}

/**
 * Convert bytes to big-endian uint64
 * @param {Uint8Array} data - Input bytes (up to 8 bytes)
 * @returns {BigInt} - Big-endian integer value
 */
function uint8BEToUint64(data) {
  let result = 0n;
  for (let i = 0; i < data.length; i++) {
    result = (result << 8n) | BigInt(data[i]);
  }
  return result;
}

/**
 * Convert uint64 to big-endian bytes
 * @param {BigInt} num - Number to convert
 * @param {number} size - Output size in bytes
 * @returns {Uint8Array} - Big-endian bytes
 */
function uint64ToUint8BE(num, size) {
  const result = new Uint8Array(size);
  for (let i = size - 1; i >= 0; i--) {
    result[i] = Number(num & 0xFFn);
    num >>= 8n;
  }
  return result;
}

/**
 * Encode a single block of data to Base58
 * @param {Uint8Array} block - Input block (1-8 bytes)
 * @returns {string} - Base58 encoded string
 */
function encodeBlock(block) {
  const encodedSize = BASE58_ENCODED_BLOCK_SIZES[block.length];
  const result = new Array(encodedSize).fill(BASE58_ALPHABET[0]);

  let num = uint8BEToUint64(block);
  let i = encodedSize - 1;

  while (num > 0n) {
    const remainder = Number(num % 58n);
    num = num / 58n;
    result[i] = BASE58_ALPHABET[remainder];
    i--;
  }

  return result.join('');
}

/**
 * Decode a single Base58 block to bytes
 * @param {string} block - Base58 encoded block
 * @returns {Uint8Array|null} - Decoded bytes or null on error
 */
function decodeBlock(block) {
  const decodedSize = DECODED_BLOCK_SIZES.get(block.length);
  if (decodedSize === undefined || decodedSize < 0) {
    return null; // Invalid block size
  }

  if (decodedSize === 0) {
    return new Uint8Array(0);
  }

  let num = 0n;
  const base = 58n;

  for (let i = 0; i < block.length; i++) {
    const digit = ALPHABET_MAP.get(block[i]);
    if (digit === undefined) {
      return null; // Invalid character
    }
    num = num * base + BigInt(digit);
  }

  // Check for overflow
  if (decodedSize < BASE58_FULL_BLOCK_SIZE && num >= (1n << BigInt(8 * decodedSize))) {
    return null; // Overflow
  }

  return uint64ToUint8BE(num, decodedSize);
}

/**
 * Encode binary data to Base58 (Monero variant)
 * @param {Uint8Array|Array} data - Binary data to encode
 * @returns {string} - Base58 encoded string
 */
export function encode(data) {
  if (!(data instanceof Uint8Array)) {
    data = new Uint8Array(data);
  }

  if (data.length === 0) {
    return '';
  }

  const fullBlockCount = Math.floor(data.length / BASE58_FULL_BLOCK_SIZE);
  const lastBlockSize = data.length % BASE58_FULL_BLOCK_SIZE;

  let result = '';

  // Encode full blocks
  for (let i = 0; i < fullBlockCount; i++) {
    const block = data.slice(i * BASE58_FULL_BLOCK_SIZE, (i + 1) * BASE58_FULL_BLOCK_SIZE);
    result += encodeBlock(block);
  }

  // Encode last partial block
  if (lastBlockSize > 0) {
    const block = data.slice(fullBlockCount * BASE58_FULL_BLOCK_SIZE);
    result += encodeBlock(block);
  }

  return result;
}

/**
 * Decode Base58 string to binary data (Monero variant)
 * @param {string} encoded - Base58 encoded string
 * @returns {Uint8Array|null} - Decoded binary data or null on error
 */
export function decode(encoded) {
  if (encoded.length === 0) {
    return new Uint8Array(0);
  }

  const fullBlockCount = Math.floor(encoded.length / BASE58_FULL_ENCODED_BLOCK_SIZE);
  const lastBlockSize = encoded.length % BASE58_FULL_ENCODED_BLOCK_SIZE;
  const lastBlockDecodedSize = DECODED_BLOCK_SIZES.get(lastBlockSize);

  if (lastBlockDecodedSize === undefined || lastBlockDecodedSize < 0) {
    return null; // Invalid encoded length
  }

  const dataSize = fullBlockCount * BASE58_FULL_BLOCK_SIZE + lastBlockDecodedSize;
  const result = new Uint8Array(dataSize);

  let offset = 0;

  // Decode full blocks
  for (let i = 0; i < fullBlockCount; i++) {
    const block = encoded.slice(i * BASE58_FULL_ENCODED_BLOCK_SIZE, (i + 1) * BASE58_FULL_ENCODED_BLOCK_SIZE);
    const decoded = decodeBlock(block);
    if (decoded === null) {
      return null;
    }
    result.set(decoded, offset);
    offset += BASE58_FULL_BLOCK_SIZE;
  }

  // Decode last partial block
  if (lastBlockSize > 0) {
    const block = encoded.slice(fullBlockCount * BASE58_FULL_ENCODED_BLOCK_SIZE);
    const decoded = decodeBlock(block);
    if (decoded === null) {
      return null;
    }
    result.set(decoded, offset);
  }

  return result;
}

/**
 * Encode a varint (variable-length integer)
 * @param {BigInt|number} value - Integer to encode
 * @returns {Uint8Array} - Varint encoded bytes
 */
export function encodeVarint(value) {
  value = BigInt(value);
  const bytes = [];

  while (value >= 0x80n) {
    bytes.push(Number((value & 0x7Fn) | 0x80n));
    value >>= 7n;
  }
  bytes.push(Number(value));

  return new Uint8Array(bytes);
}

/**
 * Decode a varint from the start of data
 * @param {Uint8Array} data - Data containing varint
 * @returns {{value: BigInt, bytesRead: number}|null} - Decoded value and bytes consumed
 */
export function decodeVarint(data) {
  let value = 0n;
  let shift = 0n;
  let bytesRead = 0;

  for (let i = 0; i < data.length && i < 10; i++) {
    const byte = BigInt(data[i]);
    value |= (byte & 0x7Fn) << shift;
    bytesRead++;

    if ((byte & 0x80n) === 0n) {
      return { value, bytesRead };
    }

    shift += 7n;
  }

  return null; // Varint too long or incomplete
}

/**
 * Encode an address with tag/prefix and checksum
 * @param {BigInt|number} tag - Address prefix/tag
 * @param {Uint8Array} data - Address data (public keys)
 * @returns {string} - Base58 encoded address
 */
export function encodeAddress(tag, data) {
  // Build: [varint tag][data][4-byte checksum]
  const tagBytes = encodeVarint(tag);
  const combined = new Uint8Array(tagBytes.length + data.length);
  combined.set(tagBytes, 0);
  combined.set(data, tagBytes.length);

  // Compute checksum (first 4 bytes of Keccak-256)
  const hash = keccak256(combined);
  const checksum = hash.slice(0, 4);

  // Combine with checksum
  const withChecksum = new Uint8Array(combined.length + 4);
  withChecksum.set(combined, 0);
  withChecksum.set(checksum, combined.length);

  return encode(withChecksum);
}

/**
 * Decode an address, verifying checksum and extracting tag and data
 * @param {string} address - Base58 encoded address
 * @returns {{tag: BigInt, data: Uint8Array}|null} - Decoded tag and data, or null on error
 */
export function decodeAddress(address) {
  const decoded = decode(address);
  if (decoded === null || decoded.length <= 4) {
    return null;
  }

  // Extract checksum
  const checksum = decoded.slice(decoded.length - 4);
  const payload = decoded.slice(0, decoded.length - 4);

  // Verify checksum
  const hash = keccak256(payload);
  const expectedChecksum = hash.slice(0, 4);

  for (let i = 0; i < 4; i++) {
    if (checksum[i] !== expectedChecksum[i]) {
      return null; // Checksum mismatch
    }
  }

  // Decode varint tag
  const varintResult = decodeVarint(payload);
  if (varintResult === null) {
    return null;
  }

  const { value: tag, bytesRead } = varintResult;
  const data = payload.slice(bytesRead);

  return { tag, data };
}

export default {
  encode,
  decode,
  encodeVarint,
  decodeVarint,
  encodeAddress,
  decodeAddress
};
