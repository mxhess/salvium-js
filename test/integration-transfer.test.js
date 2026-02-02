#!/usr/bin/env bun
/**
 * Integration Test: Transfer & Sweep
 *
 * Tests the full transaction lifecycle between two wallets.
 *
 * Env vars:
 *   DAEMON_URL    - RPC endpoint (default: http://web.whiskymine.io:29081)
 *   WALLET_FILE   - Path to wallet JSON (default: ~/testnet-wallet/wallet.json)
 *   NETWORK       - mainnet|testnet|stagenet (default: testnet)
 *   DRY_RUN       - 1 = build but don't broadcast (default: 1)
 *
 * Usage: bun test/integration-transfer.test.js
 *        DRY_RUN=0 bun test/integration-transfer.test.js
 */

import { DaemonRPC } from '../src/rpc/daemon.js';
import { Wallet } from '../src/wallet.js';
import { createWalletSync } from '../src/wallet-sync.js';
import { MemoryStorage } from '../src/wallet-store.js';
import { transfer, sweep, stake } from '../src/wallet/transfer.js';

const DAEMON_URL = process.env.DAEMON_URL || 'http://web.whiskymine.io:29081';
const WALLET_FILE = process.env.WALLET_FILE || `${process.env.HOME}/testnet-wallet/wallet.json`;
const NETWORK = process.env.NETWORK || 'testnet';
const DRY_RUN = process.env.DRY_RUN !== '0';

let daemon;

async function syncWallet(label, keys) {
  console.log(`Syncing ${label}...`);
  const storage = new MemoryStorage();
  const sync = createWalletSync({
    daemon,
    keys,
    storage,
    network: NETWORK
  });

  await sync.start();

  const infoResp = await daemon.getInfo();
  const currentHeight = infoResp.result?.height || infoResp.data?.height || 0;

  const allOutputs = await storage.getOutputs({ isSpent: false });
  const spendable = allOutputs.filter(o => o.isSpendable(currentHeight));
  let balance = 0n;
  for (const o of allOutputs) balance += o.amount;
  let spendableBalance = 0n;
  for (const o of spendable) spendableBalance += o.amount;

  console.log(`  ${allOutputs.length} unspent (${spendable.length} spendable)`);
  console.log(`  Balance: ${Number(balance) / 1e8} SAL (${Number(spendableBalance) / 1e8} SAL spendable)`);

  return { sync, storage, balance, spendableBalance, outputs: allOutputs, spendable };
}

async function testTransfer(keys, storage, toAddress, amount, label) {
  console.log(`\n--- ${label} ---`);
  console.log(`  Amount: ${Number(amount) / 1e8} SAL`);
  console.log(`  To: ${toAddress.slice(0, 30)}...`);

  try {
    const result = await transfer({
      wallet: { keys, storage },
      daemon,
      destinations: [{ address: toAddress, amount }],
      options: { priority: 'default', dryRun: DRY_RUN }
    });

    console.log(`  TX Hash: ${result.txHash}`);
    console.log(`  Fee: ${Number(result.fee) / 1e8} SAL`);
    console.log(`  Inputs: ${result.inputCount}, Outputs: ${result.outputCount}`);
    console.log(`  Serialized: ${result.serializedHex.length / 2} bytes`);
    console.log(`  ${DRY_RUN ? '(dry run — not broadcast)' : 'BROADCAST OK'}`);
    return result;
  } catch (e) {
    console.error(`  FAILED: ${e.message}`);
    if (e.stack) console.error(e.stack.split('\n').slice(1, 4).join('\n'));
    return null;
  }
}

async function main() {
  console.log('=== Transfer Integration Test ===\n');
  console.log(`Daemon:  ${DAEMON_URL}`);
  console.log(`Network: ${NETWORK}`);
  console.log(`Dry run: ${DRY_RUN}\n`);

  daemon = new DaemonRPC({ url: DAEMON_URL });

  const info = await daemon.getInfo();
  if (!info.success) throw new Error('Cannot reach daemon');
  const height = info.result?.height || info.data?.height;
  console.log(`Daemon height: ${height}\n`);

  // Load wallet A from file
  console.log(`Loading wallet A from ${WALLET_FILE}`);
  const walletAJson = JSON.parse(await Bun.file(WALLET_FILE).text());
  const keysA = {
    viewSecretKey: walletAJson.viewSecretKey,
    spendSecretKey: walletAJson.spendSecretKey,
    viewPublicKey: walletAJson.viewPublicKey,
    spendPublicKey: walletAJson.spendPublicKey,
  };
  console.log(`  Address: ${walletAJson.address}\n`);

  // Create wallet B in memory (not saved)
  const walletB = Wallet.create({ network: NETWORK });
  const keysB = {
    viewSecretKey: walletB.viewSecretKey,
    spendSecretKey: walletB.spendSecretKey,
    viewPublicKey: walletB.viewPublicKey,
    spendPublicKey: walletB.spendPublicKey,
  };
  const addressB = walletB.getAddress();
  console.log(`Wallet B (ephemeral):`);
  console.log(`  Address: ${addressB}\n`);

  // Sync wallet A
  const syncA = await syncWallet('Wallet A', keysA);

  if (syncA.spendableBalance === 0n) {
    console.log('\nWallet A has no spendable balance. Mine more blocks.');
    return;
  }

  // Test 1: Transfer 100 SAL (A → B)
  const amount1 = 10_000_000_000n; // 100 SAL (1 SAL = 1e8 atomic)
  const result1 = await testTransfer(keysA, syncA.storage, addressB, amount1, 'Transfer: 100 SAL (A → B)');

  if (!result1) {
    console.log('\nFirst transfer failed, stopping.');
    return;
  }

  // Test 2: Multiple small transfers to fracture UTXOs
  console.log('\n=== Multiple small transfers (A → B) ===');
  let successCount = 0;
  for (let i = 0; i < 3; i++) {
    const amount = BigInt(Math.floor(Math.random() * 50_00_000_000 + 1_00_000_000)); // 1–51 SAL random
    const result = await testTransfer(keysA, syncA.storage, addressB, amount, `Small transfer ${i + 1}/3`);
    if (result) successCount++;
  }
  console.log(`\n${successCount}/3 transfers succeeded`);

  // Test 3: Stake 500 SAL
  console.log('\n=== Stake Test ===');
  const stakeAmt = 500_00_000_000n; // 500 SAL
  console.log(`\n--- Stake: 500 SAL ---`);
  console.log(`  Lock period: 20 blocks (testnet)`);
  try {
    const stakeResult = await stake({
      wallet: { keys: keysA, storage: syncA.storage },
      daemon,
      amount: stakeAmt,
      options: { priority: 'default', network: NETWORK, dryRun: DRY_RUN }
    });
    console.log(`  TX Hash: ${stakeResult.txHash}`);
    console.log(`  Fee: ${Number(stakeResult.fee) / 1e8} SAL`);
    console.log(`  Staked: ${Number(stakeResult.stakeAmount) / 1e8} SAL`);
    console.log(`  Lock: ${stakeResult.lockPeriod} blocks`);
    console.log(`  Inputs: ${stakeResult.inputCount}, Outputs: ${stakeResult.outputCount}`);
    console.log(`  Serialized: ${stakeResult.serializedHex.length / 2} bytes`);
    console.log(`  ${DRY_RUN ? '(dry run — not broadcast)' : 'BROADCAST OK'}`);
  } catch (e) {
    console.error(`  FAILED: ${e.message}`);
    if (e.stack) console.error(e.stack.split('\n').slice(1, 4).join('\n'));
  }

  console.log('\n=== Test Complete ===');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
