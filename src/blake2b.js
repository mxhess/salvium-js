/**
 * Blake2b hash function
 * Pure JavaScript implementation based on RFC 7693
 */

// IV constants
const IV = new Uint32Array([
  0xf3bcc908, 0x6a09e667,
  0x84caa73b, 0xbb67ae85,
  0xfe94f82b, 0x3c6ef372,
  0x5f1d36f1, 0xa54ff53a,
  0xade682d1, 0x510e527f,
  0x2b3e6c1f, 0x9b05688c,
  0xfb41bd6b, 0x1f83d9ab,
  0x137e2179, 0x5be0cd19
]);

// Sigma permutation table
const SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3]
];

// 64-bit operations using two 32-bit values (lo, hi)
// v is Uint32Array where v[2i] = low 32 bits, v[2i+1] = high 32 bits

function ADD64AA(v, a, b) {
  const o0 = v[a] + v[b];
  let o1 = v[a + 1] + v[b + 1];
  if (o0 >= 0x100000000) o1++;
  v[a] = o0 >>> 0;
  v[a + 1] = o1 >>> 0;
}

function ADD64AC(v, a, b0, b1) {
  let o0 = v[a] + b0;
  let o1 = v[a + 1] + b1;
  if (o0 >= 0x100000000) o1++;
  v[a] = o0 >>> 0;
  v[a + 1] = o1 >>> 0;
}

function XOR64(v, a, b) {
  v[a] ^= v[b];
  v[a + 1] ^= v[b + 1];
}

function ROTR64(x, y, c) {
  // Rotate right by c bits, result in x
  const xl = x[0], xh = x[1];
  if (c < 32) {
    y[0] = (xl >>> c) | (xh << (32 - c));
    y[1] = (xh >>> c) | (xl << (32 - c));
  } else if (c === 32) {
    y[0] = xh;
    y[1] = xl;
  } else {
    const cc = c - 32;
    y[0] = (xh >>> cc) | (xl << (32 - cc));
    y[1] = (xl >>> cc) | (xh << (32 - cc));
  }
}

// G mixing function
function G(v, m, a, b, c, d, ix, iy) {
  const x0 = m[ix * 2], x1 = m[ix * 2 + 1];
  const y0 = m[iy * 2], y1 = m[iy * 2 + 1];
  const tmp = [0, 0];

  // a = a + b + x
  ADD64AA(v, a * 2, b * 2);
  ADD64AC(v, a * 2, x0, x1);

  // d = rotr64(d ^ a, 32)
  XOR64(v, d * 2, a * 2);
  tmp[0] = v[d * 2];
  tmp[1] = v[d * 2 + 1];
  v[d * 2] = tmp[1];
  v[d * 2 + 1] = tmp[0];

  // c = c + d
  ADD64AA(v, c * 2, d * 2);

  // b = rotr64(b ^ c, 24)
  XOR64(v, b * 2, c * 2);
  tmp[0] = v[b * 2];
  tmp[1] = v[b * 2 + 1];
  v[b * 2] = (tmp[0] >>> 24) | (tmp[1] << 8);
  v[b * 2 + 1] = (tmp[1] >>> 24) | (tmp[0] << 8);

  // a = a + b + y
  ADD64AA(v, a * 2, b * 2);
  ADD64AC(v, a * 2, y0, y1);

  // d = rotr64(d ^ a, 16)
  XOR64(v, d * 2, a * 2);
  tmp[0] = v[d * 2];
  tmp[1] = v[d * 2 + 1];
  v[d * 2] = (tmp[0] >>> 16) | (tmp[1] << 16);
  v[d * 2 + 1] = (tmp[1] >>> 16) | (tmp[0] << 16);

  // c = c + d
  ADD64AA(v, c * 2, d * 2);

  // b = rotr64(b ^ c, 63)
  XOR64(v, b * 2, c * 2);
  tmp[0] = v[b * 2];
  tmp[1] = v[b * 2 + 1];
  v[b * 2] = (tmp[1] >>> 31) | (tmp[0] << 1);
  v[b * 2 + 1] = (tmp[0] >>> 31) | (tmp[1] << 1);
}

/**
 * Blake2b context
 */
