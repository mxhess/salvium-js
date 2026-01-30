/**
 * Alternative Chain Management and Block Handling
 *
 * Implements chain reorganization logic faithful to the Salvium C++ source:
 * - Alternative block storage and tracking
 * - Cumulative difficulty comparison
 * - Chain switching with rollback on failure
 *
 * Reference: salvium/src/cryptonote_core/blockchain.cpp
 *
 * @module blockchain
 */

import {
  ChainState,
  BLOCKCHAIN_TIMESTAMP_CHECK_WINDOW,
  CRYPTONOTE_BLOCK_FUTURE_TIME_LIMIT,
  DIFFICULTY_TARGET_V2,
  nextDifficultyV2,
  getMedianTimestamp,
  validateBlockTimestamp,
  CRYPTONOTE_MEMPOOL_TX_FROM_ALT_BLOCK_LIVETIME
} from './consensus.js';

// =============================================================================
// BLOCK EXTENDED INFO
// =============================================================================

/**
 * Extended block info, matching C++ block_extended_info.
 * Holds a block plus its chain context (height, cumulative difficulty, etc).
 */
export class BlockExtendedInfo {
  constructor(data = {}) {
    this.block = data.block || null;                           // Parsed block data
    this.hash = data.hash || null;                             // Block hash (hex)
    this.height = data.height ?? 0;                            // Block height
    this.blockWeight = data.blockWeight ?? 0;                  // Block weight
    this.cumulativeDifficulty = data.cumulativeDifficulty ?? 0n; // Cumulative difficulty
    this.alreadyGeneratedCoins = data.alreadyGeneratedCoins ?? 0n; // Emission at this point
  }
}

// =============================================================================
// BLOCK VERIFICATION CONTEXT
// =============================================================================

/**
 * Verification result for a block, matching C++ block_verification_context.
 */
export class BlockVerificationContext {
  constructor() {
    this.addedToMainChain = false;
    this.addedToAltChain = false;
    this.markedAsOrphaned = false;
    this.alreadyExists = false;
    this.partialBlockReward = false;
  }
}

// =============================================================================
// ALTERNATIVE CHAIN MANAGER
// =============================================================================

/**
 * Core chain reorganization logic.
 *
 * Manages alternative blocks and performs chain switching when an alternative
 * chain accumulates more cumulative difficulty than the main chain.
 *
 * Reference: blockchain.cpp handle_alternative_block(), switch_to_alternative_blockchain()
 */
export class AlternativeChainManager {
  /**
   * @param {ChainState} chainState - Main chain state
   * @param {Object} [options]
   * @param {Function} [options.onReorg] - Callback on reorg: ({ splitHeight, oldHeight, newHeight, blocksDisconnected, blocksConnected })
   * @param {Function} [options.getHfVersion] - Get hard fork version for height: (height) => number
   * @param {Function} [options.getBlockHash] - Compute block hash: (block) => string
   * @param {Function} [options.getBlockWeight] - Compute block weight: (block) => number
   * @param {Function} [options.validateBlock] - Additional block validation: (block, context) => boolean
   */
  constructor(chainState, options = {}) {
    this.chainState = chainState;
    this.onReorg = options.onReorg || null;
    this.getHfVersion = options.getHfVersion || (() => 2);
    this.getBlockHashFn = options.getBlockHash || null;
    this.getBlockWeightFn = options.getBlockWeight || ((block) => block.weight || 0);
    this.validateBlockFn = options.validateBlock || null;

    /** @type {Map<string, BlockExtendedInfo>} Alternative blocks by hash */
    this.altBlocks = new Map();

    /** @type {Set<string>} Known invalid block hashes */
    this.invalidBlocks = new Set();
  }

