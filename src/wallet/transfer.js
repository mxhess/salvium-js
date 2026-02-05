/**
 * High-Level Transfer, Sweep & Stake Functions
 *
 * Orchestrates the full transaction lifecycle:
 *   UTXO selection → input preparation → TX build → serialize → broadcast
 *
 * Reference: Salvium src/wallet/wallet2.cpp create_transactions_2()
 */

import { parseAddress, hexToBytes, bytesToHex } from '../address.js';
import {
  buildTransaction, buildStakeTransaction, buildBurnTransaction, buildConvertTransaction,
  prepareInputs, estimateTransactionFee,
  selectUTXOs, serializeTransaction, TX_TYPE, DEFAULT_RING_SIZE
} from '../transaction.js';
import { getNetworkConfig, NETWORK_ID, getActiveAssetType, isCarrotActive } from '../consensus.js';
import {
  generateKeyDerivation, deriveSecretKey, scalarAdd
} from '../crypto/index.js';
import { cnSubaddressSecretKey } from '../subaddress.js';
import { deriveOnetimeExtensionG } from '../carrot-scanning.js';

/**
 * Derive the output secret key needed for spending.
 *
 * For CryptoNote outputs: x = k_s + H_s(derivation || i)
 * For CARROT outputs: x = k_gi + sender_extension_g
 *   where sender_extension_g = H_n("Carrot key extension G", s_sr_ctx, C_a)
 *
 * @param {Object} output - WalletOutput with txPubKey, outputIndex, isCarrot, etc.
 * @param {Object} keys - Wallet keys { viewSecretKey, spendSecretKey }
 * @param {Object} [carrotKeys] - CARROT keys { generateImageKey } (for CARROT outputs)
 * @returns {Uint8Array} Output secret key
 */
function deriveOutputSecretKey(output, keys, carrotKeys = null) {
  // CARROT outputs use a different derivation
  if (output.isCarrot) {
    if (!carrotKeys?.generateImageKey) {
      throw new Error('CARROT output requires carrotKeys.generateImageKey for spending');
    }
    if (!output.carrotSharedSecret) {
      throw new Error('CARROT output requires carrotSharedSecret for spending');
    }
    if (!output.commitment) {
      throw new Error('CARROT output requires commitment for spending');
    }

    // Get k_gi (generate-image key)
    const kGi = typeof carrotKeys.generateImageKey === 'string'
      ? hexToBytes(carrotKeys.generateImageKey) : carrotKeys.generateImageKey;

    // Get s_sr_ctx (shared secret) and C_a (commitment)
    const sharedSecret = typeof output.carrotSharedSecret === 'string'
      ? hexToBytes(output.carrotSharedSecret) : output.carrotSharedSecret;
    const commitment = typeof output.commitment === 'string'
      ? hexToBytes(output.commitment) : output.commitment;

    // Compute sender_extension_g = H_n("Carrot key extension G", s_sr_ctx, C_a)
    // For main address (0,0): output_secret_key = k_gi + sender_extension_g
    // For subaddresses: output_secret_key = k_gi * k_subscal + sender_extension_g
    const sub = output.subaddressIndex;
    let outputSecretKey;

    if (sub && (sub.major !== 0 || sub.minor !== 0)) {
      // Subaddress: need to multiply k_gi by subaddress scalar
      // For now, throw - subaddress spending needs more implementation
      throw new Error('CARROT subaddress spending not yet implemented');
    } else {
      // Main address: x = k_gi + sender_extension_g
      const senderExtG = deriveOnetimeExtensionG(sharedSecret, commitment);
      outputSecretKey = scalarAdd(kGi, senderExtG);
    }

    return outputSecretKey;
  }

  // CryptoNote (legacy) derivation
  const txPubKey = typeof output.txPubKey === 'string'
    ? hexToBytes(output.txPubKey) : output.txPubKey;
  const viewSecretKey = typeof keys.viewSecretKey === 'string'
    ? hexToBytes(keys.viewSecretKey) : keys.viewSecretKey;
  let spendSecretKey = typeof keys.spendSecretKey === 'string'
    ? hexToBytes(keys.spendSecretKey) : keys.spendSecretKey;

  if (!txPubKey) {
    throw new Error('CryptoNote output requires txPubKey for spending');
  }

  // For subaddresses, compute subaddress secret key
  const sub = output.subaddressIndex;
  if (sub && (sub.major !== 0 || sub.minor !== 0)) {
    const subaddrScalar = cnSubaddressSecretKey(viewSecretKey, sub.major, sub.minor);
    spendSecretKey = scalarAdd(spendSecretKey, subaddrScalar);
  }

  const derivation = generateKeyDerivation(txPubKey, viewSecretKey);
  return deriveSecretKey(derivation, output.outputIndex, spendSecretKey);
}

