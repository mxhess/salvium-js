#!/usr/bin/env bun
// Debug specific failing transaction

import { createDaemonRPC } from '../src/rpc/index.js';
import { parseTransaction } from '../src/transaction.js';
import { hexToBytes, bytesToHex } from '../src/address.js';

const daemon = createDaemonRPC({ url: 'http://seed01.salvium.io:19081', timeout: 30000 });

async function test() {
  const txHash = 'a5e85d03e9200229a72fc3cfe94e5b139c8c2ad982dc3fd174898be63269e670';

  console.log('Fetching tx:', txHash);

  const resp = await daemon.getTransactions([txHash], { decode_as_json: true });
  const txData = resp.result?.txs?.[0];

  if (!txData) {
    console.log('Transaction not found');
    return;
  }

  console.log('TX size:', txData.as_hex.length / 2, 'bytes');

  // Get daemon's JSON decode for comparison
  const jsonTx = JSON.parse(txData.as_json);
  console.log('\nDaemon JSON says:');
  console.log('  RCT type:', jsonTx.rct_signatures?.type);
  console.log('  Inputs:', jsonTx.vin?.length);
  console.log('  Outputs:', jsonTx.vout?.length);

  // Try to parse
  console.log('\nParsing...');
  try {
    const tx = parseTransaction(hexToBytes(txData.as_hex));
    console.log('Parsed successfully');
    console.log('  RCT type:', tx.rct?.type);
    console.log('  Has bulletproofPlus:', !!tx.rct?.bulletproofPlus);
    console.log('  Has CLSAGs:', !!tx.rct?.CLSAGs);
    console.log('  ecdhInfo count:', tx.rct?.ecdhInfo?.length);
    console.log('  outPk count:', tx.rct?.outPk?.length);
  } catch (e) {
    console.log('Parse error:', e.message);
  }
}

test().catch(console.error);
