/**
 * salvium-js - JavaScript library for Salvium cryptocurrency
 *
 * Features:
 * - Address validation and parsing for all 18 address types
 * - Support for Legacy (CryptoNote) and CARROT address formats
 * - Mainnet, Testnet, and Stagenet support
 * - Base58 encoding/decoding (Monero variant)
 * - Keccak-256 hashing
 * - Message signature verification (V1 and V2)
 *
 * @module salvium-js
 */

// Re-export everything from submodules
export * from './constants.js';
export * from './keccak.js';
export * from './base58.js';
export * from './address.js';
export * from './signature.js';
export * from './blake2b.js';
export * from './carrot.js';
export {
  scalarMultBase,
  scalarMultPoint,
  pointAddCompressed,
  getGeneratorG,
  getGeneratorT,
  computeCarrotSpendPubkey,
  computeCarrotAccountViewPubkey,
  computeCarrotMainAddressViewPubkey,
  testDouble,
  getBasePoint,
  test2G,
  testIdentity,
  get2GAffine,
  isOnCurve,
  checkG,
  check2G,
  compare2GMethods,
  decodeExpected2G,
  testFieldOps,
  debugCurveEquation,
  verifyDConstant,
  computeXFromY
} from './ed25519.js';

// Import named exports for combined API object
import {
  NETWORK,
  ADDRESS_TYPE,
  ADDRESS_FORMAT,
  PREFIXES
} from './constants.js';

import {
  keccak256,
  keccak256Hex,
  cnFastHash
} from './keccak.js';

import {
  encode,
  decode,
  encodeAddress,
  decodeAddress
} from './base58.js';

import {
  parseAddress,
  isValidAddress,
  isMainnet,
  isTestnet,
  isStagenet,
  isCarrot,
  isLegacy,
  isStandard,
  isIntegrated,
  isSubaddress,
  getSpendPublicKey,
  getViewPublicKey,
  getPaymentId,
  createAddress,
  toIntegratedAddress,
  toStandardAddress,
  describeAddress,
  bytesToHex,
  hexToBytes
} from './address.js';

import {
  verifySignature,
  parseSignature
} from './signature.js';

import {
  scalarMultBase,
  scalarMultPoint,
  pointAddCompressed,
  getGeneratorG,
  getGeneratorT,
  computeCarrotSpendPubkey,
  computeCarrotAccountViewPubkey,
  computeCarrotMainAddressViewPubkey
} from './ed25519.js';

// Main API object
const salvium = {
  // Constants
  NETWORK,
  ADDRESS_TYPE,
  ADDRESS_FORMAT,
  PREFIXES,

  // Keccak
  keccak256,
  keccak256Hex,
  cnFastHash,

  // Base58
  base58Encode: encode,
  base58Decode: decode,
  encodeAddress,
  decodeAddress,

  // Address
  parseAddress,
  isValidAddress,
  isMainnet,
  isTestnet,
  isStagenet,
  isCarrot,
  isLegacy,
  isStandard,
  isIntegrated,
  isSubaddress,
  getSpendPublicKey,
  getViewPublicKey,
  getPaymentId,
  createAddress,
  toIntegratedAddress,
  toStandardAddress,
  describeAddress,
  bytesToHex,
  hexToBytes,

  // Signatures
  verifySignature,
  parseSignature,

  // Ed25519
  scalarMultBase,
  scalarMultPoint,
  pointAddCompressed,
  getGeneratorG,
  getGeneratorT,

  // CARROT
  computeCarrotSpendPubkey,
  computeCarrotAccountViewPubkey,
  computeCarrotMainAddressViewPubkey
};

export default salvium;