/**
 * Build a change address with the correct keys for the current hard fork.
 * At CARROT heights (HF10+), uses CARROT keys (K_s, K^0_v).
 * Otherwise uses legacy CN keys.
 *
 * @param {Object} wallet - Wallet object with keys and carrotKeys
 * @param {Object} carrotKeys - Resolved CARROT keys
 * @param {number} height - Current block height
 * @param {string} network - Network name
 * @returns {{ changeAddress: Object, viewSecretKey: string|null }}
 */
function buildChangeAddress(wallet, carrotKeys, height, network) {
  if (carrotKeys?.primaryAddressViewPubkey && isCarrotActive(height, network)) {
    return {
      changeAddress: {
        viewPublicKey: carrotKeys.primaryAddressViewPubkey,
        spendPublicKey: carrotKeys.accountSpendPubkey,
        isSubaddress: false
      },
      carrotViewSecretKey: carrotKeys.viewIncomingKey || null
    };
  }
  return {
    changeAddress: {
      viewPublicKey: wallet.keys.viewPublicKey,
      spendPublicKey: wallet.keys.spendPublicKey,
      isSubaddress: false
    },
    carrotViewSecretKey: null
  };
}

/**
 * Resolve global output indices for a set of outputs.
 *
 * @param {Array<Object>} outputs - WalletOutput objects
 * @param {Object} daemon - DaemonRPC instance
 * @returns {Promise<Map<string, number>>} Map of keyImage → globalIndex
 */
async function resolveGlobalIndices(outputs, daemon) {
  const indices = new Map();

  // Group outputs by txHash to minimize RPC calls
  const byTx = new Map();
  for (const output of outputs) {
    if (output.globalIndex != null) {
      indices.set(output.keyImage, output.globalIndex);
      continue;
    }
    if (!byTx.has(output.txHash)) byTx.set(output.txHash, []);
    byTx.get(output.txHash).push(output);
  }

  for (const [txHash, outs] of byTx) {
    const resp = await daemon.getOutputIndexes(txHash);
    if (!resp.success || !resp.data?.o_indexes) {
      throw new Error(`Failed to get output indexes for tx ${txHash}`);
    }
    const oIndexes = resp.data.o_indexes;
    const assetTypeIndexes = resp.data.asset_type_output_indices || [];
    for (const out of outs) {
      if (out.outputIndex < oIndexes.length) {
        const gi = Number(oIndexes[out.outputIndex]);
        indices.set(out.keyImage, gi);
        out.globalIndex = gi;
        if (out.outputIndex < assetTypeIndexes.length) {
          out.assetTypeIndex = Number(assetTypeIndexes[out.outputIndex]);
        }
      }
    }
  }

  return indices;
}

/**
 * Transfer SAL to one or more destinations.
 *
 * @param {Object} params
 * @param {Object} params.wallet - WalletSync instance (has storage + keys)
 * @param {Object} params.daemon - DaemonRPC instance
 * @param {Array<{address: string, amount: bigint}>} params.destinations - Where to send
 * @param {Object} [params.options]
 * @param {string} [params.options.priority='default'] - Fee priority
 * @param {boolean} [params.options.subtractFeeFromAmount=false] - Deduct fee from first destination
 * @param {string} [params.options.assetType='SAL'] - Asset type to send
 * @param {boolean} [params.options.dryRun=false] - Build TX but don't broadcast
 * @returns {Promise<{txHash: string, fee: bigint, tx: Object}>}
 */
