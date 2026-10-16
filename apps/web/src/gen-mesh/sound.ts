// VOCAB-W2 + W7: the soundscape. Procedural WebAudio only (no audio files, nothing to license or download).
//
// Sources (planned in sound-plan.ts, pure and tested): every def's `components.sound` (one spec or a list; each
// instance gets a variant of its kind) plus sounds implied by what a thing is (trees rustle, flags flap, bees at flowers,
// ducks, fridges; a fountain also drips and draws pigeons), the ambience around the listener (wind rising on open and
// high ground, birds by day in the world's trees, crickets and pond frogs by night, water near water, gulls over the sea),
// residents (chatter where they gather, footsteps where they walk) and the visitor's own feet.
// Loops are built from filtered noise and oscillators; events (song phrases, steps, syllables) are scheduled each tick.
// Gain falls off with distance to the thing; at most MAX_VOICES loudest sources sound at once.
//
// New worlds only: it starts when the page publishes `window.__simEntity` (LiveWorld does that only for world-engine
// worlds), and the AudioContext is created on the first pointer/key gesture (browsers refuse audio before one).
// Quiet by default; a small speaker button (bottom right) mutes it and toggles ambient music, remembered per browser.
// `window.__edenSound.state()` reports emitters and voices; `.log()` lists which sources started where (tests, proof).
import type { WorldModel } from '@sim/world-compiler';
import { ambienceAt, condition, DEFAULT_SETTINGS, distanceTo, emittersOf, exposureAt, falloff, loadSettings, Movement, saveSettings, treeIndex, treesOf, type Emitter, type Resident, type SoundKind, type SoundSettings, type Source, type TreeIndex } from './sound-plan.ts';
import { nightOf } from './motion.ts';
import { CoverProbe } from '../world-env.ts';
import type * as THREE from 'three';

export { condition, distanceTo, falloff, emittersOf } from './sound-plan.ts';
export type { SoundKind, SoundSpec } from './sound-plan.ts';

type Cam = { position: { x: number; y: number; z: number } };
type Host = { layer: { model?: WorldModel | null; group?: THREE.Object3D; groundAt?(x: number, z: number): number | null }; camera: Cam; residents?: () => Resident[] };

const MAX_VOICES = 12, TICK_MS = 100;

// ------------------------------------------------------------------ synthesis (procedural, no files)

type Voice = { kind: SoundKind; variant: number; source: Source; out: GainNode; stop: () => void; tick: (t: number, e: Emitter) => void; gain: number };
let ctx: AudioContext | null = null, master: GainNode | null = null, noiseBuf: AudioBuffer | null = null;
let settings: SoundSettings = { ...DEFAULT_SETTINGS };

function noise(c: AudioContext) {
  if (!noiseBuf) { noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate); const d = noiseBuf.getChannelData(0); let b = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.5 + b * 2; } }
  const s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.loopStart = Math.random(); s.start(); return s;
}
const filt = (c: AudioContext, type: BiquadFilterType, f: number, q = 0.7) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
const lfo = (c: AudioContext, rate: number, depth: number, target: AudioParam) => { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = rate; g.gain.value = depth; o.connect(g).connect(target); o.start(); return o; };
/** A short enveloped tone (birdsong notes, bells, croaks, music). */
function tone(c: AudioContext, out: AudioNode, at: number, f0: number, f1: number, dur: number, peak: number, type: OscillatorType = 'sine') {
  const o = c.createOscillator(), g = c.createGain(); o.type = type;
  o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.02, dur / 4)); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(out); o.start(at); o.stop(at + dur + 0.05);
}
function burst(c: AudioContext, out: AudioNode, at: number, dur: number, peak: number, hp: number, type: BiquadFilterType = 'highpass') {
  const s = c.createBufferSource(); s.buffer = noiseBuf; const f = filt(c, type, hp), g = c.createGain();
  g.gain.setValueAtTime(peak, at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  s.connect(f).connect(g).connect(out); s.start(at, Math.random()); s.stop(at + dur + 0.02);
}
function bell(c: AudioContext, out: AudioNode, at: number, f = 1180, peak = 0.35) {
  for (const [m, a, d] of [[1, 1, 1.4], [2.0, 0.5, 0.9], [2.76, 0.35, 0.6], [5.4, 0.15, 0.3]] as const) tone(c, out, at, f * m, f * m * 0.995, d, peak * a);
}
/** A muffled syllable: a voiced buzz through two vowel formants, pitch gliding (distant chatter). */
function syllable(c: AudioContext, out: AudioNode, at: number, f0: number, dur: number, peak: number) {
  const o = c.createOscillator(), g = c.createGain(), vowels = [[700, 1200], [400, 2000], [300, 900], [600, 1700], [500, 1000]] as const, [a, b] = vowels[Math.floor(Math.random() * vowels.length)];
  o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, at); o.frequency.linearRampToValueAtTime(f0 * (0.85 + Math.random() * 0.35), at + dur);
  const f1 = filt(c, 'bandpass', a, 6), f2 = filt(c, 'bandpass', b, 8), mix = c.createGain(); mix.gain.value = 1;
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g); g.connect(f1).connect(mix); g.connect(f2).connect(mix); mix.connect(out); o.start(at); o.stop(at + dur + 0.05);
}

