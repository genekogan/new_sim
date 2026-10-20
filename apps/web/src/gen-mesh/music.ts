// Lane S3 (2026-10-20, Gene: "music sucks. didn't we make better music? check the tone.js task ... put those on a
// playlist"): the world's music is a playlist of Gene's Sim Score pieces (score/playlist-runtime.mjs, Tone.js, composed in
// the browser a few bars ahead, no samples). It replaces the old generative 'music' bed that sat at the listener and
// restarted whenever the camera moved: this player has nothing to do with the camera, so a piece plays through.
//
// Cost: nothing at arrival. Tone and the pieces (separate chunks) load only once the arrival is over, after the first
// gesture, with music on and sound unmuted, in idle time. Tone owns its own AudioContext (its PluckSynth / BitCrusher need
// its worklets); a gesture resumes it where a browser insists (iOS). Each piece plays TRACK_S, fades, and the next one
// starts; the first piece is picked at random, then in playlist order. Mute or music off stops it; on again restarts
// the current piece. `window.__edenMusic` reports state and a start/stop/advance log (proof, tests).
import { arrivalOver } from '../arrival-marks.ts';
import type { ScoreConductor, ScoreNamespace } from '../score/playlist-runtime.d.mts';

export const TRACK_S = 240, FADE_S = 4, GAP_S = 1.5;
let trackS = TRACK_S;
/** The music sits at the visitor's master volume (0..1), as Tone's destination level in dB (pieces peak at -1 dBFS). */
export const musicDb = (volume: number) => (volume <= 0 ? -Infinity : 20 * Math.log10(Math.min(1, volume)));

type ToneLike = { start(): Promise<void>; getContext(): { state: string; rawContext: { state: string; createAnalyser(): AnalyserNode } }; getDestination(): { volume: { value: number; rampTo(v: number, s: number): void }; connect(n: AudioNode): unknown } };
export type MusicEvent = { t: number; ev: 'load' | 'loaded' | 'start' | 'fade' | 'stop' | 'error'; piece?: string; reason?: string };

let want = false, volume = 0.3;
let Tone: ToneLike | null = null, Sim: ScoreNamespace | null = null, order: readonly string[] = [], loading = false, failed = false;
let conductor: ScoreConductor | null = null, index = -1, playing: string | null = null, starting = false, gen = 0;
let endsAt = 0, fading = false, gapUntil = 0, resumeAt = 0;
const events: MusicEvent[] = [];
const note = (e: Omit<MusicEvent, 't'>) => { events.push({ t: Math.round(performance.now()), ...e }); if (events.length > 200) events.splice(0, events.length - 200); };

/** Is the playlist sounding (so a world's own 'music' objects stay quiet under it)? */
export const musicPlaying = () => !!playing || starting;

function idle(fn: () => void) {
  const w = window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 3000 }); else setTimeout(fn, 200);
}
function load() {
  if (loading || Sim || failed) return;
  loading = true; note({ ev: 'load' });
  idle(() => {
    Promise.all([import('tone'), import('../score/playlist-runtime.mjs')]).then(([tone, score]) => {
      Tone = tone as unknown as ToneLike; Sim = score.createPlaylistScore(tone); order = score.PLAYLIST;
      conductor = new Sim.Conductor(); loading = false; note({ ev: 'loaded', reason: `${order.length} pieces` });
    }, (e) => { loading = false; failed = true; note({ ev: 'error', reason: String(e).slice(0, 200) }); });
  });
}
/** A gesture resumes Tone's context where the browser did not let it start on its own (iOS). */
export function musicGesture() { if (Tone && want && Tone.getContext().state !== 'running') void Tone.start().catch(() => {}); }

function start(i: number, reason: string) {
  if (!Sim || !conductor || !order.length) return;
  const my = ++gen; index = ((i % order.length) + order.length) % order.length;
  const id = order[index], piece = Sim.pieces.find((p) => p.id === id);
  if (!piece) { note({ ev: 'error', piece: id, reason: 'missing piece' }); index++; return; }
  starting = true; fading = false;
  Tone!.getDestination().volume.value = musicDb(volume);
  conductor.play(piece, { seed: (Math.random() * 2 ** 31) >>> 0 }).then(() => {
    if (my !== gen) return;   // stopped or superseded while it was building its instruments
    starting = false; playing = id; endsAt = performance.now() + trackS * 1000; note({ ev: 'start', piece: id, reason });
  }, (e) => { if (my !== gen) return; starting = false; note({ ev: 'error', piece: id, reason: String(e).slice(0, 200) }); gapUntil = performance.now() + 5000; index++; });
}
function stop(reason: string) {
  gen++;
  if (playing || starting) { try { conductor?.stop(); } catch { /* disposed */ } note({ ev: 'stop', piece: playing ?? order[index], reason }); }
  playing = null; starting = false; fading = false;
}

/** Called by the sound layer every tick (100 ms) with the visitor's settings and whether sound is unlocked. */
export function syncMusic(o: { on: boolean; volume: number; unlocked: boolean }) {
  want = o.on;
  if (o.volume !== volume) { volume = o.volume; if (Tone && playing) Tone.getDestination().volume.rampTo(musicDb(volume), 0.2); }
  if (!want) { if (playing || starting) stop('off'); return; }
  if (!o.unlocked || !arrivalOver()) return;
  if (!Sim) { load(); return; }
  const now = performance.now();
  if (Tone!.getContext().state !== 'running') { if (now >= resumeAt) { resumeAt = now + 2000; void Tone!.start().catch(() => {}); } if (!playing) return; }
  if (!playing && !starting) { if (now >= gapUntil) start(index < 0 ? Math.floor(Math.random() * order.length) : index, index < 0 ? 'first' : 'resume'); return; }
  if (playing && !fading && now >= endsAt - FADE_S * 1000) { fading = true; try { conductor?.out?.gain.rampTo(0, FADE_S); } catch { /* gone */ } note({ ev: 'fade', piece: playing }); }
  if (playing && now >= endsAt) { stop('end'); gapUntil = now + GAP_S * 1000; index++; }
}

/** Skip to the next piece (tests, and a hook for a future "next" control). */
export function nextPiece() { if (!Sim) return; stop('next'); index++; gapUntil = 0; }

export function musicState() {
  return { want, loaded: !!Sim, loading, failed, playing, starting, index, piece: order[index] ?? null, playlist: order.slice(),
    endsInS: playing ? Math.max(0, Math.round((endsAt - performance.now()) / 1000)) : null, toneCtx: Tone?.getContext().state ?? 'none', db: +musicDb(volume).toFixed(1) };
}
export const musicLog = () => events.slice();
let meter: AnalyserNode | null = null;
/** RMS of the music actually coming out (proof that it sounds; 0 when stopped). */
export function musicLevel() {
  if (!Tone) return 0;
  try {
    if (!meter) { meter = Tone.getContext().rawContext.createAnalyser(); meter.fftSize = 2048; Tone.getDestination().connect(meter); }
    const d = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(d); let q = 0; for (const v of d) q += v * v; return +Math.sqrt(q / d.length).toFixed(5);
  } catch { return 0; }
}
/** Tests: a shorter piece length on this page, to watch the playlist advance. */
export function musicTrackSeconds(s: number) { trackS = Math.max(5, s); if (playing) endsAt = Math.min(endsAt, performance.now() + trackS * 1000); }
