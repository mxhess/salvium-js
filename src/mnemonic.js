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
  // Salvium checksum: CRC32 of prefixes → mod 24 → the checksum word should match seed[index]
  const checksumData = words.slice(0, 24).map(w => w.slice(0, prefixLength)).join('');
  const checksumIndex = crc32(checksumData) % 24;

  // The checksum word should match the word at checksumIndex (by prefix)
  const expectedPrefix = words[checksumIndex].slice(0, prefixLength);
  const actualPrefix = words[24].slice(0, prefixLength);

  if (expectedPrefix !== actualPrefix) {
    return {
      valid: false,
      seed: null,
      language,
      error: `Checksum mismatch: expected "${words[checksumIndex]}", got "${words[24]}"`
    };
  }

  // Decode 24 words to 256-bit seed
  // Salvium uses modified base-1626 encoding with wrapping for error detection
  // Formula: val = w1 + N * (((N - w1) + w2) % N) + N^2 * (((N - w2) + w3) % N)
  const seed = new Uint8Array(32);
  const N = WORD_LIST_SIZE;

  for (let i = 0; i < 8; i++) {
    const w1 = indices[i * 3];
    const w2 = indices[i * 3 + 1];
    const w3 = indices[i * 3 + 2];

    // Salvium/Monero electrum-style decoding with wrapping
    const val = w1 +
                N * (((N - w1) + w2) % N) +
                N * N * (((N - w2) + w3) % N);

    // Verify the encoding is valid (val % N should equal w1)
    if (val % N !== w1) {
      return { valid: false, seed: null, language, error: `Invalid word encoding at position ${i * 3 + 1}` };
    }

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
  const N = WORD_LIST_SIZE;

  // Encode each 4 bytes (32 bits) as 3 words
  // Salvium uses modified base-1626 encoding with wrapping for error detection
  // Formula: w1 = val % N, w2 = ((val/N) + w1) % N, w3 = ((val/N/N) + w2) % N
  for (let i = 0; i < 8; i++) {
    let val = seed[i * 4] |
              (seed[i * 4 + 1] << 8) |
              (seed[i * 4 + 2] << 16) |
              (seed[i * 4 + 3] << 24);

    // Convert to unsigned
    val = val >>> 0;

    const w1 = val % N;
    const w2 = (Math.floor(val / N) + w1) % N;
    const w3 = (Math.floor(val / N / N) + w2) % N;

    words.push(wordList[w1], wordList[w2], wordList[w3]);
  }

  // Calculate checksum word
  // Salvium checksum: CRC32 of prefixes → mod 24 → repeat seed[index] as checksum
  const checksumData = words.map(w => w.slice(0, prefixLength)).join('');
  const checksumIndex = crc32(checksumData) % 24;
  words.push(words[checksumIndex]);

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
