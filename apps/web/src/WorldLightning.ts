// GOD-ENV: lightning on a god's (new) world — the bolt, the flash, and the thunder, the same for every viewer.
// Strikes come from the world (packages/world-compiler lightning.ts: the storm's own, deterministic from the world tick,
// and the god's `weather.strike`), so the server tells the Souls about the very bolts drawn here. Each strike draws a
// jagged bolt from the cloud base to the ground with a few branches, flickers for a third of a second, lights the scene
// (a cold point light at the strike and a sky-wide flash), and plays thunder after distance / 343 m/s: a sharp crack when
// it is close, a long low rumble when it is far (WebAudio, synthesised; the browser lets it sound after the first click
// or key). Presentation only; nothing here is authoritative.
import * as THREE from 'three';
import { strikesBetween, SOUND_MPS, type Strike } from '@sim/world-compiler';

type ModelLike = { state: unknown; seed: string; ground(): { extent: readonly number[] } };
type LayerLike = { active: boolean; groundAt(x: number, z: number): number | null };
type Bolt = { group: THREE.Group; light: THREE.PointLight; born: number; seed: number; power: number };
type Heard = { tick: number; x: number; z: number; god: boolean; dist: number; delay: number; gain: number; at: number; sound: 'scheduled' | 'locked' | 'muted' };

const CLOUD_BASE = 230;          // m above the ground where a bolt leaves the cloud
const BOLT_LIFE = 0.45;          // s a bolt stays drawn (it flickers 2–3 times)
const rnd = (seed: number) => { let s = seed >>> 0 || 1; return () => { s = Math.imul(s ^ (s >>> 15), 2246822519) >>> 0; s = Math.imul(s ^ (s >>> 13), 3266489917) >>> 0; s ^= s >>> 16; return (s >>> 0) / 4294967296; }; };

export class WorldLightning {
  readonly group = new THREE.Group();
  private lastTick = -1;
  private bolts: Bolt[] = [];
  private flash = new THREE.HemisphereLight(0xdfe7ff, 0x3a4060, 0);
  private flashLevel = 0;
  private audio: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private master: GainNode | null = null;
  private unlock = () => this.ensureAudio();
  readonly heard: Heard[] = [];
  muted = false;
  /** Inspection (e2e screenshots): keep the bolts drawn, at full brightness, until this time (performance.now() ms). */
  holdUntil = 0;
  private core = new THREE.MeshBasicMaterial({ color: 0xf4f7ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
  private glow = new THREE.MeshBasicMaterial({ color: 0x9db4ff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });

  constructor(private layer: LayerLike) {
    this.group.name = 'god-lightning';
    this.group.add(this.flash);
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, this.unlock, { passive: true });
  }

  private model(): ModelLike | null { return (this.layer as unknown as { model?: ModelLike | null }).model ?? null; }

  /** Call every frame with the world tick the view shows. */
  update(tick: number, camera: THREE.Camera, dt: number, reducedMotion = false) {
    const m = this.model();
    if (!this.layer.active || !m || !Number.isFinite(tick)) return;
    // first frame, a jump (replay, resync) or time running back: start from here, no backlog of old strikes
    if (this.lastTick < 0 || tick < this.lastTick || tick - this.lastTick > 400) this.lastTick = tick;
    else if (tick > this.lastTick) {
      const list = strikesBetween(m.state as never, m.seed, m.ground().extent, this.lastTick, tick);
      this.lastTick = tick;
      for (const s of list) this.fire(s, camera, reducedMotion);
    }
    const now = performance.now() / 1000;
    for (const b of [...this.bolts]) {
      const held = performance.now() < this.holdUntil, age = held ? 0.01 : now - b.born;
      if (age > BOLT_LIFE) { this.group.remove(b.group); this.group.remove(b.light); b.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose()); b.light.dispose(); this.bolts.splice(this.bolts.indexOf(b), 1); continue; }
      // the return strokes: bright, dim, bright again, fading
      const k = reducedMotion ? 1 - age / BOLT_LIFE : (age < 0.07 ? 1 : age < 0.12 ? 0.25 : age < 0.2 ? 0.95 : age < 0.26 ? 0.2 : 0.7) * (1 - age / BOLT_LIFE);
      b.group.visible = k > 0.05;
      b.group.children.forEach((c, i) => { ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (i % 2 ? 0.2 : 1) * Math.min(1, k * 1.3); });
      b.light.intensity = 2500 * b.power * k;
    }
    this.flashLevel = performance.now() < this.holdUntil ? Math.max(this.flashLevel, 0.8) : Math.max(0, this.flashLevel - dt * 5.5);
    this.flash.intensity = Math.min(1.2, this.flashLevel * 0.6) * (reducedMotion ? 0.5 : 1);
  }

