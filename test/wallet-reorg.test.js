/**
 * Wallet Reorg Detection Tests
 *
 * Tests the wallet-level reorg detection and rollback:
 * - Block hash tracking in storage
 * - Reorg detection via hash comparison
 * - Output/transaction invalidation on reorg
 * - Unspending outputs that were spent in orphaned blocks
 */

import { describe, test, expect } from 'bun:test';
import { MemoryStorage, WalletOutput, WalletTransaction } from '../src/wallet-store.js';

describe('MemoryStorage - Block hash tracking', () => {
  test('putBlockHash and getBlockHash', async () => {
    const s = new MemoryStorage();
    await s.open();

    await s.putBlockHash(100, 'abc123');
    expect(await s.getBlockHash(100)).toBe('abc123');
    expect(await s.getBlockHash(101)).toBeNull();
  });

  test('deleteBlockHashesAbove removes hashes above height', async () => {
    const s = new MemoryStorage();
    await s.open();

    for (let i = 0; i < 10; i++) {
      await s.putBlockHash(i, `hash_${i}`);
    }

    await s.deleteBlockHashesAbove(5);

    expect(await s.getBlockHash(5)).toBe('hash_5');
    expect(await s.getBlockHash(6)).toBeNull();
    expect(await s.getBlockHash(9)).toBeNull();
    expect(await s.getBlockHash(0)).toBe('hash_0');
  });
});

describe('MemoryStorage - Reorg rollback operations', () => {
  test('deleteOutputsAbove removes outputs with blockHeight > height', async () => {
    const s = new MemoryStorage();
    await s.open();

    await s.putOutput(new WalletOutput({
      keyImage: 'ki1', blockHeight: 5, amount: 100n
    }));
    await s.putOutput(new WalletOutput({
      keyImage: 'ki2', blockHeight: 10, amount: 200n
    }));
    await s.putOutput(new WalletOutput({
      keyImage: 'ki3', blockHeight: 15, amount: 300n
    }));

    await s.deleteOutputsAbove(10);

    expect(await s.getOutput('ki1')).not.toBeNull();
    expect(await s.getOutput('ki2')).not.toBeNull();
    expect(await s.getOutput('ki3')).toBeNull();
  });

  test('deleteTransactionsAbove removes txs with blockHeight > height', async () => {
    const s = new MemoryStorage();
    await s.open();

    await s.putTransaction(new WalletTransaction({
      txHash: 'tx1', blockHeight: 5
    }));
    await s.putTransaction(new WalletTransaction({
      txHash: 'tx2', blockHeight: 10
    }));
    await s.putTransaction(new WalletTransaction({
      txHash: 'tx3', blockHeight: 15
    }));

    await s.deleteTransactionsAbove(10);

    expect(await s.getTransaction('tx1')).not.toBeNull();
    expect(await s.getTransaction('tx2')).not.toBeNull();
    expect(await s.getTransaction('tx3')).toBeNull();
  });

  test('unspendOutputsAbove restores outputs spent above height', async () => {
    const s = new MemoryStorage();
    await s.open();

    // Output created at height 5, spent at height 12
    await s.putOutput(new WalletOutput({
      keyImage: 'ki_unspend', blockHeight: 5, amount: 500n
    }));
    await s.markOutputSpent('ki_unspend', 'spending_tx', 12);

    // Verify it's spent
    let output = await s.getOutput('ki_unspend');
    expect(output.isSpent).toBe(true);
    expect(output.spentHeight).toBe(12);

    // Reorg at height 10 should unspend it
    await s.unspendOutputsAbove(10);

    output = await s.getOutput('ki_unspend');
    expect(output.isSpent).toBe(false);
    expect(output.spentTxHash).toBeNull();
    expect(output.spentHeight).toBeNull();
  });

  test('unspendOutputsAbove does not affect outputs spent at or below height', async () => {
    const s = new MemoryStorage();
    await s.open();

    await s.putOutput(new WalletOutput({
      keyImage: 'ki_keep_spent', blockHeight: 3, amount: 100n
    }));
    await s.markOutputSpent('ki_keep_spent', 'tx_early', 8);

    await s.unspendOutputsAbove(10);

    const output = await s.getOutput('ki_keep_spent');
    expect(output.isSpent).toBe(true);
    expect(output.spentHeight).toBe(8);
  });

  test('combined reorg rollback scenario', async () => {
    const s = new MemoryStorage();
    await s.open();

    // Setup: outputs and txs across a range of heights
    await s.putOutput(new WalletOutput({ keyImage: 'o1', blockHeight: 50, amount: 1000n }));
    await s.putOutput(new WalletOutput({ keyImage: 'o2', blockHeight: 100, amount: 2000n }));
    await s.putOutput(new WalletOutput({ keyImage: 'o3', blockHeight: 150, amount: 3000n }));
    await s.markOutputSpent('o1', 'tx_spend_o1', 120);

    await s.putTransaction(new WalletTransaction({ txHash: 'tx_a', blockHeight: 80 }));
    await s.putTransaction(new WalletTransaction({ txHash: 'tx_b', blockHeight: 130 }));

    for (let i = 0; i < 200; i++) {
      await s.putBlockHash(i, `hash_${i}`);
    }

    // Simulate reorg at height 100
    const reorgHeight = 100;
    await s.deleteOutputsAbove(reorgHeight);
    await s.deleteTransactionsAbove(reorgHeight);
    await s.unspendOutputsAbove(reorgHeight);
    await s.deleteBlockHashesAbove(reorgHeight);

    // Outputs: o1 (height 50) kept, o2 (height 100) kept, o3 (height 150) deleted
    expect(await s.getOutput('o1')).not.toBeNull();
    expect(await s.getOutput('o2')).not.toBeNull();
    expect(await s.getOutput('o3')).toBeNull();

    // o1 was spent at height 120 (> 100) → should be unspent
    const o1 = await s.getOutput('o1');
    expect(o1.isSpent).toBe(false);

    // Transactions: tx_a (height 80) kept, tx_b (height 130) deleted
    expect(await s.getTransaction('tx_a')).not.toBeNull();
    expect(await s.getTransaction('tx_b')).toBeNull();

    // Block hashes: 0-100 kept, 101+ deleted
    expect(await s.getBlockHash(100)).toBe('hash_100');
    expect(await s.getBlockHash(101)).toBeNull();
  });
});

describe('MemoryStorage - clear includes block hashes', () => {
  test('clear removes block hashes', async () => {
    const s = new MemoryStorage();
    await s.open();

    await s.putBlockHash(1, 'h1');
    await s.putBlockHash(2, 'h2');
    await s.clear();

    expect(await s.getBlockHash(1)).toBeNull();
    expect(await s.getBlockHash(2)).toBeNull();
  });
});