export async function transfer({ wallet, daemon, destinations, options = {} }) {
  const {
    priority = 'default',
    subtractFeeFromAmount = false,
    assetType: assetTypeOpt,
    dryRun = false
  } = options;

  if (!destinations || destinations.length === 0) {
    throw new Error('At least one destination is required');
  }

  // 1. Parse destination addresses
  const parsedDests = destinations.map(d => {
    const parsed = parseAddress(d.address);
    if (!parsed.valid) {
      throw new Error(`Invalid address: ${d.address} — ${parsed.error}`);
    }
    return {
      viewPublicKey: parsed.viewPublicKey,
      spendPublicKey: parsed.spendPublicKey,
      isSubaddress: parsed.type === 'subaddress',
      amount: typeof d.amount === 'bigint' ? d.amount : BigInt(d.amount)
    };
  });

  // 2. Calculate total send amount
  let totalSend = 0n;
  for (const d of parsedDests) totalSend += d.amount;

  // 3. Get current height for spendability check
  const infoResp = await daemon.getInfo();
  if (!infoResp.success) throw new Error('Failed to get daemon info');
  const currentHeight = infoResp.result?.height || infoResp.data?.height;

  // 4. Get spendable outputs — use HF-based asset type if not specified
  const assetType = assetTypeOpt || getActiveAssetType(currentHeight, options.network);
  const allOutputs = await wallet.storage.getOutputs({
    isSpent: false,
    isFrozen: false,
    assetType
  });
  const spendable = allOutputs.filter(o => {
    if (!o.isSpendable(currentHeight)) return false;
    // CARROT outputs need carrotSharedSecret and commitment for spending
    if (o.isCarrot && (!o.carrotSharedSecret || !o.commitment)) return false;
    return true;
  });

  if (spendable.length === 0) {
    throw new Error('No spendable outputs available');
  }

  // 5. Initial fee estimate (2 outputs: dest + change)
  let estimatedFee = estimateTransactionFee(
    2, // guess 2 inputs initially
    parsedDests.length + 1, // destinations + change
    { priority }
  );

  // 6. Select UTXOs
  const target = subtractFeeFromAmount ? totalSend : totalSend + estimatedFee;
  const selection = selectUTXOs(
    spendable.map(o => ({
      amount: o.amount,
      globalIndex: o.globalIndex,
      keyImage: o.keyImage,
      _output: o
    })),
    target,
    estimatedFee / 2n, // rough per-input fee
    { currentHeight }
  );

  if (!selection.selected || selection.selected.length === 0) {
    throw new Error(`Insufficient balance. Need ${target}, have ${spendable.reduce((s, o) => s + o.amount, 0n)}`);
  }

  // 7. Recalculate fee with actual input count
  estimatedFee = estimateTransactionFee(
    selection.selected.length,
    parsedDests.length + (selection.changeAmount > 0n ? 1 : 0),
    { priority }
  );

  // Adjust amounts if subtracting fee
  if (subtractFeeFromAmount) {
    parsedDests[0].amount -= estimatedFee;
    if (parsedDests[0].amount <= 0n) {
      throw new Error('Amount too small to cover fee');
    }
  }

  // 8. Resolve global indices for selected outputs
  const selectedOutputs = selection.selected.map(s => s._output);
  await resolveGlobalIndices(selectedOutputs, daemon);

  // 9. Derive output secret keys for each input
  // For coinbase outputs (no RCT), mask = identity scalar (1), commitment = zeroCommit(amount)
  const IDENTITY_MASK = '0100000000000000000000000000000000000000000000000000000000000000';
  const { commit: pedersenCommit } = await import('../transaction/serialization.js');

  // Resolve carrot keys from wallet structure
  const carrotKeys = wallet.carrotKeys || wallet.keys?.carrotKeys || wallet.keys;

  const ownedForPrep = selectedOutputs.map((o, idx) => {
    let mask = o.mask;
    let commitment = o.commitment;

    // Coinbase outputs have no RCT mask — use identity
    if (!mask) {
      mask = IDENTITY_MASK;
      commitment = bytesToHex(pedersenCommit(o.amount, hexToBytes(IDENTITY_MASK)));
    }

    return {
      secretKey: deriveOutputSecretKey(o, wallet.keys, carrotKeys),
      publicKey: o.publicKey,
      amount: o.amount,
      mask,
      globalIndex: o.globalIndex,
      assetTypeIndex: o.assetTypeIndex,
      commitment
    };
  });

  // 10. Prepare inputs (fetch decoys from daemon)
  const preparedInputs = await prepareInputs(ownedForPrep, daemon, {
    ringSize: DEFAULT_RING_SIZE,
    assetType
  });

  // 11. Build change address (CARROT-aware)
  const { changeAddress, carrotViewSecretKey } = buildChangeAddress(wallet, carrotKeys, currentHeight, options.network);

  // 12. Build the transaction
  const spendPub = typeof wallet.keys.spendPublicKey === 'string'
    ? hexToBytes(wallet.keys.spendPublicKey) : wallet.keys.spendPublicKey;
  const viewPub = typeof wallet.keys.viewPublicKey === 'string'
    ? hexToBytes(wallet.keys.viewPublicKey) : wallet.keys.viewPublicKey;

  const tx = buildTransaction(
    {
      inputs: preparedInputs,
      destinations: parsedDests,
      changeAddress,
      fee: estimatedFee
    },
    {
      txType: TX_TYPE.TRANSFER,
      sourceAssetType: assetType,
      destinationAssetType: assetType,
      returnAddress: spendPub,
      returnPubkey: viewPub,
      height: currentHeight,
      network: options.network,
      viewSecretKey: carrotViewSecretKey
    }
  );

  // 13. Serialize
  const serialized = serializeTransaction(tx);
  const txHex = bytesToHex(serialized);

  // 14. Broadcast
  if (!dryRun) {
    const sendResp = await daemon.sendRawTransaction(txHex, { source_asset_type: assetType });
    if (!sendResp.success) {
      throw new Error(`Failed to broadcast: ${JSON.stringify(sendResp)}`);
    }
    const respData = sendResp.result || sendResp.data?.result || sendResp.data;
    if (respData?.status !== 'OK') {
      const reason = respData?.reason || respData?.status || 'unknown';
      throw new Error(`Transaction rejected: ${reason}`);
    }
  }

  // 15. Compute TX hash
  const { keccak256 } = await import('../crypto/index.js');
  const txHash = bytesToHex(keccak256(serialized));

  // Collect spent key images for caller to mark as spent
  const spentKeyImages = selection.selected.map(u => u.keyImage);

  return {
    txHash,
    fee: estimatedFee,
    tx,
    serializedHex: txHex,
    inputCount: preparedInputs.length,
    outputCount: tx.prefix.vout.length,
    spentKeyImages
  };
}