  private fire(s: Strike, camera: THREE.Camera, reducedMotion: boolean) {
    const gy = this.layer.groundAt(s.x, s.z) ?? 0, r = rnd(s.tick * 7919 + Math.round(s.x * 31) + Math.round(s.z * 17));
    const bolt = new THREE.Group(); bolt.name = `bolt ${s.x},${s.z}`;
    // the main channel: jagged, wandering less as it nears the ground
    const pts: THREE.Vector3[] = []; const top = new THREE.Vector3(s.x + (r() - 0.5) * 60, gy + CLOUD_BASE, s.z + (r() - 0.5) * 60);
    // a random walk sideways that is pulled back to the line: sharp kinks, wider up in the cloud, true at the ground
    const N = 30; let ox = 0, oz = 0;
    for (let i = 0; i <= N; i++) {
      const f = i / N, wob = (1 - f) * 11 + 2.5;
      ox = ox * 0.55 + (r() - 0.5) * wob * 2; oz = oz * 0.55 + (r() - 0.5) * wob * 2;
      const k = i === 0 || i === N ? 0 : 1;
      pts.push(new THREE.Vector3(top.x + (s.x - top.x) * f + ox * k, top.y + (gy - top.y) * f + (k ? (r() - 0.5) * 3 : 0), top.z + (s.z - top.z) * f + oz * k));
    }
    const strand = (p: THREE.Vector3[], radius: number) => {
      const path = new THREE.CurvePath<THREE.Vector3>(); for (let i = 1; i < p.length; i++) path.add(new THREE.LineCurve3(p[i - 1], p[i]));
      bolt.add(new THREE.Mesh(new THREE.TubeGeometry(path, p.length * 2, radius, 5, false), this.core));
      bolt.add(new THREE.Mesh(new THREE.TubeGeometry(path, p.length * 2, radius * 4, 6, false), this.glow));
    };
    strand(pts, 0.28 * (0.7 + 0.5 * s.power));
    // branches off the upper two thirds
    const branches = 2 + Math.floor(r() * 3);
    for (let b = 0; b < branches; b++) {
      const from = pts[2 + Math.floor(r() * (N * 0.6))], dir = new THREE.Vector3(r() - 0.5, -0.5 - r() * 0.5, r() - 0.5).normalize(), len = 25 + r() * 45, bp = [from.clone()];
      for (let i = 1; i <= 7; i++) bp.push(from.clone().addScaledVector(dir, (len * i) / 7).add(new THREE.Vector3((r() - 0.5) * 7, (r() - 0.5) * 2, (r() - 0.5) * 7)));
      strand(bp, 0.12);
    }
    const light = new THREE.PointLight(0xcfd9ff, 0, 900, 1.4); light.position.set(s.x, gy + 30, s.z);
    this.group.add(bolt); this.group.add(light);
    this.bolts.push({ group: bolt, light, born: performance.now() / 1000, seed: s.tick, power: s.power });
    this.flashLevel = Math.min(reducedMotion ? 1.2 : 3.2, this.flashLevel + 2.4 * s.power);
    // thunder: after the distance at the speed of sound, louder and sharper the nearer
    const cam = camera.position, dist = Math.hypot(cam.x - s.x, cam.y - gy, cam.z - s.z), delay = dist / SOUND_MPS;
    const gain = Math.max(0.04, Math.min(1, 1 / (1 + dist / 260))) * (0.6 + 0.4 * s.power);
    const sound = this.muted ? 'muted' : this.thunder(delay, dist, gain, r) ? 'scheduled' : 'locked';
    this.heard.push({ tick: s.tick, x: s.x, z: s.z, god: !!s.god, dist: Math.round(dist), delay: Math.round(delay * 100) / 100, gain: Math.round(gain * 100) / 100, at: Date.now(), sound });
    if (this.heard.length > 40) this.heard.shift();
  }

  private ensureAudio() {
    try {
      if (!this.audio) {
        const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.audio = new AC();
        this.master = this.audio.createGain(); this.master.gain.value = 0.8; this.master.connect(this.audio.destination);
        const len = this.audio.sampleRate * 6, buf = this.audio.createBuffer(1, len, this.audio.sampleRate), d = buf.getChannelData(0);
        // brown-ish noise: thunder is mostly low frequencies
        let last = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.035 * w) / 1.035; d[i] = last * 3.2 + w * 0.08; }
        this.noise = buf;
      }
      if (this.audio.state === 'suspended') void this.audio.resume();
    } catch { /* no audio: silent lightning */ }
  }

  /** Schedule one thunder; false when the browser has not allowed sound yet. */
  private thunder(delay: number, dist: number, gain: number, r: () => number): boolean {
    const a = this.audio; if (!a || !this.noise || !this.master || a.state !== 'running') return false;
    const t0 = a.currentTime + delay;
    // the crack of a near strike
    if (dist < 700) {
      const src = a.createBufferSource(); src.buffer = this.noise; src.playbackRate.value = 1.6;
      const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
      const g = a.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * (1 - dist / 700) * 1.4), t0 + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
      src.connect(hp).connect(g).connect(this.master); src.start(t0, r() * 4); src.stop(t0 + 0.4);
    }
    // the rumble: rolls for 3–6 s, longer and darker the farther away
    const len = 3 + Math.min(3, dist / 600) + r(), src = a.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 90 + 900 / (1 + dist / 300); lp.Q.value = 0.7;
    const g = a.createGain(); g.gain.setValueAtTime(0.0001, t0);
    const attack = 0.04 + Math.min(0.6, dist / 2500);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    let t = t0 + attack;
    for (let k = 0; k < 4; k++) { t += (len - attack) / 6 * (0.6 + r() * 0.8); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * (0.25 + r() * 0.7) * (1 - k / 5)), t); }
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    src.connect(lp).connect(g).connect(this.master); src.start(t0, r() * 3); src.stop(t0 + len + 0.1);
    return true;
  }

  inspect() { return { bolts: this.bolts.length, heard: this.heard.length, last: this.heard.slice(-6), audio: this.audio?.state ?? 'locked', flash: Math.round(this.flashLevel * 100) / 100 }; }

  dispose() {
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) removeEventListener(ev, this.unlock);
    for (const b of this.bolts) { b.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose()); b.light.dispose(); }
    this.bolts = []; this.group.clear(); this.core.dispose(); this.glow.dispose();
    void this.audio?.close().catch(() => {}); this.audio = null;
  }
}
