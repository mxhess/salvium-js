/**
 * Epee Portable Storage Binary Format
 *
 * Implements Monero/Salvium's binary serialization format used by .bin RPC endpoints.
 * Format: signature (8 bytes) + root section (varint entry count + entries).
 *
 * Reference: epee/include/storages/portable_storage_{to,from}_bin.h
 */

const SIGNATURE_A = 0x01011101;
const SIGNATURE_B = 0x01020101;
const FORMAT_VER  = 1;

// Type tags
const TYPE_INT64   = 1;
const TYPE_INT32   = 2;
const TYPE_INT16   = 3;
const TYPE_INT8    = 4;
const TYPE_UINT64  = 5;
const TYPE_UINT32  = 6;
const TYPE_UINT16  = 7;
const TYPE_UINT8   = 8;
const TYPE_DOUBLE  = 9;
const TYPE_STRING  = 10;
const TYPE_BOOL    = 11;
const TYPE_OBJECT  = 12;
const TYPE_ARRAY   = 13;
const FLAG_ARRAY   = 0x80;

// Varint size masks
const SIZE_MARK_MASK  = 0x03;
const SIZE_MARK_BYTE  = 0;
const SIZE_MARK_WORD  = 1;
const SIZE_MARK_DWORD = 2;
const SIZE_MARK_INT64 = 3;

// ============================================================
// WRITER
// ============================================================

class BinaryWriter {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }

  writeUint8(v) {
    const b = new Uint8Array(1);
    b[0] = v & 0xFF;
    this.chunks.push(b);
    this.length += 1;
  }

  writeUint32LE(v) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, true);
    this.chunks.push(b);
    this.length += 4;
  }

  writeUint64LE(v) {
    const b = new Uint8Array(8);
    const dv = new DataView(b.buffer);
    const n = BigInt(v);
    dv.setUint32(0, Number(n & 0xFFFFFFFFn), true);
    dv.setUint32(4, Number((n >> 32n) & 0xFFFFFFFFn), true);
    this.chunks.push(b);
    this.length += 8;
  }

  writeBytes(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    this.chunks.push(u8);
    this.length += u8.length;
  }

  writeVarint(val) {
    if (val <= 63) {
      this.writeUint8((val << 2) | SIZE_MARK_BYTE);
    } else if (val <= 16383) {
      const v = (val << 2) | SIZE_MARK_WORD;
      const b = new Uint8Array(2);
      new DataView(b.buffer).setUint16(0, v, true);
      this.chunks.push(b);
      this.length += 2;
    } else if (val <= 1073741823) {
      const v = (val << 2) | SIZE_MARK_DWORD;
      const b = new Uint8Array(4);
      new DataView(b.buffer).setUint32(0, v, true);
      this.chunks.push(b);
      this.length += 4;
    } else {
      const v = BigInt(val) << 2n | BigInt(SIZE_MARK_INT64);
      const b = new Uint8Array(8);
      const dv = new DataView(b.buffer);
      dv.setUint32(0, Number(v & 0xFFFFFFFFn), true);
      dv.setUint32(4, Number((v >> 32n) & 0xFFFFFFFFn), true);
      this.chunks.push(b);
      this.length += 8;
    }
  }

  writeString(s) {
    const encoded = typeof s === 'string' ? new TextEncoder().encode(s) : s;
    this.writeVarint(encoded.length);
    this.writeBytes(encoded);
  }

  toBuffer() {
    const result = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
}

/**
 * Serialize a JS object to portable storage binary format.
 * Supports: strings, numbers (uint64), booleans, arrays of uint64, arrays of strings,
 * arrays of objects, and nested objects.
 *
 * For typed arrays, wrap values: { _type: 'uint64_array', values: [...] }
 */
export function serialize(obj) {
  const w = new BinaryWriter();

  // Header: sig_a (4) + sig_b (4) + ver (1)
  w.writeUint32LE(SIGNATURE_A);
  w.writeUint32LE(SIGNATURE_B);
  w.writeUint8(FORMAT_VER);

  writeSection(w, obj);
  return w.toBuffer();
}

function writeSection(w, obj) {
  const keys = Object.keys(obj);
  w.writeVarint(keys.length);
  for (const key of keys) {
    // Key: length (1 byte) + chars
    const keyBytes = new TextEncoder().encode(key);
    w.writeUint8(keyBytes.length);
    w.writeBytes(keyBytes);
    // Value
    writeEntry(w, obj[key]);
  }
}

function writeEntry(w, val) {
  if (val === null || val === undefined) {
    // Write as empty string
    w.writeUint8(TYPE_STRING);
    w.writeVarint(0);
    return;
  }

  // Typed wrapper: { _type: 'uint64_array', values: [...] }
  if (val && val._type === 'uint64_array') {
    w.writeUint8(TYPE_UINT64 | FLAG_ARRAY);
    w.writeVarint(val.values.length);
    for (const v of val.values) {
      w.writeUint64LE(v);
    }
    return;
  }

  if (typeof val === 'boolean') {
    w.writeUint8(TYPE_BOOL);
    w.writeUint8(val ? 1 : 0);
  } else if (typeof val === 'number') {
    // Default to uint64 for numbers
    w.writeUint8(TYPE_UINT64);
    w.writeUint64LE(val);
  } else if (typeof val === 'bigint') {
    w.writeUint8(TYPE_UINT64);
    w.writeUint64LE(val);
  } else if (typeof val === 'string') {
    w.writeUint8(TYPE_STRING);
    w.writeString(val);
  } else if (val instanceof Uint8Array || val instanceof ArrayBuffer) {
    // Binary data as string
    w.writeUint8(TYPE_STRING);
    const u8 = val instanceof Uint8Array ? val : new Uint8Array(val);
    w.writeVarint(u8.length);
    w.writeBytes(u8);
  } else if (Array.isArray(val)) {
    if (val.length === 0) {
      // Empty array — write as string array
      w.writeUint8(TYPE_STRING | FLAG_ARRAY);
      w.writeVarint(0);
    } else if (typeof val[0] === 'object' && val[0] !== null) {
      // Array of objects
      w.writeUint8(TYPE_OBJECT | FLAG_ARRAY);
      w.writeVarint(val.length);
      for (const item of val) writeSection(w, item);
    } else if (typeof val[0] === 'string') {
      w.writeUint8(TYPE_STRING | FLAG_ARRAY);
      w.writeVarint(val.length);
      for (const s of val) w.writeString(s);
    } else {
      // Array of numbers → uint64
      w.writeUint8(TYPE_UINT64 | FLAG_ARRAY);
      w.writeVarint(val.length);
      for (const n of val) w.writeUint64LE(n);
    }
  } else if (typeof val === 'object') {
    w.writeUint8(TYPE_OBJECT);
    writeSection(w, val);
  }
}