/** One sounding source; `variant` picks one of the kind's voicings (sound-plan VARIANTS). */
function makeVoice(c: AudioContext, kind: SoundKind, variant: number, source: Source): Voice {
  const out = c.createGain(); out.gain.value = 0;
  // residents' chatter is distant: a gentle lowpass on the whole voice
  if (kind === 'chatter') { const lp = filt(c, 'lowpass', 1500); out.connect(lp).connect(master!); } else out.connect(master!);
  const nodes: (AudioScheduledSourceNode)[] = [];
  let next = c.currentTime + Math.random() * 0.5;
  let tick: (t: number, e: Emitter) => void = () => {};
  const every = (fn: (at: number, e: Emitter) => number) => { tick = (t, e) => { let guard = 0; while (next < t + 0.3 && guard++ < 32) next += fn(next, e); }; };
  const bed = (type: BiquadFilterType, f: number, q: number, level: number) => { const n = noise(c), b = filt(c, type, f, q), g = c.createGain(); g.gain.value = level; n.connect(b).connect(g).connect(out); nodes.push(n); return { b, g }; };
  const r = Math.random;
  switch (kind) {
    case 'water':
      if (variant === 1) { const a = bed('lowpass', 500, 0.8, 1.0); nodes.push(lfo(c, 0.18, 0.45, a.g.gain)); }   // still water lapping
      else if (variant === 2) { bed('bandpass', 1600, 0.8, 0.35); every((at) => { tone(c, out, at, 900 + r() * 900, 1400 + r() * 900, 0.05, 0.12); return 0.12 + r() * 0.5; }); }   // dripping basin
      else { const a = bed('bandpass', 1100, 0.6, 0.9); nodes.push(lfo(c, 0.37, 260, a.b.frequency)); const s = bed('highpass', 3800, 0.5, 0.25); nodes.push(lfo(c, 1.7, 0.12, s.g.gain)); }   // fountain
      break;
    case 'stream': { const a = bed('lowpass', variant ? 900 : 650, 0.9, 1.1); nodes.push(lfo(c, 0.23, 180, a.b.frequency)); every((at) => { tone(c, out, at, 380 + r() * 500, 700 + r() * 600, 0.08, 0.05); return 0.15 + r() * (variant ? 0.3 : 0.5); }); break; }
    case 'waves': { const a = bed('lowpass', variant ? 700 : 450, 0.6, 1.0); nodes.push(lfo(c, variant ? 0.16 : 0.09, 0.7, a.g.gain)); nodes.push(lfo(c, variant ? 0.16 : 0.09, 250, a.b.frequency)); break; }
    case 'fire':
      bed('lowpass', variant ? 180 : 320, 0.7, variant ? 1.3 : 0.9);
      every((at) => { burst(c, out, at, 0.02 + r() * 0.05, 0.25 + r() * 0.5, variant ? 1200 : 1800); return 0.04 + r() * (variant ? 0.6 : 0.35); }); break;
    case 'wind':
      if (variant === 1) { const a = bed('bandpass', 900, 3, 0.5); nodes.push(lfo(c, 0.21, 450, a.b.frequency)); nodes.push(lfo(c, 0.05, 0.4, a.g.gain)); }   // high, gusty
      else { const a = bed('bandpass', 420, 1.2, 0.8); nodes.push(lfo(c, 0.11, 200, a.b.frequency)); nodes.push(lfo(c, 0.07, 0.3, a.g.gain)); }
      break;
    case 'creak': { const a = bed('bandpass', 380, 1.4, 0.45); nodes.push(lfo(c, 0.13, 160, a.b.frequency));
      every((at) => { tone(c, out, at, variant ? 140 : 90, variant ? 95 : 70, variant ? 0.35 : 0.5, 0.12, 'sawtooth'); return 2.2 + r() * 1.6; }); break; }
    case 'birds':
      if (variant === 1) every((at) => { const f = 520 + r() * 120; tone(c, out, at, f, f * 0.95, 0.32, 0.2); tone(c, out, at + 0.42, f * 0.8, f * 0.78, 0.45, 0.18); return 3.5 + r() * 4; });   // a dove's two notes
      else if (variant === 2) every((at) => { const n = 4 + Math.floor(r() * 6); for (let i = 0; i < n; i++) tone(c, out, at + i * 0.06, 4200 + r() * 1400, 3800 + r() * 900, 0.035, 0.12); return 0.8 + r() * 2.2; });   // sparrow chirps
      else if (variant === 3) every((at) => { let a = at, f = 3200 + r() * 600; for (let i = 0; i < 5; i++) { tone(c, out, a, f, f * 0.8, 0.16, 0.16); a += 0.2; f *= 0.92; } return 2.5 + r() * 4; });   // a falling whistle
      else every((at) => { let a = at; const f = 2400 + r() * 2200, n = 2 + Math.floor(r() * 5);
        for (let i = 0; i < n; i++) { tone(c, out, a, f * (0.9 + r() * 0.3), f * (1.1 + r() * 0.4), 0.07 + r() * 0.06, 0.18); a += 0.09 + r() * 0.07; }
        return a - at + 1.2 + r() * 3.5; });   // warbler trills
      break;
    case 'crickets': every((at) => { const f = variant ? 3600 : 4600; for (let i = 0; i < (variant ? 6 : 3); i++) tone(c, out, at + i * (variant ? 0.03 : 0.05), f, f, 0.025, 0.1); return variant ? 0.35 + r() * 0.2 : 0.6 + r() * 0.4; }); break;
    case 'bell': { const f = [1180, 880, 1480][variant] ?? 1180; every((at) => { bell(c, out, at, f); return variant === 1 ? 1.4 : 0.9; }); break; }
    case 'hum': {
      const base = variant ? 60 : 50;
      for (const [m, a] of [[1, 0.5], [2, 0.3], [3, 0.12]] as const) { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = base * m; g.gain.value = a; o.connect(g).connect(out); o.start(); nodes.push(o); }
      bed('bandpass', 2500, 2, 0.04); break; }
    case 'engine': { const o = c.createOscillator(), lp = filt(c, 'lowpass', 220, 2), g = c.createGain(); o.type = 'sawtooth'; o.frequency.value = [42, 30, 58][variant] ?? 42; g.gain.value = 0.7; o.connect(lp).connect(g).connect(out); o.start(); nodes.push(o, lfo(c, 6, 4, o.frequency)); break; }
    case 'frogs':
      if (variant === 1) every((at) => { tone(c, out, at, 2600 + r() * 400, 3100 + r() * 300, 0.08, 0.12); return 0.4 + r() * 0.9; });   // spring peepers
      else every((at) => { const f = 160 + r() * 120; for (let i = 0; i < 3; i++) tone(c, out, at + i * 0.07, f, f * 0.8, 0.06, 0.2, 'square'); return 0.6 + r() * 1.8; });
      break;
    case 'music': {
      // four pieces, all generative: pentatonic triangle tune, slow pad chords, minor plucked arpeggio, music box
      const roots = [330, 220, 262, 523], root = roots[variant] ?? 330; let i = 0;
      if (variant === 1) every((at) => { for (const s of [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]][i++ % 4]) tone(c, out, at, root * 2 ** (s / 12), root * 2 ** (s / 12), 2.6, 0.08, 'sine'); return 2.4; });
      else if (variant === 2) every((at) => { const s = [0, 3, 7, 10, 12, 10, 7, 3][i++ % 8]; tone(c, out, at, root * 2 ** (s / 12), root * 2 ** (s / 12) * 0.998, 0.35, 0.16, 'triangle'); return 0.22; });
      else if (variant === 3) every((at) => { const s = [0, 7, 12, 16, 14, 12, 7, 9][i++ % 8]; bell(c, out, at, root * 2 ** (s / 12), 0.07); return 0.36; });
      else every((at) => { const s = [0, 2, 4, 7, 9, 12, 14][(i * 3 + (i >> 2)) % 7]; tone(c, out, at, root * 2 ** (s / 12), root * 2 ** (s / 12), 0.42, 0.22, 'triangle'); if (i % 4 === 0) tone(c, out, at, root / 2, root / 2, 0.8, 0.18); i++; return 0.28; });
      break; }
    case 'chime': { const base = [1600, 1200, 2100][variant] ?? 1600; every((at) => { bell(c, out, at, base + Math.floor(r() * 4) * 240, 0.2); return 1.5 + r() * 3; }); break; }
    case 'chatter': {
      bed('bandpass', 600, 0.8, 0.05);   // room tone under the voices
      every((at, e) => { const people = Math.max(2, Math.min(6, Number(e.state.size) || 2)), who = Math.floor(r() * people), f0 = [120, 210, 165, 240, 105, 190][who] * (variant === 2 ? 1.1 : 1);
        let a = at; const n = 2 + Math.floor(r() * 5); for (let k = 0; k < n; k++) { const d = 0.09 + r() * 0.14; syllable(c, out, a, f0 * (0.95 + r() * 0.15), d, 0.22); a += d + 0.02; }
        return a - at + 0.15 + r() * (variant === 1 ? 0.3 : 0.7); });
      break; }
    case 'leaves':
      if (variant === 1) { const a = bed('bandpass', 1300, 0.5, 0.45); nodes.push(lfo(c, 0.06, 0.25, a.g.gain)); }   // pine whisper (and reeds)
      else { const a = bed('highpass', 2600, 0.6, 0.35); nodes.push(lfo(c, 0.09, 0.3, a.g.gain)); nodes.push(lfo(c, 0.23, 900, a.b.frequency));   // broadleaf rustle, gusting
        every((at) => { burst(c, out, at, 0.12 + r() * 0.25, 0.12 + r() * 0.16, 3200 + r() * 1800); return 0.25 + r() * 1.4; }); }
      break;
    case 'flag': {
      // cloth flapping: a fast flutter riding slow gusts; variant 1 adds the halyard tapping the pole
      const a = bed('bandpass', variant ? 650 : 850, 1.1, 0.3); nodes.push(lfo(c, 9 + r() * 4, 0.22, a.g.gain)); nodes.push(lfo(c, 0.12, 0.15, a.g.gain));
      every((at) => { burst(c, out, at, 0.05, 0.35, 1400, 'bandpass'); if (variant === 1 && r() < 0.35) tone(c, out, at + 0.1, 2300 + r() * 200, 2250, 0.12, 0.08, 'triangle'); return 0.8 + r() * 2.4; });
      break; }
    case 'waterfowl':
      if (variant === 1) every((at) => { const n = 2 + Math.floor(r() * 3); for (let i = 0; i < n; i++) { const b = filt(c, 'bandpass', 950, 2.5), o = c.createOscillator(), g = c.createGain(), t0 = at + i * 0.22; o.type = 'square'; o.frequency.setValueAtTime(330, t0); o.frequency.exponentialRampToValueAtTime(240, t0 + 0.13); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14); o.connect(b).connect(g).connect(out); o.start(t0); o.stop(t0 + 0.2); } return 3 + r() * 6; });   // ducks quacking
      else every((at) => { tone(c, out, at, 1900, 1150, 0.42, 0.12, 'sawtooth'); for (let i = 0; i < 2 + Math.floor(r() * 3); i++) tone(c, out, at + 0.55 + i * 0.16, 1500, 1250, 0.09, 0.09, 'sawtooth'); return 4 + r() * 7; });   // a gull's cry
      break;
    case 'bees': {
      // a few bees around flowers: detuned buzzes that come and go
      const base = variant ? 240 : 205;
      for (const d of [0, 7, -11]) { const o = c.createOscillator(), g = c.createGain(), bp = filt(c, 'bandpass', 450, 1.5); o.type = 'sawtooth'; o.frequency.value = base + d; g.gain.value = 0; o.connect(bp).connect(g).connect(out); o.start(); nodes.push(o, lfo(c, 3 + r() * 4, 6, o.frequency), lfo(c, 0.15 + r() * 0.3, 0.16, g.gain)); }
      break; }
    case 'footsteps': every((at, e) => { const sp = Math.max(0.5, Math.min(5, Number(e.state.speed) || 1.3));
      // soft earth thud, or gravel crunch; cadence follows the walker's speed
      if (variant === 1) { burst(c, out, at, 0.07, 0.5, 2400); burst(c, out, at + 0.015, 0.05, 0.3, 4200); } else { burst(c, out, at, 0.09, 0.9, 260, 'lowpass'); tone(c, out, at, 90, 60, 0.07, 0.25); }
      return Math.max(0.28, 0.75 / Math.sqrt(sp)); }); break;
  }
  return { kind, variant, source, out, gain: 0, tick: (t, e) => tick(t, e), stop: () => { for (const n of nodes) { try { n.stop(); } catch { /* stopped */ } } setTimeout(() => out.disconnect(), 200); } };
}
/** A one-shot for `mode: 'change'` (a door creak, a bell ringing, a splash). */
function oneShot(c: AudioContext, kind: SoundKind, gain: number) {
  const out = c.createGain(); out.gain.value = gain; out.connect(master!); const t = c.currentTime + 0.02;
  if (kind === 'bell' || kind === 'chime') { bell(c, out, t, kind === 'bell' ? 1180 : 1600, 0.4); bell(c, out, t + 0.45, kind === 'bell' ? 1180 : 1900, 0.3); }
  else if (kind === 'creak') tone(c, out, t, 120, 70, 0.7, 0.3, 'sawtooth');
  else if (kind === 'water' || kind === 'stream' || kind === 'waves') for (let i = 0; i < 6; i++) tone(c, out, t + i * 0.05, 500 + Math.random() * 600, 900 + Math.random() * 700, 0.07, 0.15);
  else if (kind === 'fire') for (let i = 0; i < 8; i++) burst(c, out, t + i * 0.05, 0.04, 0.4, 1500);
  else if (kind === 'footsteps') burst(c, out, t, 0.09, 0.9, 260, 'lowpass');
  else tone(c, out, t, 660, 880, 0.3, 0.3);
  setTimeout(() => out.disconnect(), 3000);
}

