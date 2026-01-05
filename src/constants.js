/**
 * Salvium Network and Address Constants
 *
 * This module contains all address prefixes for Salvium across all network types
 * and address formats (Legacy CryptoNote and CARROT).
 */

// Network types
export const NETWORK = {
  MAINNET: 'mainnet',
  TESTNET: 'testnet',
  STAGENET: 'stagenet'
};

// Address types
export const ADDRESS_TYPE = {
  STANDARD: 'standard',
  INTEGRATED: 'integrated',
  SUBADDRESS: 'subaddress'
};

// Address formats
export const ADDRESS_FORMAT = {
  LEGACY: 'legacy',      // CryptoNote style (SaLv...)
  CARROT: 'carrot'       // CARROT style (SC1...)
};

/**
 * Address prefixes organized by network, format, and type
 * Values are BigInt for handling large prefixes
 */
export const PREFIXES = {
  [NETWORK.MAINNET]: {
    [ADDRESS_FORMAT.LEGACY]: {
      [ADDRESS_TYPE.STANDARD]:   { prefix: 0x3ef318n,    text: 'SaLv' },
      [ADDRESS_TYPE.INTEGRATED]: { prefix: 0x55ef318n,   text: 'SaLvi' },
      [ADDRESS_TYPE.SUBADDRESS]: { prefix: 0xf5ef318n,   text: 'SaLvs' }
    },
    [ADDRESS_FORMAT.CARROT]: {
      [ADDRESS_TYPE.STANDARD]:   { prefix: 0x180c96n,    text: 'SC1' },
      [ADDRESS_TYPE.INTEGRATED]: { prefix: 0x2ccc96n,    text: 'SC1i' },
      [ADDRESS_TYPE.SUBADDRESS]: { prefix: 0x314c96n,    text: 'SC1s' }
    }
  },
  [NETWORK.TESTNET]: {
    [ADDRESS_FORMAT.LEGACY]: {
      [ADDRESS_TYPE.STANDARD]:   { prefix: 0x15beb318n,   text: 'SaLvT' },
      [ADDRESS_TYPE.INTEGRATED]: { prefix: 0xd055eb318n,  text: 'SaLvTi' },
      [ADDRESS_TYPE.SUBADDRESS]: { prefix: 0xa59eb318n,   text: 'SaLvTs' }
    },
    [ADDRESS_FORMAT.CARROT]: {
      [ADDRESS_TYPE.STANDARD]:   { prefix: 0x254c96n,     text: 'SC1T' },
      [ADDRESS_TYPE.INTEGRATED]: { prefix: 0x1ac50c96n,   text: 'SC1Ti' },
      [ADDRESS_TYPE.SUBADDRESS]: { prefix: 0x3c54c96n,    text: 'SC1Ts' }
    }
  },
  [NETWORK.STAGENET]: {
    [ADDRESS_FORMAT.LEGACY]: {
      [ADDRESS_TYPE.STANDARD]:   { prefix: 0x149eb318n,   text: 'SaLvS' },
      [ADDRESS_TYPE.INTEGRATED]: { prefix: 0xf343eb318n,  text: 'SaLvSi' },
      [ADDRESS_TYPE.SUBADDRESS]: { prefix: 0x2d47eb318n,  text: 'SaLvSs' }
    },
    [ADDRESS_FORMAT.CARROT]: {
      [ADDRESS_TYPE.STANDARD]:   { prefix: 0x24cc96n,     text: 'SC1S' },
      [ADDRESS_TYPE.INTEGRATED]: { prefix: 0x1a848c96n,   text: 'SC1Si' },
      [ADDRESS_TYPE.SUBADDRESS]: { prefix: 0x384cc96n,    text: 'SC1Ss' }
    }
  }
};

/**
 * Build a reverse lookup map from prefix value to address info
 */
export const PREFIX_MAP = new Map();

for (const [network, formats] of Object.entries(PREFIXES)) {
  for (const [format, types] of Object.entries(formats)) {
    for (const [type, info] of Object.entries(types)) {
      PREFIX_MAP.set(info.prefix, {
        network,
        format,
        type,
        text: info.text
      });
    }
  }
}

/**
 * Get prefix info by prefix value
 * @param {BigInt} prefix - The prefix value
 * @returns {Object|null} - Address info or null if not found
 */
export function getPrefixInfo(prefix) {
  return PREFIX_MAP.get(prefix) || null;
}

/**
 * Get prefix for a specific address configuration
 * @param {string} network - Network type (mainnet, testnet, stagenet)
 * @param {string} format - Address format (legacy, carrot)
 * @param {string} type - Address type (standard, integrated, subaddress)
 * @returns {BigInt|null} - The prefix value or null if invalid
 */
export function getPrefix(network, format, type) {
  return PREFIXES[network]?.[format]?.[type]?.prefix || null;
}

// Key sizes
export const KEY_SIZE = 32;  // 32 bytes = 256 bits
export const CHECKSUM_SIZE = 4;
export const PAYMENT_ID_SIZE = 8;  // For integrated addresses

// Address data sizes (without prefix)
export const ADDRESS_DATA_SIZE = {
  [ADDRESS_TYPE.STANDARD]:   KEY_SIZE * 2,                          // spend_key + view_key = 64 bytes
  [ADDRESS_TYPE.INTEGRATED]: KEY_SIZE * 2 + PAYMENT_ID_SIZE,        // + payment_id = 72 bytes
  [ADDRESS_TYPE.SUBADDRESS]: KEY_SIZE * 2                           // spend_key + view_key = 64 bytes
};

// Base58 alphabet (CryptoNote variant)
export const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// Full block size for Base58 encoding (8 bytes -> 11 chars)
export const BASE58_FULL_BLOCK_SIZE = 8;
export const BASE58_FULL_ENCODED_BLOCK_SIZE = 11;

// Encoded block sizes for partial blocks
export const BASE58_ENCODED_BLOCK_SIZES = [0, 2, 3, 5, 6, 7, 9, 10, 11];
