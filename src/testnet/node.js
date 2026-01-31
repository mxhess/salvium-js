/**
 * Testnet Node - In-Memory Blockchain with DaemonRPC-Compatible Interface
 *
 * Provides the same RPC methods that WalletSync calls, backed by an
 * in-memory chain. No network, no disk — just a JavaScript blockchain.
 *
 * @module testnet/node
 */

import { bytesToHex, hexToBytes } from '../address.js';

/**
 * In-memory blockchain node with daemon RPC interface
 */
export class TestnetNode {
  constructor() {
    /** @type {Array<Object>} Blocks in chain order */
    this.blocks = [];

    /** @type {Map<string, Object>} Block lookup by hash */
    this.blocksByHash = new Map();

    /** @type {Map<string, Object>} Transaction lookup by hash */
    this.txsByHash = new Map();

    /** @type {bigint} Running total of generated coins */
    this.totalGeneratedCoins = 0n;

    /** @type {Array<Object>} Pending mempool transactions */
    this.mempool = [];

    /** @type {Array<Object>} Global output index: { key, mask, height, txid, unlocked } */
    this.globalOutputs = [];

    /** @type {Set<string>} Spent key images (hex) */
    this.spentKeyImages = new Set();
  }

  // ===========================================================================
  // Chain Mutation
  // ===========================================================================

  /**
   * Add a mined block to the chain
   *
   * @param {Object} block - Block object (header + miner_tx + protocol_tx)
   * @param {string} blockHash - Block hash (hex)
   * @param {string} minerTxHash - Miner transaction hash (hex)
   * @param {string} protocolTxHash - Protocol transaction hash (hex)
   * @param {Object} txData - Extra tx data for storage
   * @param {bigint} reward - Block reward
   */
  addBlock(block, blockHash, minerTxHash, protocolTxHash, txData, reward) {
    const height = this.blocks.length;

    const entry = {
      height,
      hash: blockHash,
      block,
      minerTxHash,
      protocolTxHash,
      txData: txData || {},
      reward,
      timestamp: block.timestamp || Math.floor(Date.now() / 1000),
    };

    this.blocks.push(entry);
    this.blocksByHash.set(blockHash, entry);
    this.totalGeneratedCoins += reward;

    // Store transactions for lookup
    if (minerTxHash) {
      this.txsByHash.set(minerTxHash, {
        tx: block.miner_tx,
        txHash: minerTxHash,
        blockHeight: height,
        ...txData.minerTx,
      });
    }
    if (protocolTxHash) {
      this.txsByHash.set(protocolTxHash, {
        tx: block.protocol_tx,
        txHash: protocolTxHash,
        blockHeight: height,
        ...txData.protocolTx,
      });
    }

    // Index miner_tx outputs into globalOutputs
    if (block.miner_tx?.outputs) {
      for (const output of block.miner_tx.outputs) {
        const key = typeof output.target === 'string' ? output.target : bytesToHex(output.target);
        // Coinbase outputs have mask = identity (scalar 1)
        const mask = output.commitment || '0100000000000000000000000000000000000000000000000000000000000000';
        this.globalOutputs.push({
          key,
          mask,
          height,
          txid: minerTxHash,
          unlocked: false,
          commitment: output.commitment || null,
        });
      }
    }

    // Index user transaction outputs
    if (entry.txData.userTxs) {
      for (const utx of entry.txData.userTxs) {
        // Record spent key images
        if (utx.keyImages) {
          for (const ki of utx.keyImages) {
            this.spentKeyImages.add(ki);
          }
        }
        // Index outputs
        if (utx.outputs) {
          for (const out of utx.outputs) {
            this.globalOutputs.push({
              key: out.key,
              mask: out.mask || '0100000000000000000000000000000000000000000000000000000000000000',
              height,
              txid: utx.txHash,
              unlocked: false,
              commitment: out.commitment || null,
            });
          }
        }
      }
    }
  }