// ------------------------------------------------------------------ the layer

type Heard = { id: string; kind: SoundKind; variant: number; source: Source; gain: number; d: number; e: Emitter };
type LogRow = { t: number; id: string; kind: SoundKind; variant: number; source: Source; gain: number; d: number; at: [number, number, number] };
const voices = new Map<string, Voice>();
const movement = new Movement();
let objects: Emitter[] = [], ambient: Emitter[] = [], people: Emitter[] = [], lastScan = 0, lastSeq = -1, lastAmb = 0, lastHeard: Heard[] = [];
let probe: CoverProbe | null = null, probeLayer: unknown = null, covered = false;
// what the world is like around the listener: its trees (birds), its typical ground and its obstacles (wind)
let trees: TreeIndex = { count: 0, cells: new Map() }, obstacles: [number, number, number][] = [], typicalGround = 0, exposure = 0, night = 0;
function scanWorld(model: WorldModel) {
  trees = treeIndex(treesOf(model));
  obstacles = []; const ys: number[] = [];
  for (const e of model.entities.values()) {
    if (e.in.parent !== 'world') continue;
    const def = model.resolvedDef(e.def); if (!def || def.form !== 'point') continue;
    const p = model.worldPose(e), b = def.size?.box ?? [1, 1, 1], tall = (b[1] ?? 1) * p.s, wide = Math.max(b[0] ?? 1, b[2] ?? 1) * p.s;
    if (tall > 1.8) obstacles.push([p.x, Math.min(3, (tall * wide) / 12), p.z]);   // weight: how much wind it blocks
    try { ys.push(model.terrain.sample(p.x, p.z)); } catch { /* no terrain */ }
  }
  ys.sort((a, b) => a - b); typicalGround = ys.length ? ys[Math.floor(ys.length / 2)] : 0;
}
const lastValue = new Map<string, unknown>();
const log: LogRow[] = [];

