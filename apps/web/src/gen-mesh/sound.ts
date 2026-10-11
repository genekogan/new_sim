// VOCAB-W2: the sound layer. A def declares `components.sound = { kind, radius, volume, when?, mode? }` and the viewer
// plays it with procedural WebAudio (no audio files): a loop while the condition holds (`when: 'on' | '!open' | 'lit'`,
// a state field of the entity), or a one-shot each time that field changes (`mode: 'change'`). Gain falls off with the
// camera's distance to the thing (a point, the nearest point of a path, or an area's outline/inside) and is 0 beyond
// `radius`. At most MAX_VOICES nearest sources sound at once.
//
// New worlds only: it starts when the page publishes `window.__simEntity` (LiveWorld does that only for world-engine
// worlds), and the AudioContext is created on the first pointer/key gesture (browsers refuse audio before one).
// `window.__edenSound.state()` reports emitters and voices for tests; `window.__edenSound.mute(true)` silences it.
import type { Entity, StoredDef, WorldModel } from '@sim/world-compiler';

export type SoundKind = 'water' | 'stream' | 'fire' | 'wind' | 'creak' | 'birds' | 'bell' | 'hum' | 'engine' | 'chime' | 'frogs' | 'music';
export type SoundSpec = { kind: SoundKind; radius: number; volume: number; when?: string; mode?: 'loop' | 'change' };
type Cam = { position: { x: number; y: number; z: number } };
type Host = { layer: { model?: WorldModel | null }; camera: Cam };
type Emitter = { id: string; spec: SoundSpec; pts: [number, number, number][]; area: boolean; state: Record<string, unknown> };

const KINDS = new Set<SoundKind>(['water', 'stream', 'fire', 'wind', 'creak', 'birds', 'bell', 'hum', 'engine', 'chime', 'frogs', 'music']);
const MAX_VOICES = 8, TICK_MS = 100, MASTER = 0.55;
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** The condition `when` against an entity's state (with the def's state defaults): 'on', '!open', 'level>0.5' is not supported. */
export function condition(when: string | undefined, state: Record<string, unknown>): boolean {
  if (!when) return true;
  const neg = when.startsWith('!'), k = neg ? when.slice(1) : when, v = state[k];
  const truthy = typeof v === 'number' ? v > 0 : !!v;
  return neg ? !truthy : truthy;
}
/** Distance from (x, y, z) to an emitter: a point, a polyline, or a polygon (0 inside). */
export function distanceTo(e: Pick<Emitter, 'pts' | 'area'>, x: number, y: number, z: number): number {
  const P = e.pts;
  if (P.length === 1) return Math.hypot(P[0][0] - x, P[0][1] - y, P[0][2] - z);
  let best = Infinity, inside = false;
  const n = e.area ? P.length : P.length - 1;
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % P.length], dx = b[0] - a[0], dz = b[2] - a[2], L = dx * dx + dz * dz;
    const t = L > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / L)) : 0;
    const px = a[0] + dx * t, pz = a[2] + dz * t, py = a[1] + (b[1] - a[1]) * t;
    best = Math.min(best, Math.hypot(px - x, py - y, pz - z));
    if (e.area && ((a[2] > z) !== (b[2] > z)) && x < a[0] + ((z - a[2]) / (b[2] - a[2])) * (b[0] - a[0])) inside = !inside;
  }
  return inside ? Math.abs(y - P[0][1]) * 0.25 : best;
}
/** Loudness 0..1 of an emitter heard from distance d (smooth quadratic fall-off to 0 at the radius). */
export const falloff = (d: number, radius: number, volume: number) => (d >= radius ? 0 : volume * (1 - d / radius) ** 2);

