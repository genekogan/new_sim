// Lane PERF: adaptive resolution for new (entity) worlds. On the M3 Max the GPU time of littlemartians-two at dpr 2 is
// ~8.5 ms a frame (4.4 M triangles, ~460 textures); a small laptop's GPU is several times slower, so the same scene
// would run well under 60 fps at full retina resolution. Rendering at 1 instead of 2 drawing-buffer pixels per CSS
// pixel cut that GPU time by a third (8.6 → 5.8 ms), so the pixel ratio is the dial:
//   - every 2 s window the median rAF interval is compared with the display's (the best median seen);
//   - two slow windows in a row (median > 1.3× the display's) step the pixel ratio down by 15%, never below 1;
//   - a step that does not make frames faster (CPU-bound) is undone, and no step down is tried for 2 min;
//   - after 12 s of full-rate frames it steps back up; if that makes it slow again, it steps down and stays for 60 s.
// A fast machine never leaves its device ratio (capped at 2, as before). Windows with a stall (> 250 ms: loading, a
// hidden tab) do not count, and nothing adapts in the first 8 s. `?dpr=fixed` turns it off; `?dpr=<n>` pins a ratio.
import type * as THREE from 'three';

const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const MODE = q.get('dpr');

/** W2b: screenshots use one drawing-buffer pixel per requested viewport pixel, even on slow GPUs. */
export function worldResolution(renderer: THREE.WebGLRenderer, deviceRatio: number, entityWorld: boolean, shotMode: boolean) {
  renderer.setPixelRatio(shotMode ? 1 : Math.min(deviceRatio, 2));
  return entityWorld && !shotMode ? new AdaptiveResolution(renderer, deviceRatio) : null;
}

export class AdaptiveResolution {
  private readonly max: number;
  private ratio: number;
  private last = 0;
  private window: number[] = [];
  private windowStart = 0;
  private best = Infinity;
  private slowRuns = 0;
  private fastFor = 0;
  private lockedUntil = 0;
  private justRaised = 0;
  private noDownUntil = 0;
  private lastDown: { from: number; median: number } | null = null;
  private readonly started = performance.now();
  readonly log: { t: number; ratio: number; median: number }[] = [];

  constructor(private renderer: THREE.WebGLRenderer, deviceRatio: number) {
    this.max = Math.min(deviceRatio, 2);
    const pinned = MODE && Number.isFinite(Number(MODE)) ? Math.max(0.5, Math.min(2, Number(MODE))) : null;
    this.ratio = pinned ?? this.max;
    if (pinned) renderer.setPixelRatio(pinned);
  }
  get pixelRatio() { return this.ratio; }
  get enabled() { return MODE !== 'fixed' && !(MODE && Number.isFinite(Number(MODE))); }

  /** Call once per rendered frame. */
  frame(now: number) {
    if (!this.enabled) return;
    if (this.last) this.window.push(now - this.last);
    this.last = now;
    if (!this.windowStart) this.windowStart = now;
    if (now - this.windowStart < 2000) return;
    const iv = this.window; this.window = []; this.windowStart = now;
    if (iv.length < 10 || iv.some((x) => x > 250) || now - this.started < 8000) { this.slowRuns = 0; return; }
    const s = [...iv].sort((a, b) => a - b), median = s[s.length >> 1];
    this.best = Math.min(this.best, Math.max(median, 1000 / 240), 1000 / 60);   // never judge against less than 60 Hz: a slow machine is slow from its first frame
    const slow = median > this.best * 1.3, fast = median < this.best * 1.08;
    // a step down that did not help: the frame is CPU-bound, fewer pixels only blur it; undo and leave it for 2 min
    if (this.lastDown) { const d = this.lastDown; this.lastDown = null; if (median > d.median * 0.95) { this.noDownUntil = now + 120_000; this.slowRuns = 0; this.set(d.from, now, median); return; } }
    if (slow) {
      this.fastFor = 0;
      if (++this.slowRuns >= 2 || (this.justRaised && now - this.justRaised < 6000)) {
        if (this.justRaised && now - this.justRaised < 6000) this.lockedUntil = now + 60_000;
        this.justRaised = 0; this.slowRuns = 0;
        if (now > this.noDownUntil && this.ratio > 1) { this.lastDown = { from: this.ratio, median }; this.set(Math.max(1, this.ratio * 0.85), now, median); }
      }
      return;
    }
    this.slowRuns = 0;
    if (fast) {
      this.fastFor += 2000;
      if (this.ratio < this.max && this.fastFor >= 12_000 && now > this.lockedUntil) { this.fastFor = 0; this.justRaised = now; this.set(Math.min(this.max, this.ratio / 0.85), now, median); }
    } else this.fastFor = 0;
  }
  private set(r: number, now: number, median: number) {
    r = Math.round(r * 100) / 100;
    if (Math.abs(r - this.ratio) < 0.01) return;
    this.ratio = r; this.renderer.setPixelRatio(r);
    this.log.push({ t: Math.round(now), ratio: r, median: Math.round(median * 10) / 10 });
  }
}