  getHeight() { return this.blocks.length; }
  getTopBlockHash() { return this.blocks.length > 0 ? this.blocks[this.blocks.length - 1].hash : '0'.repeat(64); }
  getTotalGeneratedCoins() { return this.totalGeneratedCoins; }

  addToMempool(tx) { this.mempool.push(tx); }
  drainMempool() { const txs = this.mempool; this.mempool = []; return txs; }

  // ===========================================================================
  // DaemonRPC-Compatible Interface (what WalletSync calls)
  // ===========================================================================

  async getInfo() {
    return {
      success: true,
      result: {
        height: this.blocks.length,
        top_block_hash: this.getTopBlockHash(),
        status: 'OK',
      },
    };
  }

  async getBlockHeaderByHeight(height) {
    if (height < 0 || height >= this.blocks.length) {
      return { success: false, error: { message: `Block ${height} not found` } };
    }
    const entry = this.blocks[height];
    return {
      success: true,
      result: {
        block_header: {
          height: entry.height,
          hash: entry.hash,
          timestamp: entry.timestamp,
          major_version: entry.block.major_version || 1,
          minor_version: entry.block.minor_version || 0,
          reward: Number(entry.reward),
        },
      },
    };
  }

  async getBlockHeadersRange(startHeight, endHeight) {
    const headers = [];
    for (let h = startHeight; h <= endHeight && h < this.blocks.length; h++) {
      const entry = this.blocks[h];
      headers.push({
        height: entry.height,
        hash: entry.hash,
        timestamp: entry.timestamp,
        major_version: entry.block.major_version || 1,
        minor_version: entry.block.minor_version || 0,
        reward: Number(entry.reward),
      });
    }
    return { success: true, result: { headers } };
  }

  async getBlock(opts) {
    const height = opts.height;
    if (height < 0 || height >= this.blocks.length) {
      return { success: false, error: { message: `Block ${height} not found` } };
    }

    const entry = this.blocks[height];
    const block = entry.block;

    // Build the JSON representation that WalletSync._processBlock expects
    const txHashes = (block.tx_hashes || []).map(h =>
      typeof h === 'string' ? h : bytesToHex(h)
    );
    const blockJson = {
      miner_tx: this._txToJson(block.miner_tx, entry.txData.minerTx),
      tx_hashes: txHashes,
    };
    if (block.protocol_tx) {
      blockJson.protocol_tx = this._txToJson(block.protocol_tx, entry.txData.protocolTx);
    }

    return {
      success: true,
      result: {
        json: JSON.stringify(blockJson),
        miner_tx_hash: entry.minerTxHash,
        protocol_tx_hash: entry.protocolTxHash,
      },
    };
  }

  async getBlocksByHeight(heights) {
    const blocks = [];
    for (const h of heights) {
      if (h >= 0 && h < this.blocks.length) {
        const entry = this.blocks[h];
        const block = entry.block;
        const txHashesHex = (block.tx_hashes || []).map(h =>
          typeof h === 'string' ? h : bytesToHex(h)
        );
        const blockJson = {
          miner_tx: this._txToJson(block.miner_tx, entry.txData.minerTx),
          tx_hashes: txHashesHex,
        };
        if (block.protocol_tx) {
          blockJson.protocol_tx = this._txToJson(block.protocol_tx, entry.txData.protocolTx);
        }
        blocks.push({
          block: '', // hex blob not needed since we provide json
          json: JSON.stringify(blockJson),
          miner_tx_hash: entry.minerTxHash,
          protocol_tx_hash: entry.protocolTxHash,
          txs: [],
        });
      }
    }
    return { success: true, result: { blocks } };
  }

  async getTransactions(hashes, opts) {
    const txs = [];
    for (const hash of hashes) {
      const stored = this.txsByHash.get(hash);
      if (stored) {
        // Determine if this is a user TX (from buildTransaction) or internal TX
        let txJson;
        if (stored.tx?.prefix) {
          // User transaction from buildTransaction()
          txJson = this._userTxToJson(stored.tx);
        } else {
          // Internal TX (miner/protocol)
          txJson = this._txToJson(stored.tx, stored);
        }
        txs.push({
          tx_hash: hash,
          as_json: JSON.stringify(txJson),
        });
      }
    }
    return { success: true, result: { txs } };
  }