function specOf(def: StoredDef | undefined): SoundSpec | null {
  const s = (def?.components as { sound?: Partial<SoundSpec> } | undefined)?.sound;
  if (!s?.kind) return null;
  return { kind: s.kind, radius: num(s.radius, 14), volume: num(s.volume, 0.5), when: s.when, mode: s.mode ?? 'loop' };
}
/** Every entity with a sound in the model, with its world position(s) and current state (def defaults filled). */
export function emittersOf(model: WorldModel): Emitter[] {
  const out: Emitter[] = [];
  for (const e of model.entities.values()) {
    const def = model.resolvedDef(e.def), spec = specOf(def);
    if (!def || !spec) continue;
    const state: Record<string, unknown> = {};
    for (const [k, f] of Object.entries(def.state ?? {})) state[k] = (f as { default?: unknown }).default;
    Object.assign(state, e.state ?? {});
    // a def may let each instance pick its sound and loudness (params `sound`, `loudness`)
    const p = e.params ?? {}, kind = p.sound, loud = p.loudness;
    const s = { ...spec, ...(typeof kind === 'string' && KINDS.has(kind as SoundKind) ? { kind: kind as SoundKind } : {}), ...(typeof loud === 'number' ? { volume: Math.max(0, Math.min(1, loud)) } : {}) };
    out.push({ id: e.id, spec: s, state, ...placeOf(model, e, def) });
  }
  return out;
}
function placeOf(model: WorldModel, e: Entity, def: StoredDef): Pick<Emitter, 'pts' | 'area'> {
  const g = (x: number, z: number) => { try { return model.terrain.sample(x, z); } catch { return 0; } };
  if (def.form !== 'point' && e.in.parent === 'world' && e.shape) {
    const raw = 'path' in e.shape ? e.shape.path : e.shape.area;
    const step = Math.max(1, Math.floor(raw.length / 64));
    const pts = raw.filter((_, i) => i % step === 0).map(([x, z]) => [x, g(x, z), z] as [number, number, number]);
    return { pts, area: 'area' in e.shape };
  }
  const p = model.worldPose(e), h = (def.size?.box?.[1] ?? 1) * p.s * 0.5;
  return { pts: [[p.x, p.y + h, p.z]], area: false };
}

// ------------------------------------------------------------------ synthesis (procedural, no files)

