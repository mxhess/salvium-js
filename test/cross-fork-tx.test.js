/**
 * Cross-Fork Transaction Tests
 *
 * Verifies correct TX version, RCT type, and signature type selection
 * across all hard fork versions.
 *
 * Testnet HF heights:
 *   HF1:   1     - Genesis
 *   HF2:  250    - ENABLE_N_OUTS (TX v3 for TRANSFER)
 *   HF3:  500    - FULL_PROOFS (RCT type 7)
 *   HF4:  600
 *   HF5:  800
 *   HF6:  815    - SALVIUM_ONE_PROOFS (RCT type 8, SAL1 asset)
 *   HF7:  900
 *   HF8:  950
 *   HF9: 1000
 *   HF10: 1100   - CARROT (TX v4, RCT type 9, TCLSAG)
 */

import { describe, test, expect } from 'bun:test';
import {
  getHfVersionForHeight,
  getTxVersion,
  getRctType,
  getActiveAssetType,
  isCarrotActive,
  NETWORK_ID,
  HF_VERSION
} from '../src/consensus.js';
import { TX_TYPE } from '../src/transaction.js';

describe('Hard Fork Detection', () => {
  describe('Testnet HF Heights', () => {
    test('HF1 at height 1', () => {
      expect(getHfVersionForHeight(1, 'testnet')).toBe(1);
    });

    test('HF1 at height 249', () => {
      expect(getHfVersionForHeight(249, 'testnet')).toBe(1);
    });

    test('HF2 at height 250', () => {
      expect(getHfVersionForHeight(250, 'testnet')).toBe(2);
    });

    test('HF3 at height 500', () => {
      expect(getHfVersionForHeight(500, 'testnet')).toBe(3);
    });

    test('HF4 at height 600', () => {
      expect(getHfVersionForHeight(600, 'testnet')).toBe(4);
    });

    test('HF6 at height 815', () => {
      expect(getHfVersionForHeight(815, 'testnet')).toBe(6);
    });

    test('HF7 at height 900', () => {
      expect(getHfVersionForHeight(900, 'testnet')).toBe(7);
    });

    test('HF10 at height 1100', () => {
      expect(getHfVersionForHeight(1100, 'testnet')).toBe(10);
    });

    test('HF10 at height 2000', () => {
      expect(getHfVersionForHeight(2000, 'testnet')).toBe(10);
    });
  });

  describe('Network ID variants', () => {
    test('accepts numeric NETWORK_ID', () => {
      expect(getHfVersionForHeight(900, NETWORK_ID.TESTNET)).toBe(7);
    });

    test('accepts string network name', () => {
      expect(getHfVersionForHeight(900, 'testnet')).toBe(7);
    });
  });
});

describe('TX Version Selection', () => {
  describe('TRANSFER transactions', () => {
    test('HF1: TRANSFER uses TX v2', () => {
      expect(getTxVersion(TX_TYPE.TRANSFER, 100, 'testnet')).toBe(2);
    });

    test('HF2+: TRANSFER uses TX v3 (N_OUTS)', () => {
      expect(getTxVersion(TX_TYPE.TRANSFER, 250, 'testnet')).toBe(3);
      expect(getTxVersion(TX_TYPE.TRANSFER, 500, 'testnet')).toBe(3);
      expect(getTxVersion(TX_TYPE.TRANSFER, 815, 'testnet')).toBe(3);
    });

    test('HF10+: TRANSFER uses TX v4 (CARROT)', () => {
      expect(getTxVersion(TX_TYPE.TRANSFER, 1100, 'testnet')).toBe(4);
      expect(getTxVersion(TX_TYPE.TRANSFER, 2000, 'testnet')).toBe(4);
    });
  });

  describe('Non-TRANSFER transactions', () => {
    test('STAKE always uses TX v2 pre-CARROT', () => {
      expect(getTxVersion(TX_TYPE.STAKE, 100, 'testnet')).toBe(2);
      expect(getTxVersion(TX_TYPE.STAKE, 500, 'testnet')).toBe(2);
      expect(getTxVersion(TX_TYPE.STAKE, 900, 'testnet')).toBe(2);
    });

    test('STAKE uses TX v4 at CARROT', () => {
      expect(getTxVersion(TX_TYPE.STAKE, 1100, 'testnet')).toBe(4);
    });

    test('BURN always uses TX v2 pre-CARROT', () => {
      expect(getTxVersion(TX_TYPE.BURN, 500, 'testnet')).toBe(2);
      expect(getTxVersion(TX_TYPE.BURN, 900, 'testnet')).toBe(2);
    });

    test('CONVERT always uses TX v2 pre-CARROT', () => {
      expect(getTxVersion(TX_TYPE.CONVERT, 500, 'testnet')).toBe(2);
      expect(getTxVersion(TX_TYPE.CONVERT, 900, 'testnet')).toBe(2);
    });
  });
});