class Blake2bCtx {
  constructor(outlen, key) {
    this.h = new Uint32Array(16);
    this.b = new Uint8Array(128);
    this.c = 0;  // pointer within buffer
    this.t = 0;  // total bytes
    this.outlen = outlen;

    // Initialize state with IV
    for (let i = 0; i < 16; i++) {
      this.h[i] = IV[i];
    }

    // Mix in parameters: outlen, keylen
    const keylen = key ? key.length : 0;
    this.h[0] ^= 0x01010000 ^ (keylen << 8) ^ outlen;

    // If keyed, process key block
    if (keylen > 0) {
      const block = new Uint8Array(128);
      for (let i = 0; i < keylen; i++) block[i] = key[i];
      this.update(block);
    }
  }

  compress(last) {
    const v = new Uint32Array(32);
    const m = new Uint32Array(32);

    // Initialize v[0..15] = h[0..7] (as 64-bit words)
    for (let i = 0; i < 16; i++) v[i] = this.h[i];

    // Initialize v[16..31] = IV (as 64-bit words)
    for (let i = 0; i < 16; i++) v[16 + i] = IV[i];

    // v[12] ^= t (low 64 bits of counter)
    v[24] ^= this.t >>> 0;
    v[25] ^= (this.t / 0x100000000) >>> 0;

    // v[14] ^= 0xffffffffffffffff if last block
    if (last) {
      v[28] = ~v[28];
      v[29] = ~v[29];
    }

    // Load message block as 16 64-bit words
    for (let i = 0; i < 16; i++) {
      const off = i * 8;
      m[i * 2] = this.b[off] | (this.b[off + 1] << 8) | (this.b[off + 2] << 16) | (this.b[off + 3] << 24);
      m[i * 2 + 1] = this.b[off + 4] | (this.b[off + 5] << 8) | (this.b[off + 6] << 16) | (this.b[off + 7] << 24);
    }

    // 12 rounds
    for (let round = 0; round < 12; round++) {
      const s = SIGMA[round];
      G(v, m, 0, 4, 8, 12, s[0], s[1]);
      G(v, m, 1, 5, 9, 13, s[2], s[3]);
      G(v, m, 2, 6, 10, 14, s[4], s[5]);
      G(v, m, 3, 7, 11, 15, s[6], s[7]);
      G(v, m, 0, 5, 10, 15, s[8], s[9]);
      G(v, m, 1, 6, 11, 12, s[10], s[11]);
      G(v, m, 2, 7, 8, 13, s[12], s[13]);
      G(v, m, 3, 4, 9, 14, s[14], s[15]);
    }

    // h = h ^ v[0..7] ^ v[8..15]
    for (let i = 0; i < 16; i++) {
      this.h[i] ^= v[i] ^ v[16 + i];
    }
  }

  update(input) {
    for (let i = 0; i < input.length; i++) {
      if (this.c === 128) {
        this.t += this.c;
        this.compress(false);
        this.c = 0;
      }
      this.b[this.c++] = input[i];
    }
  }

  final() {
    this.t += this.c;

    // Pad with zeros
    while (this.c < 128) {
      this.b[this.c++] = 0;
    }

    this.compress(true);

    // Output
    const out = new Uint8Array(this.outlen);
    for (let i = 0; i < this.outlen; i++) {
      out[i] = (this.h[i >> 2] >> (8 * (i & 3))) & 0xff;
    }
    return out;
  }
}

/**
 * Blake2b hash
 * @param {Uint8Array} input - Input data
 * @param {number} outlen - Output length in bytes (1-64)
 * @param {Uint8Array} [key] - Optional key (up to 64 bytes)
 * @returns {Uint8Array} Hash output
 */
export function blake2b(input, outlen, key = null) {
  if (outlen < 1 || outlen > 64) throw new Error('Invalid output length');
  if (key && key.length > 64) throw new Error('Key too long');

  const ctx = new Blake2bCtx(outlen, key);
  ctx.update(input);
  return ctx.final();
}

/**
 * Blake2b hex output
 * @param {Uint8Array} input - Input data
 * @param {number} outlen - Output length in bytes
 * @param {Uint8Array} [key] - Optional key
 * @returns {string} Hex string
 */
export function blake2bHex(input, outlen, key = null) {
  const hash = blake2b(input, outlen, key);
  return Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
}

export default { blake2b, blake2bHex };
