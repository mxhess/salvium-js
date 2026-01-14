# salvium-js

JavaScript library for Salvium cryptocurrency - address handling, RPC clients, key derivation, and cryptographic utilities.

## Features

- **Address Validation** - Validate all 18 Salvium address types
- **Address Parsing** - Extract public keys, payment IDs, detect network/format/type
- **Subaddress Generation** - Generate CryptoNote and CARROT subaddresses
- **Integrated Addresses** - Create and parse integrated addresses with payment IDs
- **Mnemonic Support** - 25-word seed phrases in 12 languages
- **RPC Clients** - Full daemon and wallet RPC implementations
- **Multi-Network Support** - Mainnet, Testnet, Stagenet
- **Dual Format Support** - Legacy (CryptoNote) and CARROT addresses
- **Key Derivation** - CryptoNote and CARROT key derivation from seeds
- **Signature Verification** - Verify message signatures (V1 and V2 formats)
- **Zero Dependencies** - Pure JavaScript, works in browsers and Node.js

## Address Types Supported

| Network | Format | Standard | Integrated | Subaddress |
|---------|--------|----------|------------|------------|
| Mainnet | Legacy | SaLv... | SaLvi... | SaLvs... |
| Mainnet | CARROT | SC1... | SC1i... | SC1s... |
| Testnet | Legacy | SaLvT... | SaLvTi... | SaLvTs... |
| Testnet | CARROT | SC1T... | SC1Ti... | SC1Ts... |
| Stagenet | Legacy | SaLvS... | SaLvSi... | SaLvSs... |
| Stagenet | CARROT | SC1S... | SC1Si... | SC1Ss... |

## Installation

```bash
npm install salvium-js
```

Or include directly in browser:

```html
<script type="module">
  import salvium from './salvium-js/src/index.js';
</script>
```

## Usage

### Validate an Address

```javascript
import { isValidAddress, parseAddress } from 'salvium-js';

// Simple validation
if (isValidAddress('SC1...')) {
  console.log('Valid address!');
}

// Detailed parsing
const info = parseAddress('SC1...');
console.log(info);
// {
//   valid: true,
//   network: 'mainnet',
//   format: 'carrot',
//   type: 'standard',
//   prefix: 'SC1',
//   spendPublicKey: Uint8Array(32),
//   viewPublicKey: Uint8Array(32),
//   paymentId: null,
//   error: null
// }
```

### Check Address Properties

```javascript
import {
  isMainnet,
  isTestnet,
  isCarrot,
  isLegacy,
  isStandard,
  isIntegrated,
  isSubaddress
} from 'salvium-js';

const addr = 'SC1...';

isMainnet(addr);    // true
isCarrot(addr);     // true
isStandard(addr);   // true
isIntegrated(addr); // false
```

### Extract Keys

```javascript
import { getSpendPublicKey, getViewPublicKey, bytesToHex } from 'salvium-js';

const spendKey = getSpendPublicKey('SC1...');
const viewKey = getViewPublicKey('SC1...');

console.log('Spend Key:', bytesToHex(spendKey));
console.log('View Key:', bytesToHex(viewKey));
```

### Work with Integrated Addresses

```javascript
import { toIntegratedAddress, toStandardAddress, getPaymentId, bytesToHex } from 'salvium-js';

// Create integrated address with payment ID
const integrated = toIntegratedAddress('SC1...', 'deadbeef12345678');

// Extract payment ID
const paymentId = getPaymentId(integrated);
console.log('Payment ID:', bytesToHex(paymentId));

// Get standard address from integrated
const standard = toStandardAddress(integrated);
```

### Describe an Address

```javascript
import { describeAddress } from 'salvium-js';

console.log(describeAddress('SC1...'));
// "Mainnet CARROT standard"

console.log(describeAddress('SaLvi...'));
// "Mainnet Legacy integrated (Payment ID: abcd1234...)"
```

### Low-Level: Keccak-256

```javascript
import { keccak256, keccak256Hex } from 'salvium-js';

const hash = keccak256('hello');        // Uint8Array(32)
const hex = keccak256Hex('hello');      // "1c8aff950685..."
```

### Low-Level: Base58

```javascript
import { encode, decode, encodeAddress, decodeAddress } from 'salvium-js/base58';

const encoded = encode(new Uint8Array([1, 2, 3]));
const decoded = decode(encoded);
```

### Verify Message Signatures

