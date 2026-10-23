// Lane AMBIENT (Soul tranche): recorded CC0 ambient beds under the procedural soundscape of sound.ts.
// One looping recording per layer (birds, crickets, water, wind, chatter), never stacked: a layer's level follows the
// strongest procedural emitter of its kind that the listener hears (day/night, shore, groups of Souls already decide that in
// sound-plan.ts), wind follows exposure on high ground, the bed is panned toward that strongest source, and everything is
// ducked while the Sim Score plays. Output goes into sound.ts `master`, so mute and audio focus apply unchanged.
// Lazy chunk: sound.ts imports this only after the first gesture unlocked audio; each loop is fetched the first time its
// layer is heard. Work runs on the 100 ms sound tick, never per frame. Sources: ambient/README.md + asset-scouting/SOURCES.csv.
//   node --test apps/web/src/gen-mesh/ambient-beds.test.ts

export type BedLayer = 'birds' | 'crickets' | 'water' | 'wind' | 'chatter';
export const LAYERS: readonly BedLayer[] = ['birds', 'crickets', 'water', 'wind', 'chatter'];
/** Procedural sound kinds whose presence sets a bed (sound-plan.ts SoundKind). */
const KIND_LAYER: Record<string, BedLayer> = { birds: 'birds', crickets: 'crickets', waves: 'water', chatter: 'chatter' };
/** Bed level at full presence. Presence = sqrt(min(1, strongest heard emitter gain / NEAR)): the procedural voices are quiet
 *  (0.05-0.1 a few metres from a shore or a hedge, 0.2 at the source), so a linear map left the beds ~20 dB under them, inaudible
 *  (walker A/B 2026-10-23). The loops are normalised to -26 dBFS mean; at full presence a bed sits a few dB above the procedural
 *  voices, under the Sim Score (ducked). Wind is an absolute ceiling on exposure alone. */
export const LEVEL: Record<BedLayer, number> = { birds: 0.6, crickets: 0.6, water: 0.7, wind: 0.2, chatter: 0.5 };
/** Emitter gain at which a bed reaches full presence, and below which it is silent (far emitters do not fill the world). */
export const NEAR = 0.1, FAR = 0.005;
export const presence = (g: number) => Math.sqrt(Math.max(0, Math.min(1, (g - FAR) / (NEAR - FAR))));
/** Exposure (sound-plan exposureAt, 0..1) where wind starts; full at 1. Gene turned the old wind bed off (S3): keep it rare and quiet. */
export const WIND_FROM = 0.6;
/** Multiplier on every bed while the Sim Score plays: the music stays on top. */
export const DUCK = 0.6;
export const MAX_PAN = 0.7, SILENT = 0.002, STOP_AFTER_MS = 20000, LOOP_START = 0.1, LOOP_S = 24;

export const BED_URLS: Record<BedLayer, string> = {
  birds: new URL('./ambient/birds.mp3', import.meta.url).href,
  crickets: new URL('./ambient/crickets.mp3', import.meta.url).href,
  water: new URL('./ambient/water.mp3', import.meta.url).href,
  wind: new URL('./ambient/wind.mp3', import.meta.url).href,
  chatter: new URL('./ambient/chatter.mp3', import.meta.url).href,
};

export type BedHeard = { kind: string; source: string; gain: number; d: number; e: { pts: [number, number, number][]; follow?: boolean } };
/** Listener position and the camera's right vector on the ground plane (x, z; need not be unit length). */
export type BedListener = { x: number; z: number; right?: [number, number] };
export type BedMix = Record<BedLayer, { gain: number; pan: number }>;

function panToward(L: BedListener, h: BedHeard): number {
  if (h.e.follow || h.d < 2 || !L.right) return 0;
  const [rx, rz] = L.right, rl = Math.hypot(rx, rz); if (rl < 1e-6) return 0;
  let best = Infinity, bx = 0, bz = 0;
  const pts = h.e.pts, stepBy = Math.max(1, Math.floor(pts.length / 64));
  for (let i = 0; i < pts.length; i += stepBy) { const dx = pts[i][0] - L.x, dz = pts[i][2] - L.z, q = dx * dx + dz * dz; if (q < best) { best = q; bx = dx; bz = dz; } }
  const dl = Math.sqrt(best); if (dl < 1e-6) return 0;
  return Math.max(-1, Math.min(1, (bx * rx + bz * rz) / (dl * rl))) * MAX_PAN;
}