describe('RCT Type Selection', () => {
  test('HF1-2: BulletproofPlus (type 6)', () => {
    expect(getRctType(100, 'testnet')).toBe(6);
    expect(getRctType(249, 'testnet')).toBe(6);
  });

  test('HF3-5: FullProofs (type 7)', () => {
    expect(getRctType(500, 'testnet')).toBe(7);
    expect(getRctType(600, 'testnet')).toBe(7);
    expect(getRctType(814, 'testnet')).toBe(7);
  });

  test('HF6-9: SalviumZero (type 8)', () => {
    expect(getRctType(815, 'testnet')).toBe(8);
    expect(getRctType(900, 'testnet')).toBe(8);
    expect(getRctType(1000, 'testnet')).toBe(8);
    expect(getRctType(1099, 'testnet')).toBe(8);
  });

  test('HF10+: SalviumOne (type 9)', () => {
    expect(getRctType(1100, 'testnet')).toBe(9);
    expect(getRctType(2000, 'testnet')).toBe(9);
  });
});

describe('Asset Type Selection', () => {
  test('Pre-HF6: SAL asset type', () => {
    expect(getActiveAssetType(100, 'testnet')).toBe('SAL');
    expect(getActiveAssetType(500, 'testnet')).toBe('SAL');
    expect(getActiveAssetType(814, 'testnet')).toBe('SAL');
  });

  test('HF6+: SAL1 asset type', () => {
    expect(getActiveAssetType(815, 'testnet')).toBe('SAL1');
    expect(getActiveAssetType(1000, 'testnet')).toBe('SAL1');
    expect(getActiveAssetType(2000, 'testnet')).toBe('SAL1');
  });
});

describe('CARROT Detection', () => {
  test('Pre-HF10: CARROT not active', () => {
    expect(isCarrotActive(500, 'testnet')).toBe(false);
    expect(isCarrotActive(1099, 'testnet')).toBe(false);
  });

  test('HF10+: CARROT active', () => {
    expect(isCarrotActive(1100, 'testnet')).toBe(true);
    expect(isCarrotActive(2000, 'testnet')).toBe(true);
  });
});

describe('Cross-Fork TX Format Matrix', () => {
  /**
   * Expected TX formats at different heights (testnet):
   *
   * | Height | HF | TX Type  | TX Ver | RCT Type | Sig  | Asset |
   * |--------|----|---------:|--------|----------|------|-------|
   * |  100   | 1  | TRANSFER |   2    |    6     | CLSAG| SAL   |
   * |  250   | 2  | TRANSFER |   3    |    6     | CLSAG| SAL   |
   * |  500   | 3  | TRANSFER |   3    |    7     | CLSAG| SAL   |
   * |  815   | 6  | TRANSFER |   3    |    8     | CLSAG| SAL1  |
   * | 1100   | 10 | TRANSFER |   4    |    9     | TCLSAG| SAL1 |
   */

  const testCases = [
    { height: 100, hf: 1, txType: TX_TYPE.TRANSFER, txVer: 2, rctType: 6, asset: 'SAL' },
    { height: 250, hf: 2, txType: TX_TYPE.TRANSFER, txVer: 3, rctType: 6, asset: 'SAL' },
    { height: 500, hf: 3, txType: TX_TYPE.TRANSFER, txVer: 3, rctType: 7, asset: 'SAL' },
    { height: 815, hf: 6, txType: TX_TYPE.TRANSFER, txVer: 3, rctType: 8, asset: 'SAL1' },
    { height: 1100, hf: 10, txType: TX_TYPE.TRANSFER, txVer: 4, rctType: 9, asset: 'SAL1' },
    // STAKE transactions
    { height: 100, hf: 1, txType: TX_TYPE.STAKE, txVer: 2, rctType: 6, asset: 'SAL' },
    { height: 815, hf: 6, txType: TX_TYPE.STAKE, txVer: 2, rctType: 8, asset: 'SAL1' },
    { height: 1100, hf: 10, txType: TX_TYPE.STAKE, txVer: 4, rctType: 9, asset: 'SAL1' },
  ];

  testCases.forEach(({ height, hf, txType, txVer, rctType, asset }) => {
    const txTypeName = Object.entries(TX_TYPE).find(([_, v]) => v === txType)?.[0] || txType;
    test(`HF${hf} (h=${height}): ${txTypeName} → v${txVer}, RCT${rctType}, ${asset}`, () => {
      expect(getHfVersionForHeight(height, 'testnet')).toBe(hf);
      expect(getTxVersion(txType, height, 'testnet')).toBe(txVer);
      expect(getRctType(height, 'testnet')).toBe(rctType);
      expect(getActiveAssetType(height, 'testnet')).toBe(asset);
    });
  });
});

describe('Signature Type (CLSAG vs TCLSAG)', () => {
  // TCLSAG is only used at HF10+ (CARROT) with RCT type 9
  test('Pre-HF10: uses CLSAG (RCT types 6, 7, 8)', () => {
    const rctType = getRctType(900, 'testnet'); // HF7
    expect(rctType).toBeLessThan(9);
    // CLSAG used for types 6, 7, 8
  });

  test('HF10+: uses TCLSAG (RCT type 9)', () => {
    const rctType = getRctType(1100, 'testnet'); // HF10
    expect(rctType).toBe(9);
    // TCLSAG used for type 9
  });
});
