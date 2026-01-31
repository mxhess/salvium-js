use wasm_bindgen::prelude::*;
use tiny_keccak::{Hasher, Keccak};

/// Keccak-256 hash (CryptoNote variant with 0x01 padding, NOT SHA3)
/// Matches Salvium C++ cn_fast_hash / keccak()
#[wasm_bindgen]
pub fn keccak256(data: &[u8]) -> Vec<u8> {
    let mut keccak = Keccak::v256();
    let mut output = [0u8; 32];
    keccak.update(data);
    keccak.finalize(&mut output);
    output.to_vec()
}

/// Blake2b with variable output length (unkeyed)
/// Matches Salvium C++ blake2b(out, outLen, data, dataLen, NULL, 0)
#[wasm_bindgen]
pub fn blake2b_hash(data: &[u8], out_len: usize) -> Vec<u8> {
    blake2b_simd::Params::new()
        .hash_length(out_len)
        .hash(data)
        .as_bytes()
        .to_vec()
}

/// Blake2b with key (keyed variant per RFC 7693)
/// Matches Salvium C++ blake2b(out, outLen, data, dataLen, key, keyLen)
/// Used by CARROT protocol for domain-separated hashing
#[wasm_bindgen]
pub fn blake2b_keyed(data: &[u8], out_len: usize, key: &[u8]) -> Vec<u8> {
    blake2b_simd::Params::new()
        .hash_length(out_len)
        .key(key)
        .hash(data)
        .as_bytes()
        .to_vec()
}
