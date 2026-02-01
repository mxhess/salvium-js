/**
 * Mining worker thread - runs its own RandomX context and mines independently
 */
import { parentPort, workerData } from 'worker_threads';
import { RandomXContext } from './src/randomx/index.js';
import { findNonceOffset, setNonce, checkHash } from './src/mining.js';
import { hexToBytes, bytesToHex } from './src/address.js';

const { workerId, seedHash } = workerData;

// Initialize RandomX
const rx = new RandomXContext();
await rx.init(hexToBytes(seedHash));
parentPort.postMessage({ type: 'ready', workerId });

let hashCount = 0;
let currentJob = null;

// Listen for jobs from main thread
parentPort.on('message', (msg) => {
  if (msg.type === 'job') {
    currentJob = msg;
    mine(msg);
  } else if (msg.type === 'stop') {
    process.exit(0);
  } else if (msg.type === 'newSeed') {
    rx.init(hexToBytes(msg.seedHash)).then(() => {
      parentPort.postMessage({ type: 'seedReady', workerId });
    });
  }
});

async function mine(job) {
  const hashingBlob = hexToBytes(job.hashingBlobHex);
  const nonceOffset = findNonceOffset(hashingBlob);
  const difficulty = BigInt(job.difficulty);
  const jobId = job.jobId;

  // Each worker starts at a different offset to avoid overlap
  let nonce = (workerId * 0x20000000 + Math.floor(Math.random() * 0x1FFFFFFF)) >>> 0;

  while (currentJob && currentJob.jobId === jobId) {
    const blob = setNonce(hashingBlob, nonce, nonceOffset);
    const hash = rx.hash(blob);
    hashCount++;

    if (checkHash(hash, difficulty)) {
      parentPort.postMessage({
        type: 'block',
        workerId,
        nonce,
        hash: bytesToHex(hash),
        jobId,
      });
    }

    nonce = (nonce + 1) >>> 0;

    // Report hashrate every 64 hashes
    if (hashCount % 64 === 0) {
      parentPort.postMessage({ type: 'hashes', workerId, count: 64 });
    }
  }
}
