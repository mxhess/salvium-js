#!/usr/bin/env bun
/**
 * CONVERT Transaction Integration Test
 *
 * Tests creating and broadcasting a CONVERT transaction on a real network.
 *
 * NOTE: CONVERT transactions are currently gated behind hard fork version 255
 * and are not yet enabled on mainnet. This test will build valid transactions
 * but they will be rejected by nodes until the feature is activated.
 *
 * Usage:
 *   WALLET_SEED="your 25 word mnemonic" bun test/convert-integration.test.js
 *
 * Options:
 *   WALLET_SEED     - 25 word mnemonic (required)
 *   CONVERT_AMOUNT  - Amount to convert in SAL (default: 1.0)
 *   SOURCE_ASSET    - Asset to convert from: SAL or VSD (default: SAL)
 *   DEST_ASSET      - Asset to convert to: VSD or SAL (default: VSD)
 *   SLIPPAGE_PCT    - Slippage tolerance percentage (default: 3.125)
 *   DAEMON_URL      - Daemon RPC URL (default: http://seed01.salvium.io:19081)
 *   DRY_RUN         - If "true", build tx but don't broadcast (default: true)
 */

import { createDaemonRPC } from '../src/rpc/index.js';
import { mnemonicToSeed } from '../src/mnemonic.js';
import { deriveKeys, deriveCarrotKeys } from '../src/carrot.js';
import { hexToBytes, bytesToHex, createAddress } from '../src/address.js';
import { NETWORK, ADDRESS_FORMAT, ADDRESS_TYPE } from '../src/constants.js';
import { MemoryStorage } from '../src/wallet-store.js';
import { WalletSync } from '../src/wallet-sync.js';
import { generateCNSubaddressMap, generateCarrotSubaddressMap, SUBADDRESS_LOOKAHEAD_MAJOR, SUBADDRESS_LOOKAHEAD_MINOR } from '../src/subaddress.js';
import { buildConvertTransaction, serializeTransaction, TX_TYPE } from '../src/transaction.js';

// ============================================================================
// Configuration
// ============================================================================

const DAEMON_URL = process.env.DAEMON_URL || 'http://seed01.salvium.io:19081';
const CONVERT_AMOUNT_SAL = parseFloat(process.env.CONVERT_AMOUNT || '1.0');
const CONVERT_AMOUNT = BigInt(Math.floor(CONVERT_AMOUNT_SAL * 1e8)); // Convert to atomic units
const SOURCE_ASSET = process.env.SOURCE_ASSET || 'SAL';
const DEST_ASSET = process.env.DEST_ASSET || 'VSD';
const SLIPPAGE_PCT = parseFloat(process.env.SLIPPAGE_PCT || '3.125');
const DRY_RUN = process.env.DRY_RUN !== 'false'; // Default to dry run for safety
const FEE = 100000000n; // 0.001 SAL fee (standard)

// ============================================================================
// Main
// ============================================================================