function applyMaster() { if (master) master.gain.value = settings.muted ? 0 : settings.volume; }
function unlock() {
  if (ctx || typeof AudioContext === 'undefined') return;
  try { ctx = new AudioContext(); master = ctx.createGain(); applyMaster(); master.connect(ctx.destination); noise(ctx).stop(); } catch { ctx = null; }
}
/** The opt-in ambient piece: a slow pad that follows the listener (off unless the visitor turns music on). */
function musicBed(x: number, y: number, z: number): Emitter[] {
  return settings.music ? [{ id: 'amb:music', source: 'ambient', state: {}, area: false, pts: [[x, y, z]], spec: { kind: 'music', radius: 10, volume: 0.35, variant: 1 } }] : [];
}
function step(host: Host) {
  const model = host.layer.model; if (!model) return;
  const now = performance.now(), seq = (model as unknown as { editSeq?: number }).editSeq ?? -2;
  if (now - lastScan > 2000 || seq !== lastSeq) { objects = emittersOf(model); if (seq !== lastSeq || now - lastScan > 10000 || !trees.count) scanWorld(model); lastScan = now; lastSeq = seq; }
  const { x, y, z } = host.camera.position;
  const ground = host.layer.groundAt?.(x, z) ?? null;
  if (now - lastAmb > 500) {
    lastAmb = now;
    if (host.layer.group && probeLayer !== host.layer) { probe = new CoverProbe(() => [host.layer.group!]); probeLayer = host.layer; }
    covered = !!probe && probe.test(x, y, z);
    let waters: { area?: [number, number][]; path?: [number, number][]; w?: number; level: number }[] = [], seaLevel: number | undefined;
    try { const g = model.ground() as { waters?: typeof waters; seaLevel?: number }; waters = g.waters ?? []; seaLevel = g.seaLevel; } catch { /* no ground yet */ }
    night = nightOf(model);
    exposure = ground === null ? 0 : exposureAt(x, z, ground, typicalGround, obstacles);
    ambient = [...ambienceAt({ x, y, z, ground, night, covered, waters, seaLevel, trees, exposure }), ...musicBed(x, y, z)];
  }
  people = movement.emitters(host.residents?.() ?? [], { x, y, z, ground }, now / 1000);
  const heard: Heard[] = [];
  for (const e of [...objects, ...ambient, ...people]) {
    const d = distanceTo(e, x, y, z);
    if (e.spec.mode === 'change') {
      const k = (e.spec.when ?? '').replace(/^!/, ''), v = e.state[k], prev = lastValue.get(e.id);
      lastValue.set(e.id, v);
      if (prev !== undefined && prev !== v && condition(e.spec.when, e.state, night) && ctx) { const g = falloff(d, e.spec.radius, e.spec.volume); if (g > 0.001) oneShot(ctx, e.spec.kind, g); }
      continue;
    }
    if (!condition(e.spec.when, e.state, night)) continue;
    // indoors, the outside world is muffled; things in the room are not
    const g = falloff(d, e.spec.radius, e.spec.volume) * (covered && e.source === 'object' && d > 8 ? 0.4 : 1);
    if (g > 0.001) heard.push({ id: e.id, kind: e.spec.kind, variant: e.spec.variant ?? 0, source: e.source, gain: g, d, e });
  }
  heard.sort((a, b) => b.gain - a.gain); heard.length = Math.min(heard.length, MAX_VOICES);
  lastHeard = heard;
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  const live = new Set(heard.map((h) => h.id)), t = ctx.currentTime;
  for (const h of heard) {
    let v = voices.get(h.id);
    if (v && (v.kind !== h.kind || v.variant !== h.variant)) { v.stop(); voices.delete(h.id); v = undefined; }
    if (!v) {
      v = makeVoice(ctx, h.kind, h.variant, h.source); voices.set(h.id, v);
      const p = h.e.pts[0];
      log.push({ t: Math.round(now), id: h.id, kind: h.kind, variant: h.variant, source: h.source, gain: +h.gain.toFixed(3), d: +h.d.toFixed(1), at: [+p[0].toFixed(1), +p[1].toFixed(1), +p[2].toFixed(1)] }); if (log.length > 400) log.splice(0, log.length - 400);
    }
    v.gain = h.gain; v.out.gain.setTargetAtTime(h.gain, t, 0.25); v.tick(t, h.e);
  }
  for (const [id, v] of voices) if (!live.has(id)) { v.out.gain.setTargetAtTime(0, t, 0.2); v.stop(); voices.delete(id); }
}