  async getTransactionPool() {
    return { success: true, result: { transactions: [] } };
  }

  // ===========================================================================
  // Transaction Sending RPC Methods
  // ===========================================================================

  /**
   * Get output keys and masks by global index (for ring member fetching)
   * Matches daemon.getOuts() signature
   */
  async getOuts({ outputs, get_txid = false }) {
    const outs = [];
    for (const req of outputs) {
      const idx = req.index;
      if (idx >= 0 && idx < this.globalOutputs.length) {
        const o = this.globalOutputs[idx];
        const entry = {
          key: o.key,
          mask: o.mask,
          unlocked: true, // Simplified: all outputs available as ring members
          height: o.height,
        };
        if (get_txid) entry.txid = o.txid;
        outs.push(entry);
      } else {
        outs.push({ key: '0'.repeat(64), mask: '0'.repeat(64), unlocked: false, height: 0 });
      }
    }
    return { outs };
  }

  /**
   * Get output distribution (cumulative output counts per block)
   * Used by GammaPicker for decoy selection
   */
  async getOutputDistribution(amounts = [0], options = {}) {
    // Build cumulative output count per block height
    const distribution = [];
    let cumulative = 0;
    for (let h = 0; h < this.blocks.length; h++) {
      // Count outputs added at this height
      const outputsAtHeight = this.globalOutputs.filter(o => o.height === h).length;
      cumulative += outputsAtHeight;
      distribution.push(cumulative);
    }

    return {
      distributions: [{
        amount: 0,
        start_height: 0,
        base: 0,
        distribution,
      }],
    };
  }

  /**
   * Get output histogram (alternative format used by prepareInputs)
   */
  async getOutputHistogram({ amounts = [0] } = {}) {
    const dist = await this.getOutputDistribution(amounts);
    return {
      histogram: [{
        amount: 0,
        recent_outputs_offsets: dist.distributions[0].distribution,
      }],
    };
  }

  /**
   * Submit a raw transaction to the mempool
   * For testnet, accepts tx object directly (no hex serialization needed)
   */
  async sendRawTransaction(txOrHex, options = {}) {
    const tx = typeof txOrHex === 'string' ? JSON.parse(txOrHex) : txOrHex;

    // Validate key images not already spent
    const keyImages = tx._meta?.keyImages || [];
    for (const ki of keyImages) {
      if (this.spentKeyImages.has(ki)) {
        return {
          success: false,
          error: { message: `Double spend: key image ${ki.slice(0, 16)}... already spent` },
        };
      }
    }

    this.mempool.push(tx);
    return { success: true, result: { status: 'OK' } };
  }

  /**
   * Check if key images are spent
   */
  async isKeyImageSpent(keyImages) {
    const spentStatus = keyImages.map(ki => this.spentKeyImages.has(ki) ? 1 : 0);
    return { spent_status: spentStatus };
  }

  /**
   * Get the global output index for an output by txHash and outputIndex
   */
  getGlobalIndex(txHash, outputIndex) {
    let idx = 0;
    for (const o of this.globalOutputs) {
      if (o.txid === txHash) {
        if (outputIndex === 0) return idx;
        outputIndex--;
      }
      idx++;
    }
    return -1;
  }

  // ===========================================================================
  // Internal: Convert internal tx format to JSON format WalletSync expects
  // ===========================================================================