  /**
   * Handle an incoming block.
   * Routes to main chain addition or alternative chain handling.
   *
   * Reference: blockchain.cpp handle_block_to_main_chain() / handle_alternative_block()
   *
   * @param {Object} block - Parsed block (must have .prevHash, .timestamp, .difficulty or similar)
   * @param {string} blockHash - Block hash
   * @returns {BlockVerificationContext} Result
   */
  handleBlock(block, blockHash) {
    const bvc = new BlockVerificationContext();

    // Check for duplicate
    if (this.chainState.findBlockByHash(blockHash) >= 0 || this.altBlocks.has(blockHash)) {
      bvc.alreadyExists = true;
      return bvc;
    }

    // Check if known invalid
    if (this.invalidBlocks.has(blockHash)) {
      bvc.markedAsOrphaned = true;
      return bvc;
    }

    // Check if parent is invalid
    const prevHash = block.prevHash || block.prev_hash;
    if (this.invalidBlocks.has(prevHash)) {
      this.invalidBlocks.add(blockHash);
      bvc.markedAsOrphaned = true;
      return bvc;
    }

    // Check if extends main chain tip
    const tipHash = this.chainState.getTipHash();
    if (prevHash === tipHash) {
      return this._addToMainChain(block, blockHash, bvc);
    }

    // Check if parent is in main chain (not tip) or alt blocks
    const parentMainHeight = this.chainState.findBlockByHash(prevHash);
    const parentInAlt = this.altBlocks.get(prevHash);

    if (parentMainHeight >= 0 || parentInAlt) {
      return this._handleAlternativeBlock(block, blockHash, bvc);
    }

    // Parent unknown - orphan
    bvc.markedAsOrphaned = true;
    return bvc;
  }

  /**
   * Add a block to the main chain.
   * @private
   */
  _addToMainChain(block, blockHash, bvc) {
    const weight = this.getBlockWeightFn(block);
    const difficulty = block.difficulty !== undefined ? BigInt(block.difficulty) : 0n;

    // Validate timestamp
    if (this.chainState.timestamps.length >= BLOCKCHAIN_TIMESTAMP_CHECK_WINDOW) {
      const recentTs = this.chainState.timestamps.slice(-BLOCKCHAIN_TIMESTAMP_CHECK_WINDOW);
      const currentTime = Math.floor(Date.now() / 1000);
      if (!validateBlockTimestamp(block.timestamp, recentTs, currentTime)) {
        this.invalidBlocks.add(blockHash);
        bvc.markedAsOrphaned = true;
        return bvc;
      }
    }

    // Additional validation
    if (this.validateBlockFn && !this.validateBlockFn(block, { height: this.chainState.height, isAlt: false })) {
      this.invalidBlocks.add(blockHash);
      bvc.markedAsOrphaned = true;
      return bvc;
    }

    this.chainState.addBlock(block.timestamp, difficulty, weight, blockHash);
    bvc.addedToMainChain = true;

    // Clean up old alt blocks
    this._pruneAltBlocks();

    return bvc;
  }

  /**
   * Handle an alternative block.
   * Build the alt chain, validate, store, and switch if stronger.
   *
   * Reference: blockchain.cpp handle_alternative_block() lines 2363-2587
   * @private
   */
  _handleAlternativeBlock(block, blockHash, bvc) {
    const prevHash = block.prevHash || block.prev_hash;

    // Build the alternative chain back to the split point
    const { altChain, splitHeight, timestamps, cumulativeDifficulties } =
      this._buildAltChain(prevHash);

    const altHeight = splitHeight + altChain.length + 1;

    // Validate timestamp against alt chain + main chain timestamps
    const allTimestamps = [...timestamps];
    if (allTimestamps.length >= BLOCKCHAIN_TIMESTAMP_CHECK_WINDOW) {
      const recentTs = allTimestamps.slice(-BLOCKCHAIN_TIMESTAMP_CHECK_WINDOW);
      const median = getMedianTimestamp(recentTs);
      if (block.timestamp <= median) {
        this.invalidBlocks.add(blockHash);
        bvc.markedAsOrphaned = true;
        return bvc;
      }
    }

    // Check future time limit
    const currentTime = Math.floor(Date.now() / 1000);
    if (block.timestamp > currentTime + CRYPTONOTE_BLOCK_FUTURE_TIME_LIMIT) {
      bvc.markedAsOrphaned = true;
      return bvc;
    }

    // Calculate difficulty for this alt block
    const altDifficulty = this._getDifficultyForAltChain(
      altChain, splitHeight, timestamps, cumulativeDifficulties
    );

    // Compute cumulative difficulty
    const prevCumDiff = cumulativeDifficulties.length > 0
      ? cumulativeDifficulties[cumulativeDifficulties.length - 1]
      : 0n;
    const altCumulativeDifficulty = prevCumDiff + altDifficulty;

    // Additional validation
    if (this.validateBlockFn && !this.validateBlockFn(block, { height: altHeight, isAlt: true })) {
      this.invalidBlocks.add(blockHash);
      bvc.markedAsOrphaned = true;
      return bvc;
    }

    // Store the alternative block
    const altBlockInfo = new BlockExtendedInfo({
      block,
      hash: blockHash,
      height: altHeight,
      blockWeight: this.getBlockWeightFn(block),
      cumulativeDifficulty: altCumulativeDifficulty
    });
    this.altBlocks.set(blockHash, altBlockInfo);

    bvc.addedToAltChain = true;

    // Check if alt chain has more work than main chain
    const mainCumulativeDifficulty = this.chainState.getCumulativeDifficulty();

    if (altCumulativeDifficulty > mainCumulativeDifficulty) {
      const fullAltChain = [...altChain, altBlockInfo];
      const switchResult = this._switchToAlternativeChain(fullAltChain, splitHeight);

      if (switchResult) {
        bvc.addedToMainChain = true;
        bvc.addedToAltChain = false;
      }
    }

    return bvc;
  }

