// Entry 36: a singing voice, synthesized (no samples, no TTS, no cloning). A glottal-like source (a harmonic series falling
// ~9 dB an octave, with a little breath noise) through four vocal-tract formants (peaking filters at the vowel's F1–F4),
// so the sung vowels "oo", "la" and "ah" read as a voice. The pitch follows the sung notes exactly (piano-score.ts
// sungNotes): a small scoop into a phrase's first note, a quick glide between legato notes, gentle vibrato that grows in
// on held notes, and a soft in-breath where a phrase ends. Through the microphone: a little presence, light compression
// and a touch of room reverb. Each note is scheduled once at the AudioContext time of its world second, the same moment
// the piano's note sounds, so the voice never drifts from the music. Works in an OfflineAudioContext too (renderVoice).
import type { SungNote, Syllable } from '../../../../mars/viewer/app/engine-view/piano-score.ts';

/** Formants of sung vowels (an alto/mezzo singer): centre Hz, boost dB, bandwidth Hz. */
type Formants = [number, number, number][];
const VOWELS: Record<Syllable | 'l', Formants> = {
  ah: [[780, 15, 90], [1150, 11, 100], [2850, 7, 140], [3800, 3, 170]],
  oh: [[480, 15, 80], [830, 11, 90], [2800, 6, 140], [3700, 3, 170]],
  oo: [[360, 15, 70], [700, 9, 80], [2650, 4, 140], [3700, 2, 170]],
  la: [[740, 15, 90], [1200, 11, 100], [2850, 7, 140], [3800, 3, 170]],
  l: [[380, 12, 80], [1250, 7, 120], [2700, 5, 160], [3700, 2, 180]],
};
/** Vibrato: rate (Hz) and depth (cents) on a held note; it grows in after VIB_DELAY s. */
const VIB_RATE = 5.3, VIB_CENTS = 26, VIB_DELAY = 0.24;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

let breathBuf: AudioBuffer | null = null;
function breathNoise(c: BaseAudioContext) {
  if (!breathBuf || breathBuf.sampleRate !== c.sampleRate) {
    breathBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate); const d = breathBuf.getChannelData(0);
    let s = 12345, b = 0; for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) >>> 0; const w = s / 2 ** 31 - 1; b = 0.8 * b + 0.2 * w; d[i] = (w * 0.6 + b) * 0.7; }
  }
  const n = c.createBufferSource(); n.buffer = breathBuf; n.loop = true; return n;
}
/** The glottal source wave: harmonic n at n^-1.6, odd and even alike (a smooth, warm buzz before the formants). */
let wave: PeriodicWave | null = null, waveCtx: BaseAudioContext | null = null;
function source(c: BaseAudioContext) {
  if (!wave || waveCtx !== c) { const N = 48, re = new Float32Array(N), im = new Float32Array(N); for (let n = 1; n < N; n++) im[n] = n ** -1.6 * (n > 20 ? 0.6 : 1); wave = c.createPeriodicWave(re, im); waveCtx = c; }
  return wave;
}

/** The microphone and room every singer goes through (one per page): presence, compression, a short room. */
export function micChain(c: BaseAudioContext, dest: AudioNode) {
  const input = c.createGain(), hp = c.createBiquadFilter(), presence = c.createBiquadFilter(), air = c.createBiquadFilter(), comp = c.createDynamicsCompressor(), dry = c.createGain(), wet = c.createGain(), room = c.createConvolver();
  hp.type = 'highpass'; hp.frequency.value = 120; hp.Q.value = 0.6;
  presence.type = 'peaking'; presence.frequency.value = 3000; presence.Q.value = 0.9; presence.gain.value = 2.5;
  air.type = 'highshelf'; air.frequency.value = 6500; air.gain.value = -6;
  comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 2.5; comp.attack.value = 0.006; comp.release.value = 0.18;
  // the room: 1.3 s of decaying, darkening noise, a little later in each ear
  const len = Math.round(c.sampleRate * 1.3), ir = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); let s = 777 + ch * 31, lp = 0; for (let i = 0; i < len; i++) { s = (s * 1664525 + 1013904223) >>> 0; const w = s / 2 ** 31 - 1, t = i / c.sampleRate, k = 0.35 + 0.6 * Math.exp(-t * 3); lp += (w - lp) * k; d[i] = t < 0.012 + ch * 0.004 ? 0 : lp * Math.exp(-t * 4.6); } }
  room.buffer = ir; dry.gain.value = 1; wet.gain.value = 0.2;
  input.connect(hp).connect(presence).connect(air).connect(comp); comp.connect(dry).connect(dest); comp.connect(room).connect(wet).connect(dest);
  return input;
}