  /**
   * Convert a buildTransaction() output to JSON format for wallet scanning
   */
  _userTxToJson(tx) {
    if (!tx || !tx.prefix) return null;

    const prefix = tx.prefix;
    const json = {
      version: prefix.version,
      unlock_time: Number(prefix.unlockTime || 0),
      vin: (prefix.vin || []).map(input => {
        if (input.type === 'gen' || input.type === 0xff) {
          return { gen: { height: input.height || 0 } };
        }
        return {
          key: {
            amount: Number(input.amount || 0),
            key_offsets: (input.keyOffsets || []).map(Number),
            k_image: typeof input.keyImage === 'string'
              ? input.keyImage
              : bytesToHex(input.keyImage),
          },
        };
      }),
      vout: (prefix.vout || []).map(output => ({
        amount: 0, // RingCT: always 0
        target: {
          key: typeof output.target === 'string' ? output.target : bytesToHex(output.target),
        },
      })),
      extra: [],
      rct_signatures: {
        type: tx.rct?.type || 0,
        txnFee: Number(tx.rct?.fee || 0),
        ecdhInfo: (tx.rct?.ecdhInfo || []).map(e =>
          typeof e === 'string' ? { amount: e } : e
        ),
        outPk: tx.rct?.outPk || [],
      },
    };

    // Extra: tx pubkey
    if (prefix.extra?.txPubKey) {
      const pkHex = typeof prefix.extra.txPubKey === 'string'
        ? prefix.extra.txPubKey : bytesToHex(prefix.extra.txPubKey);
      const pkBytes = hexToBytes(pkHex);
      json.extra = [0x01, ...pkBytes];
    }

    return json;
  }

  /**
   * Convert a tx object to the JSON representation that WalletSync parses
   *
   * WalletSync expects:
   *   vout[].target.tagged_key.{key, asset_type, view_tag}
   *   extra: [byte array]
   *   rct_signatures: { type }
   */
  _txToJson(tx, extraData = {}) {
    if (!tx) return null;

    const json = {
      version: tx.version,
      unlock_time: Number(tx.unlockTime || 0),
      vin: [],
      vout: [],
      extra: [],
      rct_signatures: { type: tx.rct_signatures?.type ?? 0 },
    };

    // Inputs
    for (const input of (tx.inputs || [])) {
      if (input.type === 'gen') {
        json.vin.push({ gen: { height: input.height } });
      }
    }

    // Outputs
    for (const output of (tx.outputs || [])) {
      const voutEntry = {
        amount: Number(output.amount || 0),
        target: {},
      };

      if (output.isCarrot) {
        // CARROT v1 output: 3-byte view tag, encrypted janus anchor
        const viewTagHex = output.viewTag instanceof Uint8Array
          ? bytesToHex(output.viewTag)
          : (typeof output.viewTag === 'number'
            ? (output.viewTag & 0xff).toString(16).padStart(2, '0')
            : output.viewTag);
        voutEntry.target.carrot_v1 = {
          key: typeof output.target === 'string' ? output.target : bytesToHex(output.target),
          asset_type: 'SAL',
          view_tag: viewTagHex,
          encrypted_janus_anchor: output.anchorEncrypted || '0'.repeat(32),
        };
      } else if (output.viewTag !== undefined) {
        // Tagged key output (legacy with 1-byte view tag)
        const viewTagHex = (output.viewTag & 0xff).toString(16).padStart(2, '0');
        voutEntry.target.tagged_key = {
          key: typeof output.target === 'string' ? output.target : bytesToHex(output.target),
          asset_type: 'SAL',
          view_tag: viewTagHex,
        };
      } else if (output.target) {
        // Regular key output
        voutEntry.target.key = typeof output.target === 'string' ? output.target : bytesToHex(output.target);
      }

      json.vout.push(voutEntry);
    }

    // Extra: convert to byte array
    if (tx.extra?.txPubKey) {
      const pkHex = typeof tx.extra.txPubKey === 'string' ? tx.extra.txPubKey : bytesToHex(tx.extra.txPubKey);
      const pkBytes = hexToBytes(pkHex);
      json.extra = [0x01, ...pkBytes];
    } else if (tx.extra instanceof Uint8Array) {
      json.extra = [...tx.extra];
    }

    return json;
  }
}