```javascript
import { verifySignature, parseSignature } from 'salvium-js';

// Verify a signature created with `sign` command in salvium-wallet-cli
const result = verifySignature(
  'Hello, World!',                    // The original message
  'SC1...',                           // The signer's address
  'SigV2...'                          // The signature string
);

console.log(result);
// {
//   valid: true,
//   version: 2,
//   keyType: 'spend',  // or 'view'
//   error: null
// }

// Parse signature components
const sig = parseSignature('SigV2...');
console.log(sig);
// {
//   valid: true,
//   version: 2,
//   c: Uint8Array(32),
//   r: Uint8Array(32),
//   signMask: 0
// }
```

## API Reference

### Address Functions

| Function | Description |
|----------|-------------|
| `parseAddress(addr)` | Parse address, returns detailed info object |
| `isValidAddress(addr)` | Returns true if valid |
| `isMainnet(addr)` | Check if mainnet address |
| `isTestnet(addr)` | Check if testnet address |
| `isStagenet(addr)` | Check if stagenet address |
| `isCarrot(addr)` | Check if CARROT format |
| `isLegacy(addr)` | Check if legacy CryptoNote format |
| `isStandard(addr)` | Check if standard address |
| `isIntegrated(addr)` | Check if integrated address |
| `isSubaddress(addr)` | Check if subaddress |
| `getSpendPublicKey(addr)` | Extract 32-byte spend public key |
| `getViewPublicKey(addr)` | Extract 32-byte view public key |
| `getPaymentId(addr)` | Extract 8-byte payment ID (integrated only) |
| `toIntegratedAddress(addr, paymentId)` | Create integrated from standard |
| `toStandardAddress(addr)` | Extract standard from integrated |
| `describeAddress(addr)` | Human-readable description |

### Utility Functions

| Function | Description |
|----------|-------------|
| `bytesToHex(bytes)` | Convert Uint8Array to hex string |
| `hexToBytes(hex)` | Convert hex string to Uint8Array |
| `keccak256(data)` | Keccak-256 hash, returns Uint8Array |
| `keccak256Hex(data)` | Keccak-256 hash, returns hex string |

### Signature Functions

| Function | Description |
|----------|-------------|
| `verifySignature(message, address, signature)` | Verify a message signature, returns result object |
| `parseSignature(signature)` | Parse signature string into components |

## RPC Clients

Full-featured RPC clients for interacting with Salvium daemon and wallet services.

### Default Ports (from cryptonote_config.h)

| Service | Mainnet | Testnet | Stagenet |
|---------|---------|---------|----------|
| Daemon RPC | 19081 | 29081 | 39081 |
| ZMQ RPC | 19082 | 29082 | 39082 |
| Wallet RPC* | 19082 | 29082 | 39082 |

*Wallet RPC has no default in source - port is user-specified, conventionally daemon+1

### Daemon RPC

```javascript
import { createDaemonRPC } from 'salvium-js/rpc';

const daemon = createDaemonRPC({ url: 'http://localhost:19081' });

// Get node info
const info = await daemon.getInfo();
if (info.success) {
  console.log('Height:', info.result.height);
  console.log('Synchronized:', info.result.synchronized);
}

// Get block by height
const block = await daemon.getBlockHeaderByHeight(100000);

// Get transactions
const txs = await daemon.getTransactions(['txhash1', 'txhash2']);

// Mining
const template = await daemon.getBlockTemplate({
  wallet_address: 'SaLv...',
  reserve_size: 8
});
```

### Wallet RPC

```javascript
import { createWalletRPC, PRIORITY } from 'salvium-js/rpc';

const wallet = createWalletRPC({
  url: 'http://localhost:19082',
  username: 'user',      // optional
  password: 'pass'       // optional
});

// Open wallet
await wallet.openWallet({ filename: 'mywallet', password: 'secret' });

// Get balance
const balance = await wallet.getBalance();
if (balance.success) {
  console.log('Balance:', balance.result.balance / 1e8, 'SAL');
  console.log('Unlocked:', balance.result.unlocked_balance / 1e8, 'SAL');
}

// Send transaction
const tx = await wallet.transfer({
  destinations: [{ address: 'SaLv...', amount: 100000000 }], // 1 SAL
  priority: PRIORITY.NORMAL
});

// Get transaction history
const transfers = await wallet.getTransfers({ in: true, out: true });
```

### RPC Client Options