/**
 * Sweep all spendable outputs to a single destination.
 *
 * @param {Object} params
 * @param {Object} params.wallet - WalletSync instance
 * @param {Object} params.daemon - DaemonRPC instance
 * @param {string} params.address - Destination address
 * @param {Object} [params.options]
 * @param {string} [params.options.priority='default'] - Fee priority
 * @param {string} [params.options.assetType='SAL'] - Asset type
 * @param {boolean} [params.options.dryRun=false] - Build TX but don't broadcast
 * @returns {Promise<{txHash: string, fee: bigint, amount: bigint, tx: Object}>}
 */
export async function sweep({ wallet, daemon, address, options = {} }) {
  const {
    priority = 'default',
    assetType: assetTypeOpt,
    dryRun = false
  } = options;

  // Parse destination
  const parsed = parseAddress(address);
  if (!parsed.valid) {
    throw new Error(`Invalid address: ${address} — ${parsed.error}`);
  }

  // Get current height
  const infoResp = await daemon.getInfo();
  if (!infoResp.success) throw new Error('Failed to get daemon info');
  const currentHeight = infoResp.result?.height || infoResp.data?.height;

  // Use HF-based asset type detection (like C++ wallet2)
  const assetType = assetTypeOpt || getActiveAssetType(currentHeight, options.network);

  // Get all spendable outputs
  const allOutputs = await wallet.storage.getOutputs({
    isSpent: false,
    isFrozen: false,
    assetType
  });
  let spendable = allOutputs.filter(o => {
    if (!o.isSpendable(currentHeight)) return false;
    if (o.isCarrot && (!o.carrotSharedSecret || !o.commitment)) return false;
    return true;
  });

  if (spendable.length === 0) {
    throw new Error('No spendable outputs available');
  }

  // Limit inputs to avoid exceeding max tx weight (149400 bytes)
  // Each TCLSAG input adds ~2KB, so max ~60 inputs safely
  const MAX_SWEEP_INPUTS = 60;
  if (spendable.length > MAX_SWEEP_INPUTS) {
    // Sort by amount descending to sweep largest first
    spendable.sort((a, b) => b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0);
    spendable = spendable.slice(0, MAX_SWEEP_INPUTS);
  }

  let totalAmount = 0n;
  for (const o of spendable) totalAmount += o.amount;

  // Estimate fee with all inputs, 1 output (no change for sweep)
  const estimatedFee = estimateTransactionFee(
    spendable.length,
    1, // single output, no change
    { priority }
  );

  const sendAmount = totalAmount - estimatedFee;
  if (sendAmount <= 0n) {
    throw new Error(`Total balance ${totalAmount} is too small to cover fee ${estimatedFee}`);
  }

  // Resolve global indices
  await resolveGlobalIndices(spendable, daemon);

  // Derive secret keys
  const IDENTITY_MASK = '0100000000000000000000000000000000000000000000000000000000000000';
  const { commit: pedersenCommit } = await import('../transaction/serialization.js');

  const sweepCarrotKeys = wallet.carrotKeys || wallet.keys?.carrotKeys || wallet.keys;

  const ownedForPrep = spendable.map(o => {
    let mask = o.mask;
    let commitment = o.commitment;

    // Coinbase outputs have no RCT mask — use identity
    if (!mask) {
      mask = IDENTITY_MASK;
      commitment = bytesToHex(pedersenCommit(o.amount, hexToBytes(IDENTITY_MASK)));
    }

    return {
      secretKey: deriveOutputSecretKey(o, wallet.keys, sweepCarrotKeys),
      publicKey: o.publicKey,
      amount: o.amount,
      mask,
      globalIndex: o.globalIndex,
      assetTypeIndex: o.assetTypeIndex,
      commitment
    };
  });

  // Prepare inputs
  const preparedInputs = await prepareInputs(ownedForPrep, daemon, {
    ringSize: DEFAULT_RING_SIZE,
    assetType
  });

  // Build TX (no change output)
  const sweepSpendPub = typeof wallet.keys.spendPublicKey === 'string'
    ? hexToBytes(wallet.keys.spendPublicKey) : wallet.keys.spendPublicKey;
  const sweepViewPub = typeof wallet.keys.viewPublicKey === 'string'
    ? hexToBytes(wallet.keys.viewPublicKey) : wallet.keys.viewPublicKey;
  const tx = buildTransaction(
    {
      inputs: preparedInputs,
      destinations: [{
        viewPublicKey: parsed.viewPublicKey,
        spendPublicKey: parsed.spendPublicKey,
        isSubaddress: parsed.type === 'subaddress',
        amount: sendAmount
      }],
      changeAddress: null,
      fee: estimatedFee
    },
    {
      txType: TX_TYPE.TRANSFER,
      sourceAssetType: assetType,
      destinationAssetType: assetType,
      returnAddress: sweepSpendPub,
      returnPubkey: sweepViewPub,
      height: currentHeight,
      network: options.network
    }
  );

  // Serialize and broadcast
  const serialized = serializeTransaction(tx);
  const txHex = bytesToHex(serialized);

  if (!dryRun) {
    const sendResp = await daemon.sendRawTransaction(txHex, { source_asset_type: assetType });
    if (!sendResp.success) {
      throw new Error(`Failed to broadcast: ${JSON.stringify(sendResp.error || sendResp.data)}`);
    }
    const respData = sendResp.result || sendResp.data?.result || sendResp.data;
    if (respData?.status !== 'OK') {
      const reason = respData?.reason || respData?.status || 'unknown';
      throw new Error(`Transaction rejected: ${reason}`);
    }
  }

  const { keccak256 } = await import('../crypto/index.js');
  const txHash = bytesToHex(keccak256(serialized));

  return {
    txHash,
    fee: estimatedFee,
    amount: sendAmount,
    tx,
    serializedHex: txHex,
    inputCount: preparedInputs.length
  };
}

