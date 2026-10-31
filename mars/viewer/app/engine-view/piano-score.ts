// A Soul at the piano plays one deterministic score (seeded by its body id), clocked by depicted world seconds. The
// visitor's audio and the hand pose read the same notes, so every key strike is heard at the moment it is seen, and
// every viewer hears the same performance. No server state: the score is a pure function of (body, world time).
export const PIANO_STEP = 0.25;            // s per step (eighth notes at 120 bpm)
const BAR = 32;                            // steps per phrase (8 s), then the piece repeats
export type PianoNote = { t: number; midi: number; hand: 0 | 1; vel: number };
// Melodies: semitones above C5 (null = rest). Chords: bass roots above C3, one per 8 steps.
const PIECES: { melody: (number | null)[]; roots: number[] }[] = [
  { melody: [0, null, 4, 7, 9, null, 7, 4, 2, null, 4, 2, 0, null, null, null, 4, null, 7, 9, 12, null, 9, 7, 4, null, 2, 4, 0, null, null, null], roots: [0, -3, 5, 7] },
  { melody: [7, null, 9, 12, 9, null, 7, null, 4, null, 7, 9, 7, null, null, null, 2, 4, 7, null, 9, null, 7, 4, 2, null, 0, null, null, null, null, null], roots: [0, 5, -3, 7] },
  { melody: [-3, null, 0, 2, 4, null, 2, 0, -3, null, null, -5, -3, null, null, null, 0, 2, 4, null, 7, null, 4, 2, 0, null, -3, null, null, null, null, null], roots: [-3, 5, 0, 7] },
  { melody: [12, null, 11, null, 9, null, 7, null, 9, null, 7, null, 4, null, null, null, 5, null, 7, null, 9, null, 12, null, 11, null, 9, null, 7, null, null, null], roots: [0, -3, 5, 7] },
];
function hash(s: string) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
const pieceOf = (seed: string) => PIECES[hash(seed) % PIECES.length];
/** The notes this player starts in [a, b) world seconds (left hand: bass on every half bar; right hand: the melody). */
export function pianoNotes(seed: string, a: number, b: number): PianoNote[] {
  const p = pieceOf(seed), out: PianoNote[] = [];
  for (let k = Math.ceil(a / PIANO_STEP - 1e-9); k * PIANO_STEP < b; k++) {
    const i = ((k % BAR) + BAR) % BAR, t = k * PIANO_STEP, m = p.melody[i];
    if (i % 4 === 0) out.push({ t, midi: 48 + p.roots[Math.floor(i / 8)] + (i % 8 === 4 ? 7 : 0), hand: 0, vel: 0.7 });
    if (m !== null) out.push({ t, midi: 72 + m, hand: 1, vel: i % 8 === 0 ? 0.9 : 0.75 });
  }
  return out;
}
/** Each hand's key strike (1 at the onset, back to 0 over STRIKE s) and its sideways place along the keys (metres, ±). */
export const STRIKE = 0.18;
export function pianoHands(seed: string, t: number): [{ press: number; along: number }, { press: number; along: number }] {
  const recent = pianoNotes(seed, t - 2, t + 1e-6), hands: [{ press: number; along: number }, { press: number; along: number }] = [{ press: 0, along: 0 }, { press: 0, along: 0 }];
  for (const hand of [0, 1] as const) {
    const last = recent.filter(n => n.hand === hand).at(-1); if (!last) continue;
    const since = t - last.t, centre = hand === 0 ? 50 : 76;
    hands[hand] = { press: since < STRIKE ? 1 - since / STRIKE : 0, along: Math.max(-0.07, Math.min(0.07, (last.midi - centre) * 0.007)) };
  }
  return hands;
}
// Entry 26: a drummer plays on the piano's own clock (the same PIANO_STEP grid and 32-step phrase), so a pianist and a drummer
// near each other are in time: the kick and snare mark the half bars the piano's left hand plays, the hi-hat the eighths, and
// a tom fill closes every other phrase where the piano's phrase ends. Seeded per player for small variations (hat density,
// kick pickup). Pure function of (player, world time), like the piano.
export type DrumHit = { t: number; kind: 'kick' | 'snare' | 'hat' | 'tom' | 'crash'; hand: 0 | 1 | -1; vel: number };
export function drumHits(seed: string, a: number, b: number): DrumHit[] {
  const h = hash('drums:' + seed), sparse = h % 3 === 0, pickup = h % 2 === 0, out: DrumHit[] = [];
  for (let k = Math.ceil(a / PIANO_STEP - 1e-9); k * PIANO_STEP < b; k++) {
    const i = ((k % BAR) + BAR) % BAR, phrase = Math.floor(k / BAR), t = k * PIANO_STEP, fill = phrase % 2 === 1 && i >= 28;
    if (i === 0 && phrase % 2 === 0) out.push({ t, kind: 'crash', hand: 1, vel: 0.7 });
    if (i % 8 === 0 || (pickup && i % 8 === 6 && !fill)) out.push({ t, kind: 'kick', hand: -1, vel: i % 8 === 0 ? 0.95 : 0.7 });
    if (fill) { out.push({ t, kind: 'tom', hand: (i % 2) as 0 | 1, vel: 0.65 + (i - 28) * 0.08 }); continue; }
    if (i % 8 === 4) out.push({ t, kind: 'snare', hand: 0, vel: 0.85 });
    if (!(i === 0 && phrase % 2 === 0) && (!sparse || i % 2 === 0)) out.push({ t, kind: 'hat', hand: 1, vel: i % 2 === 0 ? 0.5 : 0.32 });
  }
  return out;
}
/** Each stick's height above its drum (0 at a hit; it lifts after a hit and comes back down onto the next, so the stick
 *  meets the drum exactly when the hit is heard) and where it plays: 0 hi-hat/snare, 1 tom/cymbal. */
export function drumHands(seed: string, t: number): [{ lift: number; reach: number }, { lift: number; reach: number }] {
  const around = drumHits(seed, t - 1.5, t + 1.5), out: [{ lift: number; reach: number }, { lift: number; reach: number }] = [{ lift: 1, reach: 0 }, { lift: 1, reach: 0 }];
  for (const hand of [0, 1] as const) {
    const mine = around.filter((n) => n.hand === hand), last = mine.filter((n) => n.t <= t + 1e-9).at(-1), next = mine.find((n) => n.t > t + 1e-9);
    const since = last ? t - last.t : 9, until = next ? next.t - t : 9, k = Math.min(1, Math.min(since, until) / 0.12);
    out[hand] = { lift: k * k * (3 - 2 * k), reach: (until < since ? next : last)?.kind === 'tom' || (until < since ? next : last)?.kind === 'crash' ? 1 : 0 };
  }
  return out;
}