// ------------------------------------------------------------------ the speaker button

const ICON_ON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const ICON_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const ICON_NOTE = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 17V5l10-2v12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="6.5" cy="17" r="2.5" fill="currentColor"/><circle cx="16.5" cy="15" r="2.5" fill="currentColor"/></svg>';
let ui: HTMLDivElement | null = null;
function store() { try { return window.localStorage; } catch { return null; } }
function setSettings(next: Partial<SoundSettings>) { settings = { ...settings, ...next }; saveSettings(store(), settings); applyMaster(); lastAmb = 0; renderUi(); }
function renderUi() {
  if (!ui) return;
  const [mute, music] = ui.querySelectorAll('button');
  mute.innerHTML = settings.muted ? ICON_OFF : ICON_ON; mute.setAttribute('aria-pressed', String(!settings.muted));
  mute.title = settings.muted ? 'Sound is off: turn on' : 'Sound is on: mute'; mute.setAttribute('aria-label', mute.title);
  music.innerHTML = ICON_NOTE; music.setAttribute('aria-pressed', String(settings.music)); music.hidden = settings.muted;
  music.title = settings.music ? 'Music is on: turn off' : 'Music is off: turn on'; music.setAttribute('aria-label', music.title);
  music.style.opacity = settings.music ? '1' : '0.55';
}
function mountUi() {
  if (ui || typeof document === 'undefined' || !document.body) return;
  ui = document.createElement('div'); ui.className = 'eden-sound-toggle';
  ui.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:30;display:flex;gap:6px;';
  const btn = () => { const b = document.createElement('button'); b.type = 'button'; b.style.cssText = 'width:34px;height:34px;border-radius:17px;border:1px solid rgba(255,255,255,.35);background:rgba(20,22,26,.55);color:#f4efe2;display:grid;place-items:center;cursor:pointer;padding:0;backdrop-filter:blur(4px);'; return b; };
  const mute = btn(), music = btn(); mute.dataset.sound = 'mute'; music.dataset.sound = 'music';
  mute.addEventListener('click', (e) => { e.stopPropagation(); unlock(); setSettings({ muted: !settings.muted }); });
  music.addEventListener('click', (e) => { e.stopPropagation(); unlock(); setSettings({ music: !settings.music }); });
  ui.append(mute, music); document.body.append(ui); renderUi();
}

