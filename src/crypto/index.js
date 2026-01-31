/**
 * Crypto Module — Public API
 *
 * Exports the provider (for backend switching) and both backends
 * for direct access when needed.
 *
 * @module crypto
 */

// Provider (default usage — delegates to active backend)
export {
  setCryptoBackend,
  getCryptoBackend,
  getCurrentBackendType,
  keccak256,
  blake2b,
} from './provider.js';

// Backends (for direct access / testing)
export { JsCryptoBackend } from './backend-js.js';