  /**
   * Build an alternative chain from prevHash back to the main chain split point.
   *
   * Reference: blockchain.cpp build_alt_chain() lines 2302-2355
   * @private
   *
   * @param {string} prevHash - Previous block hash
   * @returns {{ altChain: BlockExtendedInfo[], splitHeight: number, timestamps: number[], cumulativeDifficulties: bigint[] }}
   */
  _buildAltChain(prevHash) {
    const altChain = [];
    let currentHash = prevHash;

    // Walk backward through alt blocks until we hit the main chain
    while (this.altBlocks.has(currentHash)) {
      const altBlock = this.altBlocks.get(currentHash);
      altChain.unshift(altBlock);
      currentHash = altBlock.block.prevHash || altBlock.block.prev_hash;
    }

    // currentHash should now be in the main chain
    const splitHeight = this.chainState.findBlockByHash(currentHash);
    if (splitHeight < 0) {
      // Disconnected alt chain - shouldn't happen normally
      return { altChain, splitHeight: 0, timestamps: [], cumulativeDifficulties: [] };
    }

    // Collect timestamps and cumulative difficulties from main chain up to split
    // plus alt chain
    const timestamps = [];
    const cumulativeDifficulties = [];

    // Main chain portion: take recent timestamps up to split point
    const windowStart = Math.max(0, splitHeight + 1 - BLOCKCHAIN_TIMESTAMP_CHECK_WINDOW);
    for (let i = windowStart; i <= splitHeight; i++) {
      timestamps.push(this.chainState.timestamps[i]);
      cumulativeDifficulties.push(this.chainState.cumulativeDifficulties[i]);
    }

    // Alt chain portion
    for (const altBlock of altChain) {
      timestamps.push(altBlock.block.timestamp);
      cumulativeDifficulties.push(altBlock.cumulativeDifficulty);
    }

    return { altChain, splitHeight, timestamps, cumulativeDifficulties };
  }

  /**
   * Switch the main chain to an alternative chain.
   *
   * Reference: blockchain.cpp switch_to_alternative_blockchain() lines 1137-1255
   * @private
   *
   * @param {BlockExtendedInfo[]} altChain - Full alt chain from split to tip
   * @param {number} splitHeight - Height where chains diverge
   * @returns {boolean} True if switch succeeded
   */
  _switchToAlternativeChain(altChain, splitHeight) {
    const oldHeight = this.chainState.height;

    // 1. Pop main chain blocks back to split point
    const disconnected = this.chainState.rollbackToHeight(splitHeight + 1);

    // 2. Apply alt chain blocks to main chain
    const applied = [];
    let success = true;

    for (const altBlockInfo of altChain) {
      const block = altBlockInfo.block;
      const weight = altBlockInfo.blockWeight;
      const difficulty = altBlockInfo.cumulativeDifficulty - (
        applied.length > 0
          ? altChain[altChain.indexOf(altBlockInfo) - 1].cumulativeDifficulty
          : this.chainState.getCumulativeDifficulty()
      );

      if (this.validateBlockFn && !this.validateBlockFn(block, { height: this.chainState.height, isAlt: false })) {
        success = false;
        break;
      }

      this.chainState.addBlock(block.timestamp, difficulty, weight, altBlockInfo.hash);
      applied.push(altBlockInfo);
    }

    if (!success) {
      // 3. Rollback failed switch
      this._rollbackChainSwitching(disconnected, splitHeight + 1);
      return false;
    }

    // 4. Store disconnected blocks as alternative blocks
    let disconnectedHeight = oldHeight;
    for (const popped of disconnected) {
      disconnectedHeight--;
      if (popped.blockHash) {
        // Compute cumulative difficulty for the disconnected block
        // (we lost the exact cumDiff, but can reconstruct from the popped data)
        const altInfo = new BlockExtendedInfo({
          block: {
            timestamp: popped.timestamp,
            prevHash: disconnectedHeight > 0
              ? this.chainState.getBlockHash(disconnectedHeight - 1)
              : null,
            difficulty: Number(popped.difficulty)
          },
          hash: popped.blockHash,
          height: disconnectedHeight,
          blockWeight: popped.weight
        });
        this.altBlocks.set(popped.blockHash, altInfo);
      }
    }

    // 5. Remove applied alt blocks from altBlocks
    for (const applied_ of applied) {
      this.altBlocks.delete(applied_.hash);
    }

    // 6. Emit reorg event
    const newHeight = this.chainState.height;
    if (this.onReorg) {
      this.onReorg({
        splitHeight,
        oldHeight,
        newHeight,
        blocksDisconnected: disconnected.length,
        blocksConnected: applied.length
      });
    }

    return true;
  }