type Voice = { kind: SoundKind; out: GainNode; stop: () => void; tick: (t: number) => void; gain: number };
let ctx: AudioContext | null = null, master: GainNode | null = null, noiseBuf: AudioBuffer | null = null, muted = false;

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
function burst(c: AudioContext, out: AudioNode, at: number, dur: number, peak: number, hp: number) {
  const s = c.createBufferSource(); s.buffer = noiseBuf; const f = filt(c, 'highpass', hp), g = c.createGain();
  g.gain.setValueAtTime(peak, at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  s.connect(f).connect(g).connect(out); s.start(at, Math.random()); s.stop(at + dur + 0.02);
}
function bell(c: AudioContext, out: AudioNode, at: number, f = 1180, peak = 0.35) {
  for (const [m, a, d] of [[1, 1, 1.4], [2.0, 0.5, 0.9], [2.76, 0.35, 0.6], [5.4, 0.15, 0.3]] as const) tone(c, out, at, f * m, f * m * 0.995, d, peak * a);
}

/** One sounding source. Loops are built from filtered noise and oscillators; events are scheduled on each tick. */
function makeVoice(c: AudioContext, kind: SoundKind): Voice {
  const out = c.createGain(); out.gain.value = 0; out.connect(master!);
  const nodes: (AudioScheduledSourceNode)[] = [];
  let next = c.currentTime + Math.random() * 0.5;
  let tick: (t: number) => void = () => {};
  const bed = (type: BiquadFilterType, f: number, q: number, level: number) => { const n = noise(c), b = filt(c, type, f, q), g = c.createGain(); g.gain.value = level; n.connect(b).connect(g).connect(out); nodes.push(n); return { b, g }; };
  switch (kind) {
    case 'water': { const a = bed('bandpass', 1100, 0.6, 0.9); nodes.push(lfo(c, 0.37, 260, a.b.frequency)); const s = bed('highpass', 3800, 0.5, 0.25); nodes.push(lfo(c, 1.7, 0.12, s.g.gain)); break; }
    case 'stream': { const a = bed('lowpass', 650, 0.9, 1.1); nodes.push(lfo(c, 0.23, 180, a.b.frequency)); tick = (t) => { while (next < t + 0.3) { tone(c, out, next, 380 + Math.random() * 500, 700 + Math.random() * 600, 0.08, 0.05); next += 0.15 + Math.random() * 0.5; } }; break; }
    case 'fire': { bed('lowpass', 320, 0.7, 0.9); tick = (t) => { while (next < t + 0.3) { burst(c, out, next, 0.02 + Math.random() * 0.05, 0.25 + Math.random() * 0.5, 1800); next += 0.04 + Math.random() * 0.35; } }; break; }
    case 'wind': { const a = bed('bandpass', 420, 1.2, 0.8); nodes.push(lfo(c, 0.11, 200, a.b.frequency)); nodes.push(lfo(c, 0.07, 0.3, a.g.gain)); break; }
    case 'creak': { const a = bed('bandpass', 380, 1.4, 0.45); nodes.push(lfo(c, 0.13, 160, a.b.frequency));
      tick = (t) => { while (next < t + 0.3) { tone(c, out, next, 90, 70, 0.5, 0.12, 'sawtooth'); next += 2.2 + Math.random() * 1.6; } }; break; }
    case 'birds': tick = (t) => { while (next < t + 0.3) { let at = next; const f = 2400 + Math.random() * 2200, n = 2 + Math.floor(Math.random() * 5);
      for (let i = 0; i < n; i++) { tone(c, out, at, f * (0.9 + Math.random() * 0.3), f * (1.1 + Math.random() * 0.4), 0.07 + Math.random() * 0.06, 0.18); at += 0.09 + Math.random() * 0.07; }
      next = at + 1.2 + Math.random() * 3.5; } }; break;
    case 'bell': tick = (t) => { while (next < t + 0.3) { bell(c, out, next); next += 0.9; } }; break;
    case 'hum': { for (const [f, a] of [[50, 0.5], [100, 0.3], [150, 0.12]] as const) { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = f; g.gain.value = a; o.connect(g).connect(out); o.start(); nodes.push(o); } bed('bandpass', 2500, 2, 0.04); break; }
    case 'engine': { const o = c.createOscillator(), lp = filt(c, 'lowpass', 220, 2), g = c.createGain(); o.type = 'sawtooth'; o.frequency.value = 42; g.gain.value = 0.7; o.connect(lp).connect(g).connect(out); o.start(); nodes.push(o, lfo(c, 6, 4, o.frequency)); break; }
    case 'frogs': tick = (t) => { while (next < t + 0.3) { const f = 160 + Math.random() * 120; for (let i = 0; i < 3; i++) tone(c, out, next + i * 0.07, f, f * 0.8, 0.06, 0.2, 'square'); next += 0.6 + Math.random() * 1.8; } }; break;
    case 'music': { const scale = [0, 2, 4, 7, 9, 12, 14], root = 330; let i = 0;
      tick = (t) => { while (next < t + 0.3) { const s = scale[(i * 3 + (i >> 2)) % scale.length]; tone(c, out, next, root * 2 ** (s / 12), root * 2 ** (s / 12), 0.42, 0.22, 'triangle'); if (i % 4 === 0) tone(c, out, next, root / 2, root / 2, 0.8, 0.18); i++; next += 0.28; } }; break; }
    case 'chime': tick = (t) => { while (next < t + 0.3) { bell(c, out, next, 1600 + Math.floor(Math.random() * 4) * 240, 0.2); next += 1.5 + Math.random() * 3; } }; break;
  }
  return { kind, out, gain: 0, tick: (t) => tick(t), stop: () => { for (const n of nodes) { try { n.stop(); } catch { /* stopped */ } } setTimeout(() => out.disconnect(), 200); } };
}
/** A one-shot for `mode: 'change'` (a door creak, a bell ringing, a splash). */
function oneShot(c: AudioContext, kind: SoundKind, gain: number) {
  const out = c.createGain(); out.gain.value = gain; out.connect(master!); const t = c.currentTime + 0.02;
  if (kind === 'bell' || kind === 'chime') { bell(c, out, t, kind === 'bell' ? 1180 : 1600, 0.4); bell(c, out, t + 0.45, kind === 'bell' ? 1180 : 1900, 0.3); }
  else if (kind === 'creak') tone(c, out, t, 120, 70, 0.7, 0.3, 'sawtooth');
  else if (kind === 'water' || kind === 'stream') for (let i = 0; i < 6; i++) tone(c, out, t + i * 0.05, 500 + Math.random() * 600, 900 + Math.random() * 700, 0.07, 0.15);
  else if (kind === 'fire') for (let i = 0; i < 8; i++) burst(c, out, t + i * 0.05, 0.04, 0.4, 1500);
  else tone(c, out, t, 660, 880, 0.3, 0.3);
  setTimeout(() => out.disconnect(), 3000);
}

// ------------------------------------------------------------------ the layer

const voices = new Map<string, Voice>();
let emitters: Emitter[] = [], lastScan = 0, lastSeq = -1, lastHeard: { id: string; kind: SoundKind; gain: number; d: number }[] = [];
const lastValue = new Map<string, unknown>();

function unlock() {
  if (ctx || typeof AudioContext === 'undefined') return;
  try { ctx = new AudioContext(); master = ctx.createGain(); master.gain.value = muted ? 0 : MASTER; master.connect(ctx.destination); noise(ctx).stop(); } catch { ctx = null; }
}
function step(host: Host) {
  const model = host.layer.model; if (!model) return;
  const now = performance.now(), seq = (model as unknown as { editSeq?: number }).editSeq ?? -2;
  if (now - lastScan > 2000 || seq !== lastSeq) { emitters = emittersOf(model); lastScan = now; lastSeq = seq; }
  const { x, y, z } = host.camera.position;
  const heard: typeof lastHeard = [];
  for (const e of emitters) {
    const d = distanceTo(e, x, y, z);
    if (e.spec.mode === 'change') {
      const k = (e.spec.when ?? '').replace(/^!/, ''), v = e.state[k], prev = lastValue.get(e.id);
      lastValue.set(e.id, v);
      if (prev !== undefined && prev !== v && condition(e.spec.when, e.state) && ctx) { const g = falloff(d, e.spec.radius, e.spec.volume); if (g > 0.001) oneShot(ctx, e.spec.kind, g); }
      continue;
    }
    if (!condition(e.spec.when, e.state)) continue;
    const g = falloff(d, e.spec.radius, e.spec.volume);
    if (g > 0.001) heard.push({ id: e.id, kind: e.spec.kind, gain: g, d });
  }
  heard.sort((a, b) => b.gain - a.gain); heard.length = Math.min(heard.length, MAX_VOICES);
  lastHeard = heard;
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  const live = new Set(heard.map((h) => h.id)), t = ctx.currentTime;
  for (const h of heard) {
    let v = voices.get(h.id);
    if (!v) { v = makeVoice(ctx, h.kind); voices.set(h.id, v); }
    v.gain = h.gain; v.out.gain.setTargetAtTime(h.gain, t, 0.25); v.tick(t);
  }
  for (const [id, v] of voices) if (!live.has(id)) { v.out.gain.setTargetAtTime(0, t, 0.2); v.stop(); voices.delete(id); }
}

/** Starts once per page; idles until a world-engine world publishes its host object. */
export function startSoundLayer() {
  if (typeof window === 'undefined' || (window as unknown as { __edenSound?: unknown }).__edenSound) return;
  const w = window as unknown as { __simEntity?: Host; __edenSound?: unknown };
  w.__edenSound = {
    state: () => ({ ctx: ctx?.state ?? 'none', muted, emitters: emitters.map((e) => ({ id: e.id, kind: e.spec.kind, when: e.spec.when ?? null, on: condition(e.spec.when, e.state) })), heard: lastHeard, voices: [...voices.entries()].map(([id, v]) => ({ id, kind: v.kind, gain: +v.gain.toFixed(3) })) }),
    mute: (m: boolean) => { muted = m; if (master) master.gain.value = m ? 0 : MASTER; },
    unlock,
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) window.addEventListener(ev, unlock, { capture: true, passive: true });
  setInterval(() => { const host = w.__simEntity; if (host?.camera && host.layer) { try { step(host); } catch { /* a world mid-reload */ } } }, TICK_MS);
}
startSoundLayer();