/**
 * Stake SAL to earn yield from conversion slippage.
 *
 * Locks funds for STAKE_LOCK_PERIOD blocks. After maturity, a protocol_tx
 * returns the original stake + accumulated yield to the return address.
 *
 * @param {Object} params
 * @param {Object} params.wallet - WalletSync instance (has storage + keys)
 * @param {Object} params.daemon - DaemonRPC instance
 * @param {bigint} params.amount - Amount to stake (atomic units)
 * @param {Object} [params.options]
 * @param {string} [params.options.priority='default'] - Fee priority
 * @param {string} [params.options.assetType='SAL'] - Asset type to stake
 * @param {string} [params.options.network='mainnet'] - Network for lock period
 * @param {boolean} [params.options.dryRun=false] - Build TX but don't broadcast
 * @returns {Promise<{txHash: string, fee: bigint, stakeAmount: bigint, lockPeriod: number, tx: Object}>}
 */
export async function stake({ wallet, daemon, amount, options = {} }) {
  const {
    priority = 'default',
    assetType: assetTypeOpt,
    network = 'mainnet',
    dryRun = false
  } = options;

  const stakeAmount = typeof amount === 'bigint' ? amount : BigInt(amount);
  if (stakeAmount <= 0n) {
    throw new Error('Stake amount must be positive');
  }

  // Resolve string network names to numeric NETWORK_ID
  const NETWORK_NAME_MAP = { mainnet: NETWORK_ID.MAINNET, testnet: NETWORK_ID.TESTNET, stagenet: NETWORK_ID.STAGENET };
  const networkId = typeof network === 'string' ? (NETWORK_NAME_MAP[network] ?? network) : network;
  const networkConfig = getNetworkConfig(networkId);
  const stakeLockPeriod = networkConfig.STAKE_LOCK_PERIOD;

  // 1. Get current height
  const infoResp = await daemon.getInfo();
  if (!infoResp.success) throw new Error('Failed to get daemon info');
  const currentHeight = infoResp.result?.height || infoResp.data?.height;

  // 2. Use HF-based asset type detection (like C++ wallet2)
  const assetType = assetTypeOpt || getActiveAssetType(currentHeight, network);

  // 3. Get spendable outputs
  const allOutputs = await wallet.storage.getOutputs({
    isSpent: false,
    isFrozen: false,
    assetType
  });
  const spendable = allOutputs.filter(o => {
    if (!o.isSpendable(currentHeight)) return false;
    if (o.isCarrot && (!o.carrotSharedSecret || !o.commitment)) return false;
    return true;
  });

  if (spendable.length === 0) {
    throw new Error('No spendable outputs available');
  }

  // 3. Estimate fee (inputs + 1 change output, no payment outputs)
  let estimatedFee = estimateTransactionFee(
    2, // guess 2 inputs
    1, // change only
    { priority }
  );

  // 4. Select UTXOs
  const target = stakeAmount + estimatedFee;
  const selection = selectUTXOs(
    spendable.map(o => ({
      amount: o.amount,
      globalIndex: o.globalIndex,
      keyImage: o.keyImage,
      _output: o
    })),
    target,
    estimatedFee / 2n,
    { currentHeight }
  );

  if (!selection.selected || selection.selected.length === 0) {
    throw new Error(`Insufficient balance. Need ${target}, have ${spendable.reduce((s, o) => s + o.amount, 0n)}`);
  }

  // 5. Recalculate fee with actual input count
  estimatedFee = estimateTransactionFee(
    selection.selected.length,
    selection.changeAmount > 0n ? 1 : 0,
    { priority }
  );

  // 6. Resolve global indices
  const selectedOutputs = selection.selected.map(s => s._output);
  await resolveGlobalIndices(selectedOutputs, daemon);

  // 7. Derive output secret keys
  const IDENTITY_MASK = '0100000000000000000000000000000000000000000000000000000000000000';
  const { commit: pedersenCommit } = await import('../transaction/serialization.js');
  const stakeCarrotKeys = wallet.carrotKeys || wallet.keys?.carrotKeys || wallet.keys;

  const ownedForPrep = selectedOutputs.map(o => {
    let mask = o.mask;
    let commitment = o.commitment;

    if (!mask) {
      mask = IDENTITY_MASK;
      commitment = bytesToHex(pedersenCommit(o.amount, hexToBytes(IDENTITY_MASK)));
    }

    return {
      secretKey: deriveOutputSecretKey(o, wallet.keys, stakeCarrotKeys),
      publicKey: o.publicKey,
      amount: o.amount,
      mask,
      globalIndex: o.globalIndex,
      assetTypeIndex: o.assetTypeIndex,
      commitment
    };
  });

  // 8. Prepare inputs (fetch decoys)
  const preparedInputs = await prepareInputs(ownedForPrep, daemon, {
    ringSize: DEFAULT_RING_SIZE,
    assetType
  });

  // 9. Return address = wallet's own address (stake returns here)
  // For CARROT heights, use CARROT keys
  const { changeAddress: stakeReturnAddress, carrotViewSecretKey: stakeViewKey } = buildChangeAddress(wallet, stakeCarrotKeys, currentHeight, network);

  // 10. Build stake transaction
  const tx = buildStakeTransaction(
    {
      inputs: preparedInputs,
      stakeAmount,
      returnAddress: stakeReturnAddress,
      fee: estimatedFee
    },
    {
      stakeLockPeriod,
      assetType,
      height: currentHeight,
      network,
      viewSecretKey: stakeViewKey
    }
  );

  // 11. Serialize
  const serialized = serializeTransaction(tx);
  const txHex = bytesToHex(serialized);

  // 12. Broadcast
  if (!dryRun) {
    const sendResp = await daemon.sendRawTransaction(txHex, { source_asset_type: assetType });
    if (!sendResp.success) {
      throw new Error(`Failed to broadcast: ${JSON.stringify(sendResp.error || sendResp.data)}`);
    }
    const respData = sendResp.result || sendResp.data?.result || sendResp.data;
    if (respData?.status !== 'OK') {
      const reason = respData?.reason || respData?.status || 'unknown';
      throw new Error(`Transaction rejected: ${reason}`);
    }
  }

  // 13. Compute TX hash
  const { keccak256 } = await import('../crypto/index.js');
  const txHash = bytesToHex(keccak256(serialized));

  // Collect spent key images for caller to mark as spent
  const spentKeyImages = selection.selected.map(u => u.keyImage);

  return {
    txHash,
    fee: estimatedFee,
    stakeAmount,
    lockPeriod: stakeLockPeriod,
    tx,
    serializedHex: txHex,
    inputCount: preparedInputs.length,
    outputCount: tx.prefix.vout.length,
    spentKeyImages
  };
}

