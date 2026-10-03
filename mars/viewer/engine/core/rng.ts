// Seeded, serialisable PRNG (sfc32). State is four uint32s so it can be
// checkpointed with the world and resumed exactly.
export type RngState = [number, number, number, number];

export function seedRng(seed: string | number): RngState {
  // xmur3 string hash → four seeds
  const s = String(seed);
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  const next = () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
  const st: RngState = [next(), next(), next(), next()];
  for (let i = 0; i < 12; i++) nextRandom(st);
  return st;
}

/** Advances state in place; returns [0, 1). */
export function nextRandom(st: RngState): number {
  let [a, b, c, d] = st;
  a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  st[0] = a >>> 0; st[1] = b >>> 0; st[2] = c >>> 0; st[3] = d >>> 0;
  return (t >>> 0) / 4294967296;
}