/** Target gain and pan per layer from what the procedural soundscape hears this tick (pure; unit-tested). */
export function bedMix(heard: readonly BedHeard[], L: BedListener, o: { exposure: number; covered: boolean; music: boolean }): BedMix {
  const mix = {} as BedMix, strongest: Partial<Record<BedLayer, BedHeard>> = {};
  for (const l of LAYERS) mix[l] = { gain: 0, pan: 0 };
  for (const h of heard) {
    const l = KIND_LAYER[h.kind]; if (!l || (l === 'chatter' && h.source !== 'resident')) continue;
    if (!strongest[l] || h.gain > strongest[l]!.gain) strongest[l] = h;
  }
  for (const l of LAYERS) { const h = strongest[l]; if (h) mix[l] = { gain: LEVEL[l] * presence(h.gain), pan: panToward(L, h) }; }
  const w = o.covered ? 0 : Math.max(0, Math.min(1, (o.exposure - WIND_FROM) / (1 - WIND_FROM)));
  mix.wind = { gain: LEVEL.wind * w, pan: 0 };
  if (o.music) for (const l of LAYERS) mix[l].gain *= DUCK;
  return mix;
}

type Bed = { gain: GainNode; pan: StereoPannerNode | null; buf: AudioBuffer | null; loading: boolean; failedAt: number; src: AudioBufferSourceNode | null; quietSince: number; target: number };
export type BedLoader = (ctx: BaseAudioContext, url: string) => Promise<AudioBuffer>;
const fetchAndDecode: BedLoader = async (ctx, url) => ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());

/** The audio graph: per layer source(loop) -> gain -> stereo pan -> out. Created once per AudioContext. */
export function createBeds(ctx: BaseAudioContext, out: AudioNode, urls: Record<BedLayer, string> = BED_URLS, load: BedLoader = fetchAndDecode, rand: () => number = Math.random) {
  const beds = {} as Record<BedLayer, Bed>;
  /** All beds sum here before `out`, so a probe can meter the beds alone. */
  const bus = ctx.createGain(); bus.connect(out);
  for (const l of LAYERS) {
    const gain = ctx.createGain(); gain.gain.value = 0;
    const pan = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    if (pan) gain.connect(pan).connect(bus); else gain.connect(bus);
    beds[l] = { gain, pan, buf: null, loading: false, failedAt: -Infinity, src: null, quietSince: 0, target: 0 };
  }
  function stopSrc(b: Bed) { try { b.src!.stop(); } catch { /* already stopped */ } b.src!.disconnect(); b.src = null; }
  return {
    bus,
    update(mix: BedMix, nowMs: number) {
      const t = ctx.currentTime;
      for (const l of LAYERS) {
        const b = beds[l], { gain, pan } = mix[l];
        b.target = gain;
        if (gain > SILENT) {
          b.quietSince = 0;
          if (!b.buf && !b.loading && nowMs - b.failedAt > 60000) {
            b.loading = true;
            load(ctx, urls[l]).then((buf) => { b.buf = buf; }, () => { b.failedAt = nowMs; }).finally(() => { b.loading = false; });
          }
          if (b.buf && !b.src) {
            const s = ctx.createBufferSource(); s.buffer = b.buf; s.loop = true;
            const end = Math.min(LOOP_START + LOOP_S, b.buf.duration); s.loopStart = LOOP_START; s.loopEnd = end;
            s.connect(b.gain); s.start(t, LOOP_START + rand() * (end - LOOP_START)); b.src = s;
          }
        } else if (b.src) {
          if (!b.quietSince) b.quietSince = nowMs;
          else if (nowMs - b.quietSince > STOP_AFTER_MS) stopSrc(b);
        }
        b.gain.gain.setTargetAtTime(b.src ? gain : 0, t, 1.0);
        if (b.pan) b.pan.pan.setTargetAtTime(pan, t, 0.5);
      }
    },
    state() { return LAYERS.map((l) => ({ layer: l, target: +beds[l].target.toFixed(3), playing: !!beds[l].src, loaded: !!beds[l].buf, pan: beds[l].pan ? +beds[l].pan!.pan.value.toFixed(2) : 0 })); },
    stop() { for (const l of LAYERS) if (beds[l].src) stopSrc(beds[l]); },
  };
}
export type Beds = ReturnType<typeof createBeds>;
