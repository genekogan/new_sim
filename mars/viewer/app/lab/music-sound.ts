// Optional audio expression. Reads authoritative notes; owns no actors or simulation clock.
import { musicStation } from '../../engine/activities/computer-music.ts';
import type { LabSim } from './sim.ts';
const live = new Set<MusicSound>();
let opened = 0,
  closed = 0;
export class MusicSound {
  private context: AudioContext;
  private oscillator!: OscillatorNode;
  private gain!: GainNode;
  private analyser!: AnalyserNode;
  private samples = new Float32Array(256);
  private frame = 0;
  private started = false;
  private disposed = false;
  private closing?: Promise<void>;
  private note: number | null = null;
  private error?: string;
  constructor(privateSim: LabSim, station: string) {
    this.context = new AudioContext();
    live.add(this);
    opened++;
    try {
      this.oscillator = this.context.createOscillator();
      this.gain = this.context.createGain();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 256;
      this.oscillator.type = 'triangle';
      this.gain.gain.value = 0;
      this.oscillator.connect(this.gain);
      this.gain.connect(this.analyser);
      this.analyser.connect(this.context.destination);
      this.oscillator.start();
      this.started = true;
      const frame = () => {
        if (this.disposed) return;
        const state = musicStation(privateSim.rt, station);
        const next =
          !privateSim.paused && state && !('code' in state) ? state.note : null;
        if (next !== this.note) {
          this.note = next;
          if (next !== null)
            this.oscillator.frequency.setValueAtTime(
              440 * Math.pow(2, (next - 69) / 12),
              this.context.currentTime,
            );
          this.gain.gain.setTargetAtTime(
            next === null ? 0 : 0.08,
            this.context.currentTime,
            0.01,
          );
        }
        this.frame = requestAnimationFrame(frame);
      };
      this.frame = requestAnimationFrame(frame);
    } catch (error) {
      void this.dispose();
      throw error;
    }
  }
  async enable() {
    if (!this.disposed) await this.context.resume();
  }
  state() {
    this.analyser?.getFloatTimeDomainData(this.samples);
    let squares = 0;
    for (const value of this.samples) squares += value * value;
    return {
      context: this.context.state,
      note: this.disposed ? null : this.note,
      rms: Math.sqrt(squares / this.samples.length),
      disposed: this.disposed,
      ...(this.error ? { error: this.error } : {}),
    };
  }
  dispose() {
    if (this.closing) return this.closing;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    if (this.started) this.oscillator.stop();
    this.oscillator?.disconnect();
    this.gain?.disconnect();
    this.analyser?.disconnect();
    this.closing = this.context.close().then(
      () => {
        live.delete(this);
        closed++;
      },
      (error) => {
        this.error = String(error);
      },
    );
    return this.closing;
  }
}
/** Read-only renderer resource proof; unrelated audio libraries are not counted. */
export function musicSoundState() {
  return {
    opened,
    closed,
    active: live.size,
    voices: [...live].map((sound) => sound.state()),
  };
}