export type Singer = { schedule(n: SungNote, at: number, peak: number): void; silence(at: number): void; stop(at: number): void; out: GainNode };
/** One singer's voice: persistent nodes, notes scheduled on its params (in order, each once). */
export function makeSinger(c: BaseAudioContext, dest: AudioNode): Singer {
  const osc = c.createOscillator(); osc.setPeriodicWave(source(c));
  const vib = c.createOscillator(), vibDepth = c.createGain(); vib.frequency.value = VIB_RATE; vibDepth.gain.value = 0; vib.connect(vibDepth).connect(osc.detune);
  // a singer's pitch is never quite still: two slow wanders of a few cents
  const drift1 = c.createOscillator(), d1 = c.createGain(), drift2 = c.createOscillator(), d2 = c.createGain();
  drift1.frequency.value = 0.47; d1.gain.value = 3.5; drift2.frequency.value = 1.31; d2.gain.value = 1.8; drift1.connect(d1).connect(osc.detune); drift2.connect(d2).connect(osc.detune);
  const voiced = c.createGain(); voiced.gain.value = 0;
  // and never quite steady from cycle to cycle: slow noise on the pitch (jitter, a few cents) and on the level (shimmer)
  const wob = breathNoise(c), wobLp = c.createBiquadFilter(), jitter = c.createGain(), shimmerLp = c.createBiquadFilter(), shimmer = c.createGain(), steady = c.createGain();
  wobLp.type = 'lowpass'; wobLp.frequency.value = 28; jitter.gain.value = 260; shimmerLp.type = 'lowpass'; shimmerLp.frequency.value = 16; shimmer.gain.value = 2.2; steady.gain.value = 1;
  wob.connect(wobLp).connect(jitter).connect(osc.detune); wob.connect(shimmerLp).connect(shimmer).connect(steady.gain);
  const air = breathNoise(c), aspBand = c.createBiquadFilter(), asp = c.createGain(); aspBand.type = 'bandpass'; aspBand.frequency.value = 2400; aspBand.Q.value = 0.7; asp.gain.value = 0;
  const inBreath = c.createGain(), breathBand = c.createBiquadFilter(), breathHp = c.createBiquadFilter(); inBreath.gain.value = 0;
  breathBand.type = 'bandpass'; breathBand.frequency.value = 1700; breathBand.Q.value = 0.55; breathHp.type = 'highpass'; breathHp.frequency.value = 600;
  const tract: BiquadFilterNode[] = VOWELS.oo.map(([f, g, bw]) => { const b = c.createBiquadFilter(); b.type = 'peaking'; b.frequency.value = f; b.gain.value = g; b.Q.value = f / bw; return b; });
  const shelf = c.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 3600; shelf.gain.value = -10;
  const level = c.createGain(); level.gain.value = 0.16;   // the tract boosts ~15 dB at F1: bring it back to the source's level
  const out = c.createGain(); out.gain.value = 0;
  osc.connect(steady).connect(voiced); air.connect(aspBand).connect(asp);
  let node: AudioNode = voiced; asp.connect(tract[0]);
  for (const b of tract) { node.connect(b); node = b; }
  node.connect(shelf).connect(level).connect(out); air.connect(breathHp).connect(breathBand).connect(inBreath).connect(out);
  out.connect(dest);
  const t0 = c.currentTime; for (const o of [osc, vib, drift1, drift2]) o.start(t0); air.start(t0); wob.start(t0, 0.7);
  let lastEnd = -1, lastMidi: number | null = null;
  const vowel = (v: Formants, at: number, tc: number) => v.forEach(([f, g, bw], i) => { tract[i].frequency.setTargetAtTime(f, at, tc); tract[i].gain.setTargetAtTime(g, at, tc); tract[i].Q.setTargetAtTime(f / bw, at, tc); });
  return {
    out,
    schedule(n, at, peak) {
      const f = hz(n.midi), glide = !n.first && lastMidi !== null && at - lastEnd < 0.06;
      // pitch: a phrase opens with a small scoop from ~40 cents under; legato notes glide over ~50 ms
      if (n.first || !glide) { osc.frequency.setValueAtTime(f * 0.977, at); osc.frequency.setTargetAtTime(f, at, 0.028); }
      else osc.frequency.setTargetAtTime(f, at - 0.012, 0.016);
      // vibrato grows in on a held note, gone by its end
      vibDepth.gain.setTargetAtTime(0, at, 0.03);
      if (n.dur > 0.4) { vibDepth.gain.setValueAtTime(0, at + VIB_DELAY); vibDepth.gain.linearRampToValueAtTime(VIB_CENTS, at + Math.min(n.dur - 0.05, VIB_DELAY + 0.28)); vibDepth.gain.setTargetAtTime(0, at + n.dur - 0.04, 0.03); }
      // the vowel: "la" starts from an l and opens over ~70 ms; the others move to their own vowel
      if (n.syl === 'la') { vowel(VOWELS.l, at - 0.004, 0.006); vowel(VOWELS.la, at + 0.03, 0.022); }
      else vowel(VOWELS[n.syl], at, n.first ? 0.01 : 0.03);
      // loudness: a soft onset on a phrase's first note, a small dip for the l between legato notes, a gentle swell
      const p = peak * n.vel;
      if (n.first || !glide) { voiced.gain.setValueAtTime(0.0001, at); voiced.gain.setTargetAtTime(p, at, n.first ? 0.035 : 0.02); }
      else if (n.syl === 'la') { voiced.gain.setTargetAtTime(p * 0.42, at - 0.006, 0.01); voiced.gain.setTargetAtTime(p, at + 0.035, 0.02); }
      else voiced.gain.setTargetAtTime(p, at, 0.03);
      if (n.dur > 0.6) voiced.gain.setTargetAtTime(p * 1.08, at + 0.25, 0.25);
      asp.gain.setTargetAtTime(p * 0.05, at, 0.03);
      // a phrase-end note releases, and the singer breathes in before the next phrase
      const end = at + n.dur;
      if (n.breath) {
        voiced.gain.setTargetAtTime(0.0001, end - 0.035, 0.035); asp.gain.setTargetAtTime(0, end - 0.03, 0.03);
        inBreath.gain.setValueAtTime(0, end + 0.03); inBreath.gain.linearRampToValueAtTime(p * 0.045, end + 0.12); inBreath.gain.linearRampToValueAtTime(0, end + 0.22);
      }
      lastEnd = n.breath ? -1 : end; lastMidi = n.breath ? null : n.midi;
    },
    silence(at) {
      for (const g of [voiced.gain, asp.gain, inBreath.gain, vibDepth.gain]) { g.cancelScheduledValues(at); g.setTargetAtTime(0, at, 0.04); }
      lastEnd = -1; lastMidi = null;
    },
    stop(at) { this.silence(at); for (const o of [osc, vib, drift1, drift2]) o.stop(at + 0.4); air.stop(at + 0.4); wob.stop(at + 0.4); setTimeout(() => out.disconnect(), Math.max(0, (at - c.currentTime + 0.6) * 1000)); },
  };
}
