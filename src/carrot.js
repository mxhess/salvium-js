/**
 * CARROT Key Derivation Functions
 * Implements key derivation as per Salvium CARROT specification
 */

import { blake2b } from './blake2b.js';
import { hexToBytes, bytesToHex } from './address.js';

// Group order L for scalar reduction
const L = (1n << 252n) + 27742317777372353535851937790883648493n;

// Create length-prefixed domain separator (matches Salvium SpFixedTranscript format)
function makeDomainSep(str) {
  const strBytes = new TextEncoder().encode(str);
  const result = new Uint8Array(1 + strBytes.length);
  result[0] = strBytes.length;  // Length prefix
  result.set(strBytes, 1);
  return result;
}

// Domain separators (from Salvium carrot_core/config.h)
// Each is length-prefixed as per SpFixedTranscript format
const DOMAIN_SEP = {
  PROVE_SPEND_KEY: makeDomainSep("Carrot prove-spend key"),
  VIEW_BALANCE_SECRET: makeDomainSep("Carrot view-balance secret"),
  GENERATE_IMAGE_KEY: makeDomainSep("Carrot generate-image key"),
  INCOMING_VIEW_KEY: makeDomainSep("Carrot incoming view key"),
  GENERATE_ADDRESS_SECRET: makeDomainSep("Carrot generate-address secret")
};

/**
 * Reduce a 64-byte value modulo L (curve order)
 * This is sc_reduce from ref10
 * @param {Uint8Array} bytes - 64 bytes to reduce
 * @returns {Uint8Array} 32-byte scalar
 */
function scReduce(bytes) {
  // Convert 64 bytes to BigInt (little-endian)
  let n = 0n;
  for (let i = 63; i >= 0; i--) {
    n = (n << 8n) | BigInt(bytes[i]);
  }

  // Reduce mod L
  n = n % L;

  // Convert back to 32 bytes (little-endian)
  const result = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    result[i] = Number(n & 0xffn);
    n = n >> 8n;
  }

  return result;
}

/**
 * H_32: 32-byte keyed hash
 * @param {Uint8Array} domainSep - Domain separator
 * @param {Uint8Array} key - 32-byte key
 * @returns {Uint8Array} 32-byte hash
 */
function deriveBytes32(domainSep, key) {
  return blake2b(domainSep, 32, key);
}

/**
 * H_n: Scalar derivation (hash to 64 bytes, then reduce mod L)
 * @param {Uint8Array} domainSep - Domain separator
 * @param {Uint8Array} key - 32-byte key
 * @returns {Uint8Array} 32-byte scalar
 */
function deriveScalar(domainSep, key) {
  const hash64 = blake2b(domainSep, 64, key);
  return scReduce(hash64);
}

/**
 * Derive view-balance secret from master secret
 * s_vb = H_32("Carrot view-balance secret", s_master)
 * @param {Uint8Array} masterSecret - 32-byte master secret (spend key)
 * @returns {Uint8Array} 32-byte view-balance secret
 */
export function makeViewBalanceSecret(masterSecret) {
  return deriveBytes32(DOMAIN_SEP.VIEW_BALANCE_SECRET, masterSecret);
}

/**
 * Derive view-incoming key from view-balance secret
 * k_vi = H_n("Carrot incoming view key", s_vb)
 * @param {Uint8Array} viewBalanceSecret - 32-byte view-balance secret
 * @returns {Uint8Array} 32-byte view-incoming key
 */
export function makeViewIncomingKey(viewBalanceSecret) {
  return deriveScalar(DOMAIN_SEP.INCOMING_VIEW_KEY, viewBalanceSecret);
}

/**
 * Derive prove-spend key from master secret
 * k_ps = H_n("Carrot prove-spend key", s_master)
 * @param {Uint8Array} masterSecret - 32-byte master secret
 * @returns {Uint8Array} 32-byte prove-spend key
 */
export function makeProveSpendKey(masterSecret) {
  return deriveScalar(DOMAIN_SEP.PROVE_SPEND_KEY, masterSecret);
}

/**
 * Derive generate-image key from view-balance secret
 * k_gi = H_n("Carrot generate-image key", s_vb)
 * @param {Uint8Array} viewBalanceSecret - 32-byte view-balance secret
 * @returns {Uint8Array} 32-byte generate-image key
 */
export function makeGenerateImageKey(viewBalanceSecret) {
  return deriveScalar(DOMAIN_SEP.GENERATE_IMAGE_KEY, viewBalanceSecret);
}

/**
 * Derive generate-address secret from view-balance secret
 * s_ga = H_32("Carrot generate-address secret", s_vb)
 * @param {Uint8Array} viewBalanceSecret - 32-byte view-balance secret
 * @returns {Uint8Array} 32-byte generate-address secret
 */
export function makeGenerateAddressSecret(viewBalanceSecret) {
  return deriveBytes32(DOMAIN_SEP.GENERATE_ADDRESS_SECRET, viewBalanceSecret);
}

/**
 * Derive all CARROT keys from master secret
 * @param {Uint8Array|string} masterSecret - 32-byte master secret or hex string
 * @returns {Object} All derived keys as hex strings
 */
export function deriveCarrotKeys(masterSecret) {
  // Convert hex string to bytes if needed
  if (typeof masterSecret === 'string') {
    masterSecret = hexToBytes(masterSecret);
  }

  const viewBalanceSecret = makeViewBalanceSecret(masterSecret);
  const proveSpendKey = makeProveSpendKey(masterSecret);
  const viewIncomingKey = makeViewIncomingKey(viewBalanceSecret);
  const generateImageKey = makeGenerateImageKey(viewBalanceSecret);
  const generateAddressSecret = makeGenerateAddressSecret(viewBalanceSecret);

  return {
    masterSecret: bytesToHex(masterSecret),
    proveSpendKey: bytesToHex(proveSpendKey),
    viewBalanceSecret: bytesToHex(viewBalanceSecret),
    generateImageKey: bytesToHex(generateImageKey),
    viewIncomingKey: bytesToHex(viewIncomingKey),
    generateAddressSecret: bytesToHex(generateAddressSecret)
  };
}

export default {
  makeViewBalanceSecret,
  makeViewIncomingKey,
  makeProveSpendKey,
  makeGenerateImageKey,
  makeGenerateAddressSecret,
  deriveCarrotKeys
};
