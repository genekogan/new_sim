// Soul Actions entry 37: a radio's stations, generated in the client from the shared clock. Each station is a pure function
// of (station, depicted world seconds), like the piano's score (entry 14) and the jukebox (entry 20): every viewer near any
// radio tuned to a station hears the same events at the same moment, and two radios on one station play in step. No files,
// no server state. sound.ts schedules these events a short way ahead into the radio's own station channel.
import { pianoNotes } from '../../../../mars/viewer/app/engine-view/piano-score.ts';

export type RadioEvent =
  | { t: number; kind: 'key' | 'bass' | 'lead'; midi: number; vel: number }
  | { t: number; kind: 'kick' | 'snare' | 'hat'; vel: number }
  | { t: number; kind: 'syl'; f0: number; dur: number; vowel: number; vel: number };

/** The stations in dial order (left to right); the def's `station` enum (core/radio@2) names the same three. */
export const RADIO_STATIONS = ['quiet piano', 'dance band', 'evening talk'] as const;

function hash(s: string) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

/** Quiet piano: the piano score clock slowed to 0.4 s a step (75 bpm), soft. */
const SLOW = 1.6;
function quietPiano(a: number, b: number): RadioEvent[] {
  return pianoNotes('station:quiet piano', a / SLOW, b / SLOW).map((n) => ({ t: n.t * SLOW, kind: 'key' as const, midi: n.midi, vel: n.vel * 0.7 }));
}
/** Dance band: the score's bass an octave down and plucked, the melody as a reedy lead, a kick on every beat, a snare on
 *  two and four, and a hat on the off-beats (120 bpm). */
function danceBand(a: number, b: number): RadioEvent[] {
  const out: RadioEvent[] = pianoNotes('station:dance band', a, b).map((n) => n.hand === 0
    ? { t: n.t, kind: 'bass' as const, midi: n.midi - 12, vel: n.vel }
    : { t: n.t, kind: 'lead' as const, midi: n.midi, vel: n.vel });
  for (let k = Math.ceil(a / 0.25 - 1e-9); k * 0.25 < b; k++) {
    const t = k * 0.25;
    if (k % 2 === 0) out.push({ t, kind: 'kick', vel: 1 });
    if (k % 4 === 2) out.push({ t, kind: 'snare', vel: 0.8 });
    if (k % 2 === 1) out.push({ t, kind: 'hat', vel: 0.6 });
  }
  return out.sort((x, y) => x.t - y.t);
}
/** Evening talk: two voices taking turns of 7 s (a lower and a higher one), syllables of words with short gaps between
 *  words, falling pitch over each sentence and a breath at its end. */
export const TALK_SLOT = 0.17, TALK_TURN = 7;
function eveningTalk(a: number, b: number): RadioEvent[] {
  const out: RadioEvent[] = [];
  for (let k = Math.ceil(a / TALK_SLOT - 1e-9); k * TALK_SLOT < b; k++) {
    const t = k * TALK_SLOT, turn = Math.floor(t / TALK_TURN), into = t - turn * TALK_TURN;
    if (into > TALK_TURN - 0.75) continue;                       // the breath between turns
    const h = hash('talk:' + k);
    if (h % 5 === 0) continue;                                   // a gap between words
    const voice = turn % 2, base = voice ? 196 : 112;
    const f0 = base * (1 - 0.14 * into / TALK_TURN) * (1 + 0.08 * Math.sin(t * 2.7 + turn)) * (0.94 + ((h >>> 8) & 15) / 125);
    out.push({ t, kind: 'syl', f0, dur: 0.1 + ((h >>> 12) & 7) / 100, vowel: (h >>> 4) % 5, vel: 0.75 + ((h >>> 16) & 7) / 28 });
  }
  return out;
}

/** The events a station starts in [a, b) world seconds (unknown names play the first station). */
export function stationEvents(station: string, a: number, b: number): RadioEvent[] {
  if (station === 'dance band') return danceBand(a, b);
  if (station === 'evening talk') return eveningTalk(a, b);
  return quietPiano(a, b);
}

/** A station change: the old station fades out, a burst of static (with a heterodyne whistle that sweeps as the needle
 *  passes between stations) covers the gap, and the new station fades in and locks. Seconds after the change. */
export const TUNE = { fromOut: 0.3, staticUp: 0.06, staticHold: 0.45, staticOut: 0.8, toIn: 0.4, toLocked: 0.85 } as const;
/** The same timeline as levels in 0..1 (tests and proof; sound.ts schedules it as gain ramps). */
export function tuneMix(s: number) {
  const lin = (v: number) => Math.max(0, Math.min(1, v));
  return {
    from: s < 0 ? 1 : 1 - lin(s / TUNE.fromOut),
    static: s < 0 ? 0 : lin(s / TUNE.staticUp) * (1 - lin((s - TUNE.staticHold) / (TUNE.staticOut - TUNE.staticHold))),
    to: s < 0 ? 0 : lin((s - TUNE.toIn) / (TUNE.toLocked - TUNE.toIn)),
  };
}
