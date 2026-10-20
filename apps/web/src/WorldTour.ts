/** VF5 (Gene): "When absolutely nothing is happening, broadcast should just do beautiful epic and varied trajectories
 * of town, from far and from close, just showing everything off."
 *
 * Broadcast's idle tour: a never-repeating sequence of eased camera moves built from the authored Explore views
 * (town places and the Regions districts): high flyovers, crane rises and descents, dolly passes, orbits around
 * landmarks, low glides along a view's own sightline and close push-ins. Each move lasts 10–25 s. A move that starts
 * near where the camera is glides in from there; one far away is a deliberate cut. Time of day steers the choice:
 * night prefers lit town streets and close views, dawn/dusk the skylines and panoramas, day everything.
 * A move is checked once against the drawn scenery before it runs (its path stays clear of walls and the view keeps
 * its target in sight); otherwise a safer move on the same view is used. No per-frame cost beyond a pose. */
export type TourView = { id: string; label: string; p: readonly [number, number, number]; target: readonly [number, number, number] };
export type TourPose = { position: [number, number, number]; target: [number, number, number]; fov: number };
export type MoveType = 'flyover' | 'crane-up' | 'crane-down' | 'dolly' | 'orbit' | 'push' | 'glide' | 'detail';
export type TourMove = { view: TourView; type: MoveType; seconds: number; at: (k: number) => TourPose };
export type TourContext = {
  /** 0 = night … 1 = full day; null when unknown. */
  daylight: number | null;
  /** A view to favour now and then (e.g. where people are). */
  prefer?: TourView | null;
  /** Path safety: is the camera clear here, and does the view from here reach the target? */
  clear?: (p: readonly number[]) => boolean;
  sight?: (from: readonly number[], to: readonly number[]) => boolean;
  /** Open sky above (never inside a tent, a hall or under a roof). */
  open?: (p: readonly number[]) => boolean;
  /** Lane W1: the page is still arriving: a new move is the authored view's gentle push (its sightline is clear by
   *  authoring), chosen without the ray checks (~0.25 s of a 2x-CPU Eden 2026 arrival); later moves are checked. */
  quick?: boolean;
};

const ease = (k: number) => .5 - .5 * Math.cos(Math.PI * Math.min(1, Math.max(0, k)));
const lerp3 = (a: readonly number[], b: readonly number[], k: number): [number, number, number] => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Small deterministic PRNG (mulberry32), so a sequence is reproducible in tests and varied in use. */
export function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** One move of `type` on `view`, as a pose for k in 0..1 (eased inside). */
export function makeMove(view: TourView, type: MoveType, seconds: number, side: 1 | -1): TourMove {
  const t = view.target, p = view.p, d = [p[0] - t[0], p[1] - t[1], p[2] - t[2]];
  const flat = Math.hypot(d[0], d[2]) || 1, r = Math.hypot(d[0], d[1], d[2]) || 1;
  const right = [d[2] / flat, 0, -d[0] / flat]; // horizontal, perpendicular to the sightline
  const fov = 45;
  const at = (k: number): TourPose => {
    const e = ease(k);
    switch (type) {
      case 'orbit': { // a slow arc around the target, keeping height and distance
        const a = side * (e - .5) * .8, c = Math.cos(a), s = Math.sin(a);
        return { position: [t[0] + d[0] * c - d[2] * s, p[1], t[2] + d[0] * s + d[2] * c], target: [...t], fov };
      }
      case 'crane-up': case 'crane-down': { // rise or descend on the view's own vertical, looking at the target
        const lo = Math.max(t[1] + 3, t[1] + d[1] * .45), hi = t[1] + Math.max(d[1] * 1.35, d[1] + 8);
        const y = type === 'crane-up' ? lo + (hi - lo) * e : hi + (lo - hi) * e;
        return { position: [p[0], y, p[2]], target: [t[0], t[1] + (y - p[1]) * .15, t[2]], fov };
      }
      case 'dolly': { // a lateral pass, the target sliding along a little behind
        const A = Math.min(16, r * .35) * side, o = (e - .5) * 2 * A;
        return { position: [p[0] + right[0] * o, p[1], p[2] + right[2] * o], target: [t[0] + right[0] * o * .6, t[1], t[2] + right[2] * o * .6], fov };
      }
      case 'flyover': { // high and wide: a long lateral sweep with a slight climb
        const A = r * .45 * side, o = (e - .5) * 2 * A;
        return { position: [p[0] + right[0] * o, p[1] * (1 + .12 * e), p[2] + right[2] * o], target: [t[0] + right[0] * o * .5, t[1], t[2] + right[2] * o * .5], fov: 50 };
      }
      case 'push': case 'glide': { // along the authored sightline toward the target (clear by construction)
        const amount = type === 'glide' ? .45 : .3;
        return { position: lerp3(p, t, amount * e), target: [...t], fov };
      }
      case 'detail': { // close: start nearer than the authored view, push in gently
        const near = Math.min(16, r * .5), k0 = 1 - near / r, k1 = 1 - near * .7 / r;
        return { position: lerp3(p, t, k0 + (k1 - k0) * e), target: [...t], fov: 40 };
      }
    }
  };
  return { view, type, seconds, at };
}

