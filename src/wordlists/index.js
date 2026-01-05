/**
 * Salvium mnemonic word lists - Language registry
 *
 * Supports 12 languages for mnemonic seed encoding/decoding.
 * Import individual languages to minimize bundle size (tree-shaking).
 */

// Individual language exports
export { default as english, words as englishWords } from './english.js';
export { default as spanish, words as spanishWords } from './spanish.js';
export { default as french, words as frenchWords } from './french.js';
export { default as german, words as germanWords } from './german.js';
export { default as italian, words as italianWords } from './italian.js';
export { default as portuguese, words as portugueseWords } from './portuguese.js';
export { default as dutch, words as dutchWords } from './dutch.js';
export { default as russian, words as russianWords } from './russian.js';
export { default as japanese, words as japaneseWords } from './japanese.js';
export { default as chinese_simplified, words as chineseSimplifiedWords } from './chinese_simplified.js';
export { default as esperanto, words as esperantoWords } from './esperanto.js';
export { default as lojban, words as lojbanWords } from './lojban.js';

// Import all for registry
import english from './english.js';
import spanish from './spanish.js';
import french from './french.js';
import german from './german.js';
import italian from './italian.js';
import portuguese from './portuguese.js';
import dutch from './dutch.js';
import russian from './russian.js';
import japanese from './japanese.js';
import chinese_simplified from './chinese_simplified.js';
import esperanto from './esperanto.js';
import lojban from './lojban.js';

/**
 * All available languages
 */
export const languages = {
  english,
  spanish,
  french,
  german,
  italian,
  portuguese,
  dutch,
  russian,
  japanese,
  chinese_simplified,
  esperanto,
  lojban
};

/**
 * List of language names
 */
export const languageNames = Object.keys(languages);

/**
 * Detect language from a mnemonic word
 * @param {string} word - A word from the mnemonic
 * @returns {Object|null} Language object or null if not found
 */
export function detectLanguageFromWord(word) {
  const normalizedWord = word.toLowerCase().trim();

  for (const [name, lang] of Object.entries(languages)) {
    if (lang.words.includes(normalizedWord)) {
      return lang;
    }
  }
  return null;
}

/**
 * Detect language from a full mnemonic phrase
 * Uses first word for detection, validates with additional words
 * @param {string} mnemonic - Space-separated mnemonic words
 * @returns {Object} { language, confidence, error }
 */
export function detectLanguage(mnemonic) {
  const words = mnemonic.toLowerCase().trim().split(/\s+/);

  if (words.length === 0) {
    return { language: null, confidence: 0, error: 'Empty mnemonic' };
  }

  // Find all languages that contain the first word
  const candidates = [];
  for (const [name, lang] of Object.entries(languages)) {
    if (lang.words.includes(words[0])) {
      candidates.push({ name, lang, matches: 1 });
    }
  }

  if (candidates.length === 0) {
    return { language: null, confidence: 0, error: `Unknown word: "${words[0]}"` };
  }

  // If only one candidate, return it
  if (candidates.length === 1) {
    return { language: candidates[0].lang, confidence: 1, error: null };
  }

  // Multiple candidates - check more words to disambiguate
  for (let i = 1; i < Math.min(words.length, 5); i++) {
    for (const candidate of candidates) {
      if (candidate.lang.words.includes(words[i])) {
        candidate.matches++;
      }
    }
  }

  // Sort by matches and return best
  candidates.sort((a, b) => b.matches - a.matches);
  const best = candidates[0];
  const confidence = best.matches / Math.min(words.length, 5);

  return { language: best.lang, confidence, error: null };
}

/**
 * Get language by name
 * @param {string} name - Language name (e.g., 'english', 'spanish')
 * @returns {Object|null} Language object or null
 */
export function getLanguage(name) {
  const normalized = name.toLowerCase().replace(/[^a-z_]/g, '');
  return languages[normalized] || null;
}

export default {
  languages,
  languageNames,
  detectLanguage,
  detectLanguageFromWord,
  getLanguage
};
