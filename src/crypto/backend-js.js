/**
 * JavaScript Crypto Backend
 *
 * Wraps existing pure-JS implementations behind the unified backend interface.
 * All existing code remains untouched — this is just a thin adapter.
 *
 * @module crypto/backend-js
 */

import { keccak256 as jsKeccak } from '../keccak.js';
import { blake2b as jsBlake2b } from '../blake2b.js';

export class JsCryptoBackend {
  constructor() {
    this.name = 'js';
  }

  async init() {
    // No initialization needed for JS backend
  }

  keccak256(data) {
    return jsKeccak(data);
  }

  blake2b(data, outLen, key) {
    return jsBlake2b(data, outLen, key);
  }
}