async function runConvertIntegrationTest() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          CONVERT Transaction Integration Test              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log('NOTE: CONVERT transactions are currently gated behind HF v255');
  console.log('      and will be REJECTED by nodes until the feature is activated.\n');

  // Validate input
  if (!process.env.WALLET_SEED) {
    console.error('ERROR: WALLET_SEED environment variable required.\n');
    console.log('Usage:');
    console.log('  WALLET_SEED="your 25 word mnemonic" bun test/convert-integration.test.js');
    console.log('');
    console.log('Options:');
    console.log('  CONVERT_AMOUNT=1.0     Amount to convert (default: 1.0)');
    console.log('  SOURCE_ASSET=SAL       Asset to convert from: SAL or VSD (default: SAL)');
    console.log('  DEST_ASSET=VSD         Asset to convert to: VSD or SAL (default: VSD)');
    console.log('  SLIPPAGE_PCT=3.125     Slippage tolerance % (default: 3.125)');
    console.log('  DRY_RUN=true           Build tx but do not broadcast (default: true)');
    process.exit(1);
  }

  // Validate asset types
  const validAssets = ['SAL', 'VSD'];
  if (!validAssets.includes(SOURCE_ASSET) || !validAssets.includes(DEST_ASSET)) {
    console.error(`ERROR: Invalid asset types. Must be SAL or VSD.`);
    process.exit(1);
  }
  if (SOURCE_ASSET === DEST_ASSET) {
    console.error('ERROR: Source and destination assets must be different.');
    process.exit(1);
  }

  // Parse mnemonic
  const mnemonic = process.env.WALLET_SEED.trim();
  const result = mnemonicToSeed(mnemonic, { language: 'auto' });
  if (!result.valid) {
    console.error('Invalid mnemonic:', result.error);
    process.exit(1);
  }

  const keys = deriveKeys(result.seed);
  const carrotKeys = deriveCarrotKeys(keys.spendSecretKey);

  // Calculate slippage limit
  const defaultSlippage = CONVERT_AMOUNT >> 5n; // 3.125%
  const userSlippage = BigInt(Math.floor((Number(CONVERT_AMOUNT) * SLIPPAGE_PCT) / 100));
  const slippageLimit = userSlippage > defaultSlippage ? userSlippage : defaultSlippage;

  console.log('--- Configuration ---');
  console.log(`Daemon URL:      ${DAEMON_URL}`);
  console.log(`Convert:         ${CONVERT_AMOUNT_SAL} ${SOURCE_ASSET} -> ${DEST_ASSET}`);
  console.log(`Slippage limit:  ${Number(slippageLimit) / 1e8} ${SOURCE_ASSET} (${SLIPPAGE_PCT}%)`);
  console.log(`Fee:             ${Number(FEE) / 1e8} SAL`);
  console.log(`Mode:            ${DRY_RUN ? 'DRY RUN (will NOT broadcast)' : 'LIVE (will broadcast!)'}`);

  // Generate wallet address for display
  const mainAddress = createAddress({
    network: NETWORK.MAINNET,
    format: ADDRESS_FORMAT.LEGACY,
    type: ADDRESS_TYPE.STANDARD,
    spendPublicKey: keys.spendPublicKey,
    viewPublicKey: keys.viewPublicKey
  });
  console.log(`Wallet:          ${mainAddress.slice(0, 20)}...${mainAddress.slice(-10)}\n`);

  // Connect to daemon
  console.log('Connecting to daemon...');
  const daemon = createDaemonRPC({ url: DAEMON_URL, timeout: 30000 });

  const info = await daemon.getInfo();
  if (!info.success) {
    console.error('ERROR: Failed to connect to daemon:', info.error?.message);
    process.exit(1);
  }

  const daemonHeight = info.result.height;
  console.log(`Daemon height:   ${daemonHeight}`);
  console.log(`Network:         ${info.result.nettype || 'mainnet'}\n`);

  // Create storage and sync
  console.log('Syncing wallet to find UTXOs...');
  const storage = new MemoryStorage();
  await storage.open();

  // Generate subaddress maps
  const cnSubaddresses = generateCNSubaddressMap(
    keys.spendPublicKey,
    keys.viewSecretKey,
    SUBADDRESS_LOOKAHEAD_MAJOR,
    SUBADDRESS_LOOKAHEAD_MINOR
  );

  const carrotSubaddresses = generateCarrotSubaddressMap(
    hexToBytes(carrotKeys.accountSpendPubkey),
    hexToBytes(carrotKeys.accountViewPubkey),
    hexToBytes(carrotKeys.generateAddressSecret),
    SUBADDRESS_LOOKAHEAD_MAJOR,
    SUBADDRESS_LOOKAHEAD_MINOR
  );

  const carrotKeysForSync = {
    viewIncomingKey: hexToBytes(carrotKeys.viewIncomingKey),
    accountSpendPubkey: hexToBytes(carrotKeys.accountSpendPubkey),
    generateImageKey: hexToBytes(carrotKeys.generateImageKey),
    generateAddressSecret: hexToBytes(carrotKeys.generateAddressSecret)
  };

  const sync = new WalletSync({
    storage,
    daemon,
    keys: {
      viewSecretKey: keys.viewSecretKey,
      spendPublicKey: keys.spendPublicKey,
      spendSecretKey: keys.spendSecretKey
    },
    carrotKeys: carrotKeysForSync,
    subaddresses: cnSubaddresses,
    carrotSubaddresses: carrotSubaddresses,
    batchSize: 100
  });

  // Track sync progress
  let outputsFound = 0;
  sync.on('outputFound', () => outputsFound++);
  sync.on('syncProgress', (data) => {
    if (data.currentHeight % 5000 === 0) {
      console.log(`  Height ${data.currentHeight} (${data.percentComplete.toFixed(1)}%) - ${outputsFound} outputs`);
    }
  });

  const syncStart = Date.now();
  await sync.start(0);
  const syncTime = ((Date.now() - syncStart) / 1000).toFixed(1);

  // Get wallet state
  const outputs = await storage.getOutputs();
  const unspentOutputs = outputs.filter(o => !o.isSpent);
  let balance = 0n;
  for (const o of unspentOutputs) {
    balance += o.amount;
  }

  console.log(`\nSync complete in ${syncTime}s`);
  console.log(`Total outputs:   ${outputs.length}`);
  console.log(`Unspent outputs: ${unspentOutputs.length}`);
  console.log(`Balance:         ${Number(balance) / 1e8} SAL\n`);

  // Check if we have enough funds
  const requiredAmount = CONVERT_AMOUNT + FEE;
  if (balance < requiredAmount) {
    console.error(`ERROR: Insufficient funds. Need ${Number(requiredAmount) / 1e8} ${SOURCE_ASSET}, have ${Number(balance) / 1e8} SAL`);
    await storage.close();
    process.exit(1);
  }

  // Select inputs (simple selection - just use enough outputs)
  console.log('Selecting inputs...');
  const selectedInputs = [];
  let selectedAmount = 0n;

  for (const output of unspentOutputs) {
    if (selectedAmount >= requiredAmount) break;

    // Fetch ring members from daemon
    const ringSize = 11;
    const globalIndex = output.globalIndex || 0;

    // Get ring members (decoys) from the daemon
    const outsResponse = await daemon.getOuts({
      outputs: [{ amount: 0, index: globalIndex }],
      get_txid: true
    });

    if (!outsResponse.success || !outsResponse.result.outs) {
      console.warn(`  Skipping output - couldn't fetch ring data`);
      continue;
    }

    // For a real implementation, we'd fetch proper decoys from the daemon
    // This is simplified - real implementation needs proper decoy selection
    const ring = [];
    const ringCommitments = [];
    const ringIndices = [];

    // Add the real output and generate fake decoys for testing
    // In production, use daemon.getOutputDistribution and proper decoy selection
    for (let i = 0; i < ringSize; i++) {
      if (i === 0) {
        // Real output
        ring.push(output.outputPublicKey);
        ringCommitments.push(output.commitment || output.outputPublicKey);
        ringIndices.push(globalIndex);
      } else {
        // Placeholder - in production, fetch real decoys
        ring.push(output.outputPublicKey);
        ringCommitments.push(output.commitment || output.outputPublicKey);
        ringIndices.push(globalIndex + i);
      }
    }

    selectedInputs.push({
      secretKey: output.outputSecretKey || keys.spendSecretKey,
      publicKey: output.outputPublicKey,
      amount: output.amount,
      mask: output.mask || new Uint8Array(32),
      ring,
      ringCommitments,
      ringIndices,
      realIndex: 0
    });

    selectedAmount += output.amount;
    console.log(`  Selected output: ${Number(output.amount) / 1e8} ${SOURCE_ASSET}`);
  }

  console.log(`Total selected: ${Number(selectedAmount) / 1e8} ${SOURCE_ASSET}\n`);

  if (selectedInputs.length === 0) {
    console.error('ERROR: Could not select any valid inputs');
    await storage.close();
    process.exit(1);
  }

  // Build the CONVERT transaction
  console.log('Building CONVERT transaction...');

  try {
    const tx = buildConvertTransaction(
      {
        inputs: selectedInputs,
        convertAmount: CONVERT_AMOUNT,
        sourceAsset: SOURCE_ASSET,
        destAsset: DEST_ASSET,
        slippageLimit,
        changeAddress: {
          viewPublicKey: keys.viewPublicKey,
          spendPublicKey: keys.spendPublicKey,
          isSubaddress: false
        },
        returnAddress: keys.spendPublicKey,
        returnPubkey: keys.viewPublicKey,
        fee: FEE
      }
    );

    console.log('\n--- Transaction Built ---');
    console.log(`TX Type:             ${tx.prefix.txType} (CONVERT)`);
    console.log(`Convert Amount:      ${Number(tx.prefix.amount_burnt) / 1e8} ${SOURCE_ASSET}`);
    console.log(`Source Asset:        ${tx.prefix.source_asset_type}`);
    console.log(`Destination Asset:   ${tx.prefix.destination_asset_type}`);
    console.log(`Slippage Limit:      ${Number(tx.prefix.amount_slippage_limit) / 1e8} ${SOURCE_ASSET}`);
    console.log(`Inputs:              ${tx.prefix.inputs.length}`);
    console.log(`Outputs:             ${tx.prefix.outputs.length} (change only)`);
    console.log(`CLSAG Signatures:    ${tx.rct?.CLSAGs?.length || 0}`);

    // Serialize for broadcasting
    const txBlob = serializeTransaction(tx);
    const txHex = bytesToHex(txBlob);
    console.log(`Serialized size:     ${txBlob.length} bytes`);
    console.log(`TX Hex (first 100):  ${txHex.slice(0, 100)}...`);

    if (DRY_RUN) {
      console.log('\n[DRY RUN] Transaction NOT broadcast.');
      console.log('To broadcast for real, run with DRY_RUN=false');
      console.log('\nWARNING: CONVERT is gated at HF v255 - this TX would be REJECTED by the network!');
    } else {
      console.log('\nBroadcasting transaction...');
      console.log('WARNING: CONVERT is gated at HF v255 - this TX will likely be REJECTED!');
      const submitResult = await daemon.sendRawTransaction(txHex);

      if (submitResult.success && !submitResult.result.not_relayed) {
        console.log('\n✓ Transaction submitted successfully!');
        console.log(`TX Hash: ${submitResult.result.tx_hash || 'pending'}`);
      } else {
        console.error('\n✗ Transaction failed to submit');
        console.error('Reason:', submitResult.result?.reason || submitResult.error?.message || 'Unknown');
        console.log('\nThis is EXPECTED - CONVERT is not yet enabled on the network.');
      }
    }

  } catch (error) {
    console.error('\nERROR building transaction:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }

  await storage.close();
  console.log('\n✓ Integration test completed!');
}

// Run
runConvertIntegrationTest().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