/** Starts once per page; idles until a world-engine world publishes its host object. */
export function startSoundLayer() {
  if (typeof window === 'undefined' || (window as unknown as { __edenSound?: unknown }).__edenSound) return;
  settings = loadSettings(store());
  const w = window as unknown as { __simEntity?: Host; __edenSound?: unknown };
  w.__edenSound = {
    state: () => ({ ctx: ctx?.state ?? 'none', muted: settings.muted, music: settings.music, volume: settings.volume, covered,
      world: { trees: trees.count, exposure: +exposure.toFixed(2), night: +night.toFixed(2), typicalGround: +typicalGround.toFixed(1) },
      emitters: [...objects, ...ambient, ...people].map((e) => ({ id: e.id, kind: e.spec.kind, variant: e.spec.variant ?? 0, source: e.source, when: e.spec.when ?? null, on: condition(e.spec.when, e.state, night) })),
      heard: lastHeard.map(({ e: _e, ...h }) => ({ ...h, gain: +h.gain.toFixed(3), d: +h.d.toFixed(1) })),
      voices: [...voices.entries()].map(([id, v]) => ({ id, kind: v.kind, variant: v.variant, source: v.source, gain: +v.gain.toFixed(3) })) }),
    log: () => log.slice(),
    mute: (m: boolean) => setSettings({ muted: m }),
    music: (m: boolean) => setSettings({ music: m }),
    unlock,
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) window.addEventListener(ev, unlock, { capture: true, passive: true });
  setInterval(() => { const host = w.__simEntity; if (host?.camera && host.layer) { mountUi(); try { step(host); } catch { /* a world mid-reload */ } } }, TICK_MS);
}
startSoundLayer();
