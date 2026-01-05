/**
 * Mnemonic seed encoding/decoding for Salvium
 *
 * Supports 12 languages for mnemonic seeds.
 * 25 words = 24 data words + 1 checksum word
 * Each word encodes ~10.7 bits, giving 256 bits total.
 */

// Default to English, but support all languages
import english from './wordlists/english.js';
import { languages, detectLanguage, getLanguage } from './wordlists/index.js';

// Re-export English word list for backwards compatibility
export const WORD_LIST = english.words;

// Re-export language utilities
export { languages, detectLanguage, getLanguage } from './wordlists/index.js';

// Word list size (same for all languages)
const WORD_LIST_SIZE = 1626;

/**
 * CRC32 implementation for checksum
 * @param {string} str - Input string
 * @returns {number} CRC32 value
 */
function crc32(str) {
  let crc = 0xFFFFFFFF;

  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i);
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }

  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Get the word list to use based on options
 * @param {Object} options - Options object
 * @param {string} mnemonic - Optional mnemonic for auto-detection
 * @returns {Object} { wordList, language, error }
 */
function resolveWordList(options = {}, mnemonic = null) {
  // If language explicitly specified
  if (options.language) {
    // If it's already a language object with words array
    if (options.language.words && Array.isArray(options.language.words)) {
      return { wordList: options.language.words, language: options.language, prefixLength: options.language.prefixLength || 3, error: null };
    }

    // If it's 'auto', try to detect
    if (options.language === 'auto' && mnemonic) {
      const detected = detectLanguage(mnemonic);
      if (detected.language) {
        return { wordList: detected.language.words, language: detected.language, prefixLength: detected.language.prefixLength, error: null };
      }
      return { wordList: null, language: null, prefixLength: null, error: detected.error || 'Could not detect language' };
    }

    // If it's a string language name
    if (typeof options.language === 'string') {
      const lang = getLanguage(options.language);
      if (lang) {
        return { wordList: lang.words, language: lang, prefixLength: lang.prefixLength, error: null };
      }
      return { wordList: null, language: null, prefixLength: null, error: `Unknown language: ${options.language}` };
    }
  }

  // Default to English
  return { wordList: english.words, language: english, prefixLength: english.prefixLength, error: null };
}

/**
 * Decode a 25-word mnemonic to a 256-bit seed
 * @param {string} mnemonic - Space-separated 25 words
 * @param {Object} options - Options { language: 'english'|'auto'|languageObject }
 * @returns {Object} { valid, seed, language, error }
 */
export function mnemonicToSeed(mnemonic, options = {}) {
  const words = mnemonic.toLowerCase().trim().split(/\s+/);

  if (words.length !== 25) {
    return { valid: false, seed: null, language: null, error: `Expected 25 words, got ${words.length}` };
  }

  // Resolve word list (auto-detect if requested)
  const resolved = resolveWordList(
    options.language === 'auto' ? { language: 'auto' } : options,
    mnemonic
  );

  if (resolved.error) {
    return { valid: false, seed: null, language: null, error: resolved.error };
  }

  const { wordList, language, prefixLength } = resolved;

  // Convert words to indices
  const indices = [];
  for (let i = 0; i < words.length; i++) {
    const idx = wordList.indexOf(words[i]);
    if (idx === -1) {
      return { valid: false, seed: null, language, error: `Unknown word: "${words[i]}" at position ${i + 1}` };
    }
    indices.push(idx);
  }

  // Verify checksum (word 25)
  // Checksum = first N letters of each of first 24 words (N = prefixLength), concatenated, then CRC32
  const checksumData = words.slice(0, 24).map(w => w.slice(0, prefixLength)).join('');
  const expectedChecksum = crc32(checksumData) % WORD_LIST_SIZE;

  if (indices[24] !== expectedChecksum) {
    return {
      valid: false,
      seed: null,
      language,
      error: `Checksum mismatch: expected "${wordList[expectedChecksum]}", got "${words[24]}"`
    };
  }

  // Decode 24 words to 256-bit seed
  // Each group of 3 words encodes 32 bits: val = w1 + w2*1626 + w3*1626^2
  const seed = new Uint8Array(32);

  for (let i = 0; i < 8; i++) {
    const w1 = indices[i * 3];
    const w2 = indices[i * 3 + 1];
    const w3 = indices[i * 3 + 2];

    // Decode: val = w1 + w2*n + w3*n^2 where n=1626
    let val = w1 + w2 * WORD_LIST_SIZE + w3 * WORD_LIST_SIZE * WORD_LIST_SIZE;

    // Store as 4 little-endian bytes
    seed[i * 4] = val & 0xFF;
    seed[i * 4 + 1] = (val >> 8) & 0xFF;
    seed[i * 4 + 2] = (val >> 16) & 0xFF;
    seed[i * 4 + 3] = (val >> 24) & 0xFF;
  }

  return { valid: true, seed, language, error: null };
}

/**
 * Encode a 256-bit seed to a 25-word mnemonic
 * @param {Uint8Array} seed - 32-byte seed
 * @param {Object} options - Options { language: 'english'|languageObject }
 * @returns {string} Space-separated 25 words
 */
export function seedToMnemonic(seed, options = {}) {
  if (seed.length !== 32) {
    throw new Error('Seed must be 32 bytes');
  }

  // Resolve word list (no auto-detect for encoding)
  const resolved = resolveWordList(options);
  if (resolved.error) {
    throw new Error(resolved.error);
  }

  const { wordList, prefixLength } = resolved;
  const words = [];

  // Encode each 4 bytes (32 bits) as 3 words
  for (let i = 0; i < 8; i++) {
    let val = seed[i * 4] |
              (seed[i * 4 + 1] << 8) |
              (seed[i * 4 + 2] << 16) |
              (seed[i * 4 + 3] << 24);

    // Convert to unsigned
    val = val >>> 0;

    const w1 = val % WORD_LIST_SIZE;
    val = Math.floor(val / WORD_LIST_SIZE);
    const w2 = val % WORD_LIST_SIZE;
    val = Math.floor(val / WORD_LIST_SIZE);
    const w3 = val % WORD_LIST_SIZE;

    words.push(wordList[w1], wordList[w2], wordList[w3]);
  }

  // Calculate checksum word
  const checksumData = words.map(w => w.slice(0, prefixLength)).join('');
  const checksumIndex = crc32(checksumData) % WORD_LIST_SIZE;
  words.push(wordList[checksumIndex]);

  return words.join(' ');
}

/**
 * Validate a mnemonic without returning the seed
 * @param {string} mnemonic - Space-separated words
 * @param {Object} options - Options { language: 'english'|'auto'|languageObject }
 * @returns {Object} { valid, language, error }
 */
export function validateMnemonic(mnemonic, options = {}) {
  const result = mnemonicToSeed(mnemonic, options);
  return { valid: result.valid, language: result.language, error: result.error };
}

/**
 * Get all available language names
 * @returns {string[]} Array of language names
 */
export function getAvailableLanguages() {
  return Object.keys(languages);
}

export default {
  WORD_LIST,
  languages,
  mnemonicToSeed,
  seedToMnemonic,
  validateMnemonic,
  detectLanguage,
  getLanguage,
  getAvailableLanguages
};