/** P7f: the broadcast's first move on a view while the page is arriving (and the phone's arrival poster, arrival-shot.ts):
 *  the authored view's gentle push (its sightline is clear by authoring). Its pose at k = 0 is the view itself. */
export const openingMove = (view: TourView): TourMove => makeMove(view, 'push', 14, 1);

const PANORAMA = /panorama|all of eden|overview/i, NIGHT = /night|town|street|plaza|canal|homes|courtyard|market|fountain|tea|tower|kiosk|bandstand/i;
const SKYLINE = /panorama|lookout|hillside|cliff|seaside|harbour|vineyard|observatory|castle|alpine|festival|lake|river/i;

export class WorldTour {
  private next = rng(Date.now());
  private move: TourMove | null = null;
  private start = 0;
  private recentViews: string[] = [];
  private recentTypes: MoveType[] = [];
  private from: TourPose | null = null;
  private last: TourPose | null = null;
  private count = 0;
  private run = 0;
  private views: readonly TourView[];
  constructor(views: readonly TourView[], seed?: number) { this.views = views; if (seed !== undefined) this.next = rng(seed); }
  reset() { this.move = null; this.from = null; this.last = null; this.recentViews = []; this.recentTypes = []; this.count = 0; this.run = 0; }
  get current() { return this.move; }