```javascript
import { createDaemonRPC } from 'salvium-js/rpc';

const daemon = createDaemonRPC({
  url: 'http://localhost:19081',
  timeout: 30000,        // Request timeout in ms (default: 30000)
  retries: 2,            // Retry attempts (default: 2)
  retryDelay: 1000,      // Delay between retries in ms (default: 1000)
  username: 'user',      // HTTP basic auth username
  password: 'pass'       // HTTP basic auth password
});
```

### Available Daemon RPC Methods

- **Network**: `getInfo`, `getHeight`, `syncInfo`, `hardForkInfo`, `getNetStats`, `getConnections`, `getPeerList`
- **Blocks**: `getBlockHash`, `getBlock`, `getBlockHeaderByHash`, `getBlockHeaderByHeight`, `getBlockHeadersRange`, `getLastBlockHeader`
- **Transactions**: `getTransactions`, `getTransactionPool`, `sendRawTransaction`, `relayTx`
- **Outputs**: `getOuts`, `getOutputHistogram`, `getOutputDistribution`, `isKeyImageSpent`
- **Mining**: `getBlockTemplate`, `submitBlock`, `getMinerData`, `calcPow`
- **Fees**: `getFeeEstimate`, `getBaseFeeEstimate`, `getCoinbaseTxSum`

### Available Wallet RPC Methods

- **Wallet**: `createWallet`, `openWallet`, `closeWallet`, `restoreDeterministicWallet`, `generateFromKeys`
- **Accounts**: `getAccounts`, `createAccount`, `labelAccount`, `getAddress`, `createAddress`
- **Balance**: `getBalance`, `getTransfers`, `getTransferByTxid`, `incomingTransfers`
- **Transfers**: `transfer`, `transferSplit`, `sweepAll`, `sweepSingle`, `sweepDust`
- **Proofs**: `getTxKey`, `checkTxKey`, `getTxProof`, `checkTxProof`, `getReserveProof`
- **Keys**: `queryKey`, `getMnemonic`, `exportOutputs`, `importOutputs`, `exportKeyImages`
- **Signing**: `sign`, `verify`, `signMultisig`, `submitMultisig`

## Subaddress Generation

```javascript
import { generateCNSubaddress, generateCarrotSubaddress } from 'salvium-js';

// Generate CryptoNote subaddress
const cnSub = generateCNSubaddress(
  spendPublicKey,    // Uint8Array(32)
  viewSecretKey,     // Uint8Array(32)
  0,                 // account index
  1,                 // address index
  'mainnet'
);
console.log(cnSub.address); // SaLvs...

// Generate CARROT subaddress
const carrotSub = generateCarrotSubaddress(
  spendPublicKey,    // K_s
  viewPublicKey,     // K_v
  generateAddress,   // s_ga (32-byte secret)
  0,                 // account index
  1,                 // address index
  'mainnet'
);
console.log(carrotSub.address); // SC1s...
```

## Mnemonic Seeds

```javascript
import { mnemonicToSeed, seedToMnemonic, validateMnemonic, LANGUAGES } from 'salvium-js';

// Convert mnemonic to seed
const result = mnemonicToSeed('word1 word2 ... word25', 'english');
if (result.valid) {
  console.log('Seed:', result.seed); // Uint8Array(32)
}

// Convert seed to mnemonic
const mnemonic = seedToMnemonic(seedBytes, 'english');

// Validate mnemonic
const validation = validateMnemonic('word1 word2 ...', 'english');
console.log(validation.valid, validation.error);

// Available languages
console.log(LANGUAGES);
// ['english', 'spanish', 'french', 'italian', 'german', 'portuguese',
//  'russian', 'japanese', 'chinese_simplified', 'dutch', 'esperanto', 'lojban']
```

## Key Derivation

```javascript
import { deriveKeys, deriveCarrotKeys } from 'salvium-js';

// CryptoNote key derivation from seed
const cnKeys = deriveKeys(seed); // Uint8Array(32)
// {
//   spendSecretKey, spendPublicKey,
//   viewSecretKey, viewPublicKey
// }

// CARROT key derivation
const carrotKeys = deriveCarrotKeys(seed);
// {
//   k_ps, k_gi, k_vi, s_ga, s_vb,
//   spendPublicKey, viewPublicKey
// }
```

## Contributing

Contributions welcome! Please read the Salvium source code for reference:
https://github.com/salvium/salvium