/**
 * Burn SAL or other assets permanently.
 *
 * BURN transactions destroy coins by sending them to amount_burnt with
 * destination_asset_type = "BURN". The burned amount is permanently removed
 * from circulation.
 *
 * @param {Object} params
 * @param {Object} params.wallet - { keys, storage }
 * @param {Object} params.daemon - DaemonRPC instance
 * @param {bigint|number} params.amount - Amount to burn (atomic units)
 * @param {Object} params.options - { priority, network, dryRun, assetType }
 * @returns {Promise<Object>} { txHash, fee, burnAmount, tx, serializedHex, inputCount, spentKeyImages }
 */
export async function burn({ wallet, daemon, amount, options = {} }) {
  const {
    priority = 'default',
    network = 0,
    dryRun = false,
    assetType: assetTypeOpt = null
  } = options;

  const burnAmount = typeof amount === 'bigint' ? amount : BigInt(amount);

  // Get current height
  const infoResp = await daemon.getInfo();
  if (!infoResp.success) throw new Error('Failed to get daemon info');
  const currentHeight = infoResp.result?.height || infoResp.data?.height;

  // Use HF-based asset type detection
  const assetType = assetTypeOpt || getActiveAssetType(currentHeight, network);

  // Get spendable outputs
  const allOutputs = await wallet.storage.getOutputs({
    isSpent: false,
    isFrozen: false,
    assetType
  });
  const spendable = allOutputs.filter(o => {
    if (!o.isSpendable(currentHeight)) return false;
    if (o.isCarrot && (!o.carrotSharedSecret || !o.commitment)) return false;
    return true;
  });

  if (spendable.length === 0) {
    throw new Error('No spendable outputs available');
  }

  // Estimate fee
  let estimatedFee = estimateTransactionFee(2, 1, { priority });

  // Select UTXOs
  const target = burnAmount + estimatedFee;
  const selection = selectUTXOs(
    spendable.map(o => ({
      amount: o.amount,
      globalIndex: o.globalIndex,
      keyImage: o.keyImage,
      _output: o
    })),
    target,
    estimatedFee / 2n,
    { currentHeight }
  );

  if (!selection.selected || selection.selected.length === 0) {
    throw new Error(`Insufficient balance for burn. Need ${target}, have ${spendable.reduce((s, o) => s + o.amount, 0n)}`);
  }

  // Recalculate fee with actual input count
  estimatedFee = estimateTransactionFee(selection.selected.length, 1, { priority });

  // Resolve global indices
  const selectedOutputs = selection.selected.map(s => s._output);
  await resolveGlobalIndices(selectedOutputs, daemon);

  // Derive secret keys
  const IDENTITY_MASK = '0100000000000000000000000000000000000000000000000000000000000000';
  const { commit: pedersenCommit } = await import('../transaction/serialization.js');
  const burnCarrotKeys = wallet.carrotKeys || wallet.keys?.carrotKeys || wallet.keys;

  const ownedForPrep = selectedOutputs.map(o => {
    let mask = o.mask;
    let commitment = o.commitment;
    if (!mask) {
      mask = IDENTITY_MASK;
      commitment = bytesToHex(pedersenCommit(o.amount, hexToBytes(IDENTITY_MASK)));
    }
    return {
      secretKey: deriveOutputSecretKey(o, wallet.keys, burnCarrotKeys),
      publicKey: o.publicKey,
      amount: o.amount,
      mask,
      globalIndex: o.globalIndex,
      assetTypeIndex: o.assetTypeIndex,
      commitment
    };
  });

  // Prepare inputs (fetch decoys)
  const preparedInputs = await prepareInputs(ownedForPrep, daemon, {
    ringSize: DEFAULT_RING_SIZE,
    assetType
  });

  // Change address (CARROT-aware)
  const { changeAddress, carrotViewSecretKey: burnCarrotViewKey } = buildChangeAddress(wallet, burnCarrotKeys, currentHeight, network);

  // Build burn transaction
  const tx = buildBurnTransaction(
    {
      inputs: preparedInputs,
      burnAmount,
      changeAddress,
      fee: estimatedFee
    },
    {
      assetType,
      height: currentHeight,
      network,
      viewSecretKey: burnCarrotViewKey
    }
  );

  // Serialize
  const serialized = serializeTransaction(tx);
  const txHex = bytesToHex(serialized);

  // Broadcast
  if (!dryRun) {
    const sendResp = await daemon.sendRawTransaction(txHex, { source_asset_type: assetType });
    if (!sendResp.success) {
      throw new Error(`Failed to broadcast: ${JSON.stringify(sendResp.error || sendResp.data)}`);
    }
    const respData = sendResp.result || sendResp.data?.result || sendResp.data;
    if (respData?.status !== 'OK') {
      const reason = respData?.reason || respData?.status || 'unknown';
      throw new Error(`Transaction rejected: ${reason}`);
    }
  }

  const { keccak256 } = await import('../crypto/index.js');
  const txHash = bytesToHex(keccak256(serialized));

  const spentKeyImages = selection.selected.map(u => u.keyImage);

  return {
    txHash,
    fee: estimatedFee,
    burnAmount,
    tx,
    serializedHex: txHex,
    inputCount: preparedInputs.length,
    outputCount: tx.prefix.vout.length,
    spentKeyImages
  };
}

