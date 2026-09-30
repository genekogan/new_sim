// sfc32, state lives inside WorldState so the fold is pure (Mars core/rng.ts).
export type RngState = [number, number, number, number];

export function seedRng(seed: string | number): RngState {
  const s = String(seed);
  let h = 1779033703 ^ s.length;
  const st: number[] = [];
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    st.push((h ^= h >>> 16) >>> 0);
  }
  const rng = st as RngState;
  for (let i = 0; i < 12; i++) nextU32(rng);
  return rng;
}

/** Advances the state in place and returns a uint32. */
export function nextU32(s: RngState): number {
  const t = (((s[0] + s[1]) | 0) + s[3]) | 0;
  s[3] = (s[3] + 1) | 0;
  s[0] = s[1] ^ (s[1] >>> 9);
  s[1] = (s[2] + (s[2] << 3)) | 0;
  s[2] = (s[2] << 21) | (s[2] >>> 11);
  s[2] = (s[2] + t) | 0;
  return t >>> 0;
}

/** Uniform float in [0,1). */
export const nextFloat = (s: RngState) => nextU32(s) / 4294967296;
/** Integer in [0, n). */
export const nextInt = (s: RngState, n: number) => Math.floor(nextFloat(s) * n);