// ============================================================
// READER
// ============================================================

class BinaryReader {
  constructor(buf) {
    this.buf = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    this.dv = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    this.pos = 0;
  }

  readUint8() {
    return this.buf[this.pos++];
  }

  readUint16LE() {
    const v = this.dv.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  readUint32LE() {
    const v = this.dv.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  readUint64LE() {
    const lo = this.dv.getUint32(this.pos, true);
    const hi = this.dv.getUint32(this.pos + 4, true);
    this.pos += 8;
    // Return as Number if safe, else BigInt
    const n = BigInt(hi) << 32n | BigInt(lo);
    if (n <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(n);
    return n;
  }

  readInt64LE() {
    const lo = this.dv.getUint32(this.pos, true);
    const hi = this.dv.getInt32(this.pos + 4, true);
    this.pos += 8;
    const n = BigInt(hi) << 32n | BigInt(lo);
    if (n >= BigInt(Number.MIN_SAFE_INTEGER) && n <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(n);
    return n;
  }

  readInt32LE() {
    const v = this.dv.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  readInt16LE() {
    const v = this.dv.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  readDouble() {
    const v = this.dv.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  readVarint() {
    const mark = this.buf[this.pos] & SIZE_MARK_MASK;
    switch (mark) {
      case SIZE_MARK_BYTE: {
        const v = this.readUint8();
        return v >> 2;
      }
      case SIZE_MARK_WORD: {
        const v = this.readUint16LE();
        return v >> 2;
      }
      case SIZE_MARK_DWORD: {
        const v = this.readUint32LE();
        return v >>> 2;
      }
      case SIZE_MARK_INT64: {
        const lo = this.dv.getUint32(this.pos, true);
        const hi = this.dv.getUint32(this.pos + 4, true);
        this.pos += 8;
        return Number((BigInt(hi) << 32n | BigInt(lo)) >> 2n);
      }
    }
  }

  readString() {
    const len = this.readVarint();
    const bytes = this.buf.slice(this.pos, this.pos + len);
    this.pos += len;
    return bytes;
  }

  readBytes(n) {
    const b = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
}

/**
 * Deserialize portable storage binary format to a JS object.
 * String fields are returned as Uint8Array (binary blobs).
 * Use .toString() or TextDecoder for text strings.
 */
export function deserialize(buf) {
  const r = new BinaryReader(buf);

  // Verify header
  const sigA = r.readUint32LE();
  const sigB = r.readUint32LE();
  const ver = r.readUint8();

  if (sigA !== SIGNATURE_A || sigB !== SIGNATURE_B) {
    throw new Error(`Invalid portable storage signature: 0x${sigA.toString(16)} 0x${sigB.toString(16)}`);
  }
  if (ver !== FORMAT_VER) {
    throw new Error(`Unsupported portable storage version: ${ver}`);
  }

  return readSection(r);
}

function readSection(r) {
  const count = r.readVarint();
  const obj = {};
  for (let i = 0; i < count; i++) {
    const keyLen = r.readUint8();
    const keyBytes = r.readBytes(keyLen);
    const key = new TextDecoder().decode(keyBytes);
    obj[key] = readEntry(r);
  }
  return obj;
}

function readEntry(r) {
  const typeTag = r.readUint8();
  const isArray = (typeTag & FLAG_ARRAY) !== 0;
  const baseType = typeTag & ~FLAG_ARRAY;

  if (isArray) {
    const count = r.readVarint();
    const arr = [];
    for (let i = 0; i < count; i++) {
      arr.push(readValue(r, baseType));
    }
    return arr;
  }

  return readValue(r, baseType);
}

function readValue(r, type) {
  switch (type) {
    case TYPE_UINT64:  return r.readUint64LE();
    case TYPE_UINT32:  return r.readUint32LE();
    case TYPE_UINT16:  return r.readUint16LE();
    case TYPE_UINT8:   return r.readUint8();
    case TYPE_INT64:   return r.readInt64LE();
    case TYPE_INT32:   return r.readInt32LE();
    case TYPE_INT16:   return r.readInt16LE();
    case TYPE_INT8:    return r.readUint8();  // signed but same read
    case TYPE_DOUBLE:  return r.readDouble();
    case TYPE_BOOL:    return r.readUint8() !== 0;
    case TYPE_STRING:  return r.readString();
    case TYPE_OBJECT:  return readSection(r);
    case TYPE_ARRAY:   return readEntry(r);  // nested array
    default:
      throw new Error(`Unknown portable storage type: ${type}`);
  }
}
