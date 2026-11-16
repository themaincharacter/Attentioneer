/**
 * The ghost's digest — SHA-256 over a string's UTF-8 bytes, pure and
 * synchronous (Epic 10 story 1, ADR-0024/0025's base pin).
 *
 * The envelope's `expect.files` carries one hex digest per file the move
 * touches. It is the BASE PIN: at accept the grammar hashes the bytes it is
 * about to write over (the file ACTUALLY on disk) and refuses when the digest
 * moved. A digest is a staleness/tamper detector here, not a cryptographic
 * contract — but it is cheap to be exact, so this is real SHA-256 with no
 * dependency and no async: it must run in the Tauri webview and in the bun
 * tests alike, and the grammar stays pure.
 *
 * Provisional: the algorithm (SHA-256) and the lower-case hex spelling are the
 * envelope's pin format, settled by ADR-0025 only to the extent of "the base
 * pin against the file actually written". An absent file pins as the digest of
 * the empty string — an absent and an empty record file append identically, so
 * the pin need not tell them apart.
 */

/** The SHA-256 round constants (FIPS 180-4). */
const K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** The initial hash values (FIPS 180-4). */
const H: readonly number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
];

/** Rotate right, 32-bit. */
function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/**
 * The SHA-256 digest of a string's UTF-8 bytes, as 64 lower-case hex chars.
 * Pure: no fs, no crypto API, no async — the grammar can call it directly.
 */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const length = bytes.length;
  // Pad to the next 64-byte block with room for 0x80 and the 8-byte length.
  const total = Math.ceil((length + 9) / 64) * 64;
  const padded = new Uint8Array(total);
  padded.set(bytes);
  padded[length] = 0x80;

  // The message length in BITS, 64-bit big-endian. The low word is the byte
  // count shifted left three; the high word is the count divided by 2^29.
  const view = new DataView(padded.buffer);
  view.setUint32(total - 8, Math.floor(length / 0x20000000) >>> 0);
  view.setUint32(total - 4, (length * 8) >>> 0);

  const hash = H.slice();
  const w = new Array<number>(64);
  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = hash[0];
    let b = hash[1];
    let c = hash[2];
    let d = hash[3];
    let e = hash[4];
    let f = hash[5];
    let g = hash[6];
    let h = hash[7];
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}