  /**
   * Rollback a failed chain switch by re-applying original blocks.
   *
   * Reference: blockchain.cpp rollback_blockchain_switching() lines 1093-1133
   * @private
   *
   * @param {Array} originalBlocks - Popped blocks (newest first from popBlock)
   * @param {number} rollbackHeight - Height to rollback to before re-applying
   */
  _rollbackChainSwitching(originalBlocks, rollbackHeight) {
    // Pop whatever was applied
    this.chainState.rollbackToHeight(rollbackHeight);

    // Re-apply original blocks in order (they were popped newest-first)
    for (let i = originalBlocks.length - 1; i >= 0; i--) {
      const b = originalBlocks[i];
      this.chainState.addBlock(b.timestamp, b.difficulty, b.weight, b.blockHash);
    }
  }

  /**
   * Calculate next difficulty for an alternative chain.
   *
   * Reference: blockchain.cpp get_next_difficulty_for_alternative_chain()
   * @private
   *
   * @param {BlockExtendedInfo[]} altChain - Alt chain blocks
   * @param {number} splitHeight - Split point
   * @param {number[]} timestamps - Combined timestamps
   * @param {bigint[]} cumulativeDifficulties - Combined cumulative difficulties
   * @returns {bigint} Next difficulty for the alt chain
   */
  _getDifficultyForAltChain(altChain, splitHeight, timestamps, cumulativeDifficulties) {
    if (cumulativeDifficulties.length < 2) {
      return 1n;
    }

    // Use the combined timestamps/difficulties from both main and alt chain
    return nextDifficultyV2(timestamps, cumulativeDifficulties);
  }

  /**
   * Remove alt blocks that are too far behind the main chain.
   * Reference: blockchain.cpp purge_old_alt_blocks()
   * @private
   */
  _pruneAltBlocks() {
    const mainHeight = this.chainState.height;
    const maxAge = CRYPTONOTE_MEMPOOL_TX_FROM_ALT_BLOCK_LIVETIME / DIFFICULTY_TARGET_V2;

    for (const [hash, altBlock] of this.altBlocks) {
      if (mainHeight - altBlock.height > maxAge) {
        this.altBlocks.delete(hash);
      }
    }
  }

  /**
   * Check if a given hash is known as a block (main or alt chain).
   * @param {string} hash - Block hash
   * @returns {boolean}
   */
  isKnownBlock(hash) {
    return this.chainState.findBlockByHash(hash) >= 0 || this.altBlocks.has(hash);
  }

  /**
   * Get the number of alternative blocks stored.
   * @returns {number}
   */
  getAltBlockCount() {
    return this.altBlocks.size;
  }

  /**
   * Flush all alternative blocks.
   */
  flushAltBlocks() {
    this.altBlocks.clear();
  }

  /**
   * Flush all invalid block hashes.
   */
  flushInvalidBlocks() {
    this.invalidBlocks.clear();
  }
}

// =============================================================================
// DEFAULT EXPORT
// =============================================================================

export default {
  BlockExtendedInfo,
  BlockVerificationContext,
  AlternativeChainManager
};