/**
 * Convert between asset types (e.g., SAL to another asset or vice versa).
 *
 * CONVERT transactions enable cross-asset swaps using the protocol's
 * conversion mechanism. A slippage amount is burned/minted based on the
 * conversion rate.
 *
 * @param {Object} params
 * @param {Object} params.wallet - { keys, storage }
 * @param {Object} params.daemon - DaemonRPC instance
 * @param {bigint|number} params.amount - Amount to convert (atomic units)
 * @param {string} params.sourceAssetType - Source asset type (e.g., 'SAL')
 * @param {string} params.destAssetType - Destination asset type
 * @param {string} params.destAddress - Destination address for converted funds
 * @param {Object} params.options - { priority, network, dryRun, slippageTolerance }
 * @returns {Promise<Object>} { txHash, fee, convertAmount, tx, serializedHex, inputCount, spentKeyImages }
 */
export async function convert({ wallet, daemon, amount, sourceAssetType, destAssetType, destAddress, options = {} }) {
  const {
    priority = 'default',
    network = 0,
    dryRun = false,
    slippageTolerance = 0.01 // 1% default slippage tolerance
  } = options;

  const convertAmount = typeof amount === 'bigint' ? amount : BigInt(amount);

  // Parse destination address
  const parsedDest = parseAddress(destAddress);
  if (!parsedDest.valid) {
    throw new Error(`Invalid destination address: ${destAddress} — ${parsedDest.error}`);
  }

  // Get current height
  const infoResp = await daemon.getInfo();
  if (!infoResp.success) throw new Error('Failed to get daemon info');
  const currentHeight = infoResp.result?.height || infoResp.data?.height;

  // Get spendable outputs of source asset type
  const allOutputs = await wallet.storage.getOutputs({
    isSpent: false,
    isFrozen: false,
    assetType: sourceAssetType
  });
  const spendable = allOutputs.filter(o => {
    if (!o.isSpendable(currentHeight)) return false;
    if (o.isCarrot && (!o.carrotSharedSecret || !o.commitment)) return false;
    return true;
  });

  if (spendable.length === 0) {
    throw new Error(`No spendable ${sourceAssetType} outputs available`);
  }

  // Estimate fee
  let estimatedFee = estimateTransactionFee(2, 2, { priority }); // 2 outputs: converted + change

  // Select UTXOs
  const target = convertAmount + estimatedFee;
  const selection = selectUTXOs(
    spendable.map(o => ({
      amount: o.amount,
      globalIndex: o.globalIndex,
      keyImage: o.keyImage,
      _output: o
    })),
    target,
    estimatedFee / 2n,
    { currentHeight }
  );

  if (!selection.selected || selection.selected.length === 0) {
    throw new Error(`Insufficient ${sourceAssetType} balance for convert. Need ${target}, have ${spendable.reduce((s, o) => s + o.amount, 0n)}`);
  }

  // Recalculate fee with actual input count
  estimatedFee = estimateTransactionFee(
    selection.selected.length,
    selection.changeAmount > 0n ? 2 : 1,
    { priority }
  );

  // Resolve global indices
  const selectedOutputs = selection.selected.map(s => s._output);
  await resolveGlobalIndices(selectedOutputs, daemon);

  // Derive secret keys
  const IDENTITY_MASK = '0100000000000000000000000000000000000000000000000000000000000000';
  const { commit: pedersenCommit } = await import('../transaction/serialization.js');
  const convertCarrotKeys = wallet.carrotKeys || wallet.keys?.carrotKeys || wallet.keys;

  const ownedForPrep = selectedOutputs.map(o => {
    let mask = o.mask;
    let commitment = o.commitment;
    if (!mask) {
      mask = IDENTITY_MASK;
      commitment = bytesToHex(pedersenCommit(o.amount, hexToBytes(IDENTITY_MASK)));
    }
    return {
      secretKey: deriveOutputSecretKey(o, wallet.keys, convertCarrotKeys),
      publicKey: o.publicKey,
      amount: o.amount,
      mask,
      globalIndex: o.globalIndex,
      assetTypeIndex: o.assetTypeIndex,
      commitment
    };
  });

  // Prepare inputs (fetch decoys)
  const preparedInputs = await prepareInputs(ownedForPrep, daemon, {
    ringSize: DEFAULT_RING_SIZE,
    assetType: sourceAssetType
  });

  // Change address (CARROT-aware)
  const { changeAddress, carrotViewSecretKey: convertViewKey } = buildChangeAddress(wallet, convertCarrotKeys, currentHeight, network);

  // Destination for converted funds
  const destination = {
    viewPublicKey: parsedDest.viewPublicKey,
    spendPublicKey: parsedDest.spendPublicKey,
    isSubaddress: parsedDest.type === 'subaddress',
    amount: convertAmount
  };

  // Build convert transaction
  const tx = buildConvertTransaction(
    {
      inputs: preparedInputs,
      convertAmount,
      destination,
      changeAddress,
      fee: estimatedFee
    },
    {
      sourceAssetType,
      destAssetType,
      slippageTolerance,
      height: currentHeight,
      network,
      viewSecretKey: convertViewKey
    }
  );

  // Serialize
  const serialized = serializeTransaction(tx);
  const txHex = bytesToHex(serialized);

  // Broadcast
  if (!dryRun) {
    const sendResp = await daemon.sendRawTransaction(txHex, { source_asset_type: sourceAssetType });
    if (!sendResp.success) {
      throw new Error(`Failed to broadcast: ${JSON.stringify(sendResp.error || sendResp.data)}`);
    }
    const respData = sendResp.result || sendResp.data?.result || sendResp.data;
    if (respData?.status !== 'OK') {
      const reason = respData?.reason || respData?.status || 'unknown';
      throw new Error(`Transaction rejected: ${reason}`);
    }
  }

  const { keccak256 } = await import('../crypto/index.js');
  const txHash = bytesToHex(keccak256(serialized));

  const spentKeyImages = selection.selected.map(u => u.keyImage);

  return {
    txHash,
    fee: estimatedFee,
    convertAmount,
    sourceAssetType,
    destAssetType,
    tx,
    serializedHex: txHex,
    inputCount: preparedInputs.length,
    outputCount: tx.prefix.vout.length,
    spentKeyImages
  };
}