  private weight(v: TourView, daylight: number | null) {
    const night = daylight !== null && daylight < .3, golden = daylight !== null && daylight >= .3 && daylight < .65;
    let w = 1;
    if (night) w *= NIGHT.test(v.label + v.id) ? 3 : PANORAMA.test(v.label) ? .5 : .08; // dark hills and woods read as black at night
    else if (golden) w *= SKYLINE.test(v.label) || PANORAMA.test(v.label) ? 2.5 : 1;
    if (/night/i.test(v.label) && !night) w *= .2;
    // A few moves in one district, then a cut elsewhere: neighbours of the last pose (a continuous glide away) are
    // favoured until three moves have run on without a cut.
    if (this.last && this.run < 3 && dist(v.p, this.last.position) < 40) w *= 4;
    const i = this.recentViews.lastIndexOf(v.id);
    if (i >= 0) w *= .02 + .12 * (this.recentViews.length - 1 - i);
    return w;
  }
  private types(v: TourView, daylight: number | null): MoveType[] {
    const h = v.p[1] - v.target[1], r = dist(v.p, v.target), night = daylight !== null && daylight < .3;
    const out: MoveType[] = [];
    if (PANORAMA.test(v.label) || h > 30) out.push('flyover', 'flyover', 'crane-down', 'orbit');
    else if (h < 8) out.push('glide', 'glide', 'dolly', 'orbit', 'push');
    else out.push('orbit', 'orbit', 'crane-up', 'crane-down', 'dolly', 'push');
    if (r > 14 && h < 30) out.push('detail', ...(night ? ['detail', 'detail'] as MoveType[] : []));
    return out.filter(t => t !== this.recentTypes.at(-1));
  }
  private pick<T>(items: readonly T[], weight: (x: T) => number) {
    const ws = items.map(weight), total = ws.reduce((a, b) => a + b, 0);
    let x = this.next() * total;
    for (let i = 0; i < items.length; i++) { x -= ws[i]; if (x <= 0) return items[i]; }
    return items[items.length - 1];
  }
  /** Check a move once: its path stays clear and keeps the target in sight. */
  private safe(m: TourMove, ctx: TourContext) {
    if (!ctx.clear && !ctx.sight && !ctx.open) return true;
    for (const k of [0, .2, .4, .6, .8, 1]) {
      const pose = m.at(k);
      if (ctx.clear && !ctx.clear(pose.position)) return false;
      if (ctx.open && (k === 0 || k === .4 || k === 1) && !ctx.open(pose.position)) return false;
      if (ctx.sight && k !== .2 && k !== .6 && !ctx.sight(pose.position, pose.target)) return false;
    }
    return true;
  }
  private choose(ctx: TourContext): TourMove {
    const prefer = ctx.prefer && (this.count === 0 || this.count % 3 === 2) && this.recentViews.at(-1) !== ctx.prefer.id ? ctx.prefer : null;
    if (ctx.quick) return openingMove(prefer ?? this.pick(this.views, v => this.weight(v, ctx.daylight)));
    for (let attempt = 0; attempt < 6; attempt++) {
      const view = prefer && attempt === 0 ? prefer : this.pick(this.views, v => this.weight(v, ctx.daylight));
      const options = this.types(view, ctx.daylight);
      for (let tries = 0; tries < 3 && options.length; tries++) {
        const type = this.pick(options, () => 1), seconds = type === 'detail' ? 11 + this.next() * 4 : type === 'flyover' ? 20 + this.next() * 5 : 14 + this.next() * 8;
        const m = makeMove(view, type, seconds, this.next() < .5 ? 1 : -1);
        if (this.safe(m, ctx)) return m;
        options.splice(options.indexOf(type), 1);
      }
      // The authored view itself is clear: a gentle push along its sightline is always safe.
      const fallback = makeMove(view, 'push', 14, 1);
      if (this.safe(fallback, ctx) || attempt === 5) return fallback;
    }
    return makeMove(this.views[0], 'push', 14, 1);
  }
  /** The tour's pose at `now` (seconds). Starts a new move when the last one has run its course. */
  pose(now: number, ctx: TourContext): TourPose & { id: string; cut: boolean } {
    let cut = false;
    if (!this.move || now - this.start >= this.move.seconds) {
      const previous = this.last;
      this.move = this.choose(ctx); this.start = now; this.count++;
      this.recentViews = [...this.recentViews, this.move.view.id].slice(-10);
      this.recentTypes = [...this.recentTypes, this.move.type].slice(-4);
      // Continuous when the next move begins near the camera; a deliberate cut otherwise.
      const begin = this.move.at(0);
      this.from = previous && dist(previous.position, begin.position) < 40 && dist(previous.target, begin.target) < 60 ? previous : null;
      cut = !this.from; this.run = cut ? 0 : this.run + 1;
    }
    const k = (now - this.start) / this.move.seconds;
    let pose = this.move.at(k);
    if (this.from) { // glide in from where the previous move ended over the first 3 s
      const b = ease((now - this.start) / 3);
      if (b < 1) pose = { position: lerp3(this.from.position, pose.position, b), target: lerp3(this.from.target, pose.target, b), fov: this.from.fov + (pose.fov - this.from.fov) * b };
      else this.from = null;
    }
    this.last = pose;
    return { ...pose, id: `${this.move.type}:${this.move.view.id}`, cut };
  }
}
