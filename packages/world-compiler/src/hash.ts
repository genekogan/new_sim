// Stable hashing for defs and bake keys. Node and browsers both have SubtleCrypto,
// but defs must hash synchronously at define time, so this is a pure-JS SHA-256.
// Same output as the map/filter/sort/join form ('[' + v.map(f).join(',') + ']', '{' + sorted defined keys k:f(v) + '}'),
// built in one pass with a small memo of quoted keys: bake keys stringify a building's params once per child (L3e).
const quotedKeys = new Map<string, string>();
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) {
    let s = '[';
    for (let i = 0; i < v.length; i++) { if (i) s += ','; const x = stableStringify(v[i]); if (x !== undefined) s += x; } // join() writes undefined as ''
    return s + ']';
  }
  const o = v as Record<string, unknown>, keys: string[] = [];
  for (const k of Object.keys(o)) if (o[k] !== undefined) keys.push(k);
  keys.sort();
  let s = '{';
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]; let q = quotedKeys.get(k);
    if (q === undefined) { q = JSON.stringify(k) + ':'; if (quotedKeys.size < 4096) quotedKeys.set(k, q); }
    if (i) s += ',';
    s += q + stableStringify(o[k]);
  }
  return s + '}';
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
export function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const l = bytes.length, padded = new Uint8Array(((l + 9 + 63) >> 6) << 6);
  padded.set(bytes); padded[l] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, (l * 8) >>> 0); dv.setUint32(padded.length - 8, Math.floor((l * 8) / 4294967296));
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), maj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
}
export const hashOf = (v: unknown) => sha256Hex(stableStringify(v));
/** In-memory cache key for content (bake keys): two independent 32-bit string hashes plus the length of the stable JSON.
 *  Not for anything persisted or compared across processes (use hashOf); ~20x cheaper than the pure-JS SHA-256, which
 *  dominated a big world's first frame (Eden 2026: ~1.1 s of bake keys while drawing). */
export function cacheKeyOf(v: unknown): string { return cacheKeyOfText(stableStringify(v)); }
/** cacheKeyOf of text that is already the stable JSON. */
export function cacheKeyOfText(s: string): string {
  let a = 0x811c9dc5 | 0, b = 0x9e3779b9 | 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b ^ c, 0x5bd1e995); b ^= b >>> 15; }
  a = Math.imul(a ^ (a >>> 16), 0x85ebca6b); b = Math.imul(b ^ (b >>> 13), 0xc2b2ae35);
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0') + s.length.toString(36);
}
/** Short, URL-safe id from a counter and a world seed; ids are unique per world and never reused. */
export function entityId(seq: number, worldSeed: string): string {
  return 'e_' + sha256Hex(`${worldSeed}:${seq}`).slice(0, 8);
}
