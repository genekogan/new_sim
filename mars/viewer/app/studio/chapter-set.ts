// A chapter set played back to back (STUDIO_REPLAY.md "Chapter sets: playback", W37): the manifest's `chapterSets` entry
// is ONE "Watch it being built" item; its chapters are consecutive takes of one run (engine/take/chapters.ts).
// - One clock over the whole set, [0, duration). Set time T ↔ chapter k with from·dt ≤ T < to·dt and local time T − from·dt.
// - One set of views (TakePeople) for the whole set: at a boundary the next chapter's take is swapped in (`setTake`); its
//   first frame is the previous chapter's final state with the same ids, so no rig or mesh is rebuilt.
// - Before a chapter is used, its start is checked: `take.baselineStateHash` = the previous chapter's manifest
//   `finalStateHash` (the set's `startStateHash` for chapter 0) = the manifest's `chapter.startHash`. A failed check
//   stops the clock and shows a continuity error instead of the swap.
// - Chapter k + 1 is fetched while k plays (prefetch); only chapters k − 1 … k + 1 stay parsed. If the clock reaches a
//   chapter that is not loaded yet, it holds at the boundary until it is.
// - Engine camera per chapter (each chapter file's planned `camera`), the log on the set clock (every chapter's log shifted
//   by its start), and the whole-set checks from chapter-set.worker.ts.
// Poses depend only on T (random access), exactly as for a single take.
import * as THREE from 'three';
import { sampleTrack, trackData, type CameraTrackData } from '../../engine/camera/track.ts';
import type { CameraPose } from '../../engine/camera/shots.ts';
import { ANG_Q, type Take } from '../../engine/take/types.ts';
import { sampleTake, type TakeFrame } from '../../engine/take/replay.ts';
import { hashOf } from '../../engine/core/hash.ts';
import { setClockTenths } from '../engine-view/take-log.ts';
import { loadTakeFile, shiftTake, takeLog, TakePeople, type ChapterSetEntry, type LogLine, type TakeManifestEntry, type TakeReplayFile, type TakeStep } from '../engine-view/take-replay.ts';
import type { Template } from '../engine-view/people.ts';

// ---- worker protocol (chapter-set.worker.ts) ----
export type SetCheckIn = { set: ChapterSetEntry; entries: (TakeManifestEntry | null)[] };
/** Per chapter: final-state hash, the start (continuity with the previous chapter) and the log on the set clock. */
export type ChapterCheck = {
  type: 'chapter';
  k: number;
  id: string;
  hash: { ok: boolean; final: string };
  start: { ok: boolean; expected: string; baseline: string; manifest: string | null; problems: string[] };
  log: LogLine[];
  ms: number;
};
export type SetFinalCheck = {
  type: 'final';
  hash: { ok: boolean; replayed: string; set: string };
  frame: { ok: boolean; maxMm: number; missing: string[] };
  canonical: {
    checkpoint: string;
    assembly: string;
    ok: boolean;
    frames: { atPose: number; total: number; maxMm: number };
    parts: { atPose: number; total: number; maxMm: number; byRole: Record<string, number> };
    failures: string[];
  } | null;
  ms: number;
};
export type SetWorkerOut = ChapterCheck | SetFinalCheck | { type: 'error'; message: string };

type Loaded = {
  k: number;
  file: TakeReplayFile;
  /** render copy (datum-shifted) */
  render: Take;
  track: CameraTrackData;
  trackId: string;
  trackKind: string;
  log: LogLine[];
  /** set seconds at the chapter start */
  at: number;
  duration: number;
  guard: { ok: boolean; text: string };
};

/** The set's option text: "2022 east-house: skeleton, decks, stair, walls, solar — from the piles · 8 h 21 min · 7 chapters". */
export function setOptionText(s: ChapterSetEntry): string {
  const place = s.label.replace(/^.*?:\s*/, '').replace(/\s*\([^)]*\)/g, '').trim();
  const span = s.duration < 3600 ? `${Math.round(s.duration / 60)} min` : `${Math.floor(s.duration / 3600)} h ${Math.round((s.duration % 3600) / 60)} min`;
  return `${place}: ${chapterWords(s)} — from the piles · ${span} · ${s.chapters.length} chapters`;
}
/**
 * What the chapters build, one word each, in order: the head noun of each chapter label (the text before " — " / ","),
 * repeated neighbours folded into a plural ("deck", "deck", "deck" → "decks"); a head listing two things ("solar rails
 * and panels") reads as its first word. A year-build set starts from the pile yard (its first chapter's start state).
 */
function chapterWords(s: ChapterSetEntry): string {
  const words: string[] = [];
  let last = '', n = 0;
  const flush = () => { if (last) words.push(n > 1 && !last.endsWith('s') ? `${last}s` : last); };
  for (const c of s.chapters) {
    const head = c.label.split(/\s+—\s+|,/)[0].trim();
    const toks = head.split(/\s+/).filter((w) => !/^(the|a|an|kit)$/i.test(w));
    const w = (head.includes(' and ') ? toks[0] : toks[toks.length - 1] ?? head).toLowerCase();
    if (w === last) { n++; continue; }
    flush();
    last = w;
    n = 1;
  }
  flush();
  return words.join(', ');
}

/** Set time as h:mm:ss (sets run for hours). */
export const setClock = (s: number) => {
  const x = Math.floor(s);
  return `${Math.floor(x / 3600)}:${String(Math.floor((x % 3600) / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};

const nextTask = () => new Promise<void>((r) => setTimeout(r, 0));

export class ChapterSetReplay {
  readonly set: ChapterSetEntry;
  readonly group = new THREE.Group();
  readonly duration: number;
  readonly dt: number;
  /** Render datum, as TakeReplay.offsetY (the same site for every chapter). */
  readonly offsetY: number;
  t = 0;
  playing = false;
  speed = 1;
  engineCamera = true;
  /** Chapter on screen (-1 before the first frame). */
  k = -1;
  /** Chapter the clock waits for (not loaded yet), else null. */
  waiting: number | null = null;
  /** Continuity / load error: the clock stops and the panel shows it. */
  error: string | null = null;
  /** Whole-set checks from the worker, per chapter, and the final ones. */
  checks: (ChapterCheck | null)[];
  final: SetFinalCheck | null = null;
  /** Boundary swaps: the chapter swapped in, the wall ms of that redraw (setTake + show) and the set time. */
  readonly swaps: { k: number; ms: number; at: number }[] = [];
  /** Chapter loads: wall ms of the fetch + parse + hash check, and of the render copy (shift + log). */
  readonly loads: { k: number; fetchMs: number; prepareMs: number }[] = [];
  onChange: () => void = () => {};
  private readonly entries: (TakeManifestEntry | null)[];
  private readonly signal: AbortSignal;
  private people: TakePeople | null = null;
  private templates: Template[] | null = null;
  private loaded = new Map<number, Loaded>();
  private pending = new Map<number, Promise<Loaded | null>>();
  private frame: TakeFrame | null = null;
  private dirty = true;
  private timing: [number, number][] = [];
  private lastPose: CameraPose | null = null;

  private constructor(set: ChapterSetEntry, entries: (TakeManifestEntry | null)[], signal: AbortSignal, offsetY: number, dt: number) {
    this.set = set;
    this.entries = entries;
    this.signal = signal;
    this.offsetY = offsetY;
    this.dt = dt;
    this.duration = set.ticks * dt;
    this.checks = set.chapters.map(() => null);
    this.group.name = 'Chapter set replay · HYPOTHETICAL build scenario (not historical)';
  }

  /** Load chapter 0, fix the datum from it (`datum(file)` = scene ground − take ground), pose t = 0, prefetch chapter 1. */
  static async open(set: ChapterSetEntry, entries: (TakeManifestEntry | null)[], o: { signal: AbortSignal; datum: (f: TakeReplayFile) => Promise<number>; templates: Template[] }) {
    const f0 = await loadTakeFile(set.chapters[0].file, o.signal);
    const r = new ChapterSetReplay(set, entries, o.signal, await o.datum(f0), f0.take.dt);
    r.templates = o.templates;
    r.adopt(0, f0, 0);
    r.update(0);
    return r;
  }

  /** The first chapter's take (hide the building it rebuilds, `buildOf`). */
  firstTake(): Take | null {
    return this.loaded.get(0)?.file.take ?? null;
  }

  /** Chapter of set time T: from·dt ≤ T < to·dt (the set's end is in the last chapter). */
  chapterAt(T: number): number {
    const cs = this.set.chapters;
    for (let k = 0; k < cs.length; k++) if (T < cs[k].to * this.dt) return k;
    return cs.length - 1;
  }
  /** Set seconds at chapter k's start. */
  startOf(k: number) {
    return this.set.chapters[k].from * this.dt;
  }

  private adopt(k: number, f: TakeReplayFile, fetchMs: number): Loaded {
    const t0 = performance.now();
    const c = this.set.chapters[k];
    if (f.take.id !== c.take) throw new Error(`chapter ${c.id}: ${c.file} holds take ${f.take.id}, the set lists ${c.take}`);
    // continuity guard: this chapter starts where the previous one ended (manifest hashes; the worker checks the frames)
    const expected = k ? (this.entries[k - 1]?.finalStateHash ?? '') : this.set.startStateHash;
    const manifest = this.entries[k]?.chapter?.startHash ?? expected;
    const ok = !!expected && f.take.baselineStateHash === expected && manifest === expected;
    const guard = { ok, text: ok ? '' : `continuity ✗: chapter ${c.id} starts from ${f.take.baselineStateHash.slice(0, 8)}…, ${k ? `chapter ${this.set.chapters[k - 1].id} ended at` : 'the set starts from'} ${expected.slice(0, 8)}…${manifest !== expected ? ` (manifest ${manifest.slice(0, 8)}…)` : ''}` };
    const at = this.startOf(k);
    const L: Loaded = {
      k, file: f, render: shiftTake(f.take, this.offsetY), track: trackData(f.camera), trackId: f.camera.id, trackKind: f.camera.kind,
      log: takeLog(f.take, f.steps, { at, clock: setClockTenths }), at, duration: c.ticks * this.dt, guard,
    };
    this.loaded.set(k, L);
    this.loads.push({ k, fetchMs: Math.round(fetchMs), prepareMs: Math.round(performance.now() - t0) });
    return L;
  }

  /** Fetch + parse (+ the take's own hash check) chapter k, then build its render copy in a later task. */
  load(k: number): Promise<Loaded | null> {
    if (k < 0 || k >= this.set.chapters.length) return Promise.resolve(null);
    const have = this.loaded.get(k);
    if (have) return Promise.resolve(have);
    let p = this.pending.get(k);
    if (!p) {
      p = (async () => {
        const t0 = performance.now();
        const f = await loadTakeFile(this.set.chapters[k].file, this.signal);
        const ms = performance.now() - t0;
        await nextTask(); // parse and render copy in separate tasks: no single long frame
        return this.adopt(k, f, ms);
      })();
      p.catch((err: unknown) => {
        if (this.signal.aborted) return;
        this.error = `chapter ${this.set.chapters[k].id} could not load: ${(err as Error).message}`;
        this.playing = false;
        this.onChange();
      }).finally(() => {
        this.pending.delete(k);
        this.dirty = true;
      });
      this.pending.set(k, p);
    }
    return p;
  }

  /** Keep chapters k − 1 … k + 1 parsed; drop the rest. */
  private evict() {
    for (const j of [...this.loaded.keys()]) if (Math.abs(j - this.k) > 1) this.loaded.delete(j);
  }

  setTemplates(ts: Template[]) {
    this.templates = ts;
    this.people?.setTemplates(ts);
    this.dirty = true;
  }

  seek(T: number) {
    this.t = Math.max(0, Math.min(this.duration, T));
    this.dirty = true;
  }

  /** Advance the set clock (only while playing) and redraw. Holds at a boundary whose chapter is not loaded yet. */
  update(dt: number) {
    if (this.playing && !this.error) {
      let T = Math.min(this.duration, this.t + dt * this.speed);
      const k = this.chapterAt(T);
      if (k !== this.k && !this.loaded.has(k)) {
        this.waiting = k;
        void this.load(k);
        if (k > this.k && this.k >= 0) T = Math.min(T, this.startOf(k) - 1e-6);
      }
      this.seek(T);
      if (this.t >= this.duration) this.playing = false;
    }
    if (this.dirty) this.apply();
  }

  private apply() {
    const k = this.chapterAt(this.t);
    const L = this.loaded.get(k);
    if (!L) {
      this.waiting = k;
      void this.load(k);
      return; // dirty stays set: redraw once it is in
    }
    if (!L.guard.ok) {
      this.error = L.guard.text;
      this.playing = false;
      this.dirty = false;
      this.onChange();
      return;
    }
    this.waiting = null;
    this.dirty = false;
    const t0 = performance.now();
    let swapped = false;
    if (!this.people) {
      this.people = new TakePeople(L.render);
      if (this.templates) this.people.setTemplates(this.templates);
      this.group.add(this.people.group);
    }
    if (k !== this.k) {
      this.people.setTake(L.render);
      swapped = this.k >= 0;
      this.k = k;
      this.evict();
      // prefetch the next chapter a moment later, off this frame
      setTimeout(() => { if (this.k === k && !this.signal.aborted) void this.load(k + 1); }, 300);
      if (swapped) this.onChange();
    }
    this.frame = this.people.show(this.t - L.at, this.t);
    const ms = performance.now() - t0;
    if (swapped) this.swaps.push({ k, ms: Math.round(ms * 100) / 100, at: this.t });
    this.timing.push([ms, this.people.sampleMs]);
    if (this.timing.length > 4000) this.timing.splice(0, 2000);
  }

  private cur(): Loaded | null {
    return this.loaded.get(this.k) ?? null;
  }
  /** Local (chapter) time of the set time now. */
  local(): number {
    const L = this.cur();
    return L ? this.t - L.at : 0;
  }

  /** The worker's result for one message. */
  onCheck(m: SetWorkerOut) {
    if (m.type === 'chapter') this.checks[m.k] = m;
    else if (m.type === 'final') this.final = m;
    else this.error ??= `set check failed: ${m.message}`;
  }

  /** Current chapter: index, id, label and its span on the set clock. */
  chapter() {
    const k = Math.max(0, this.k);
    const c = this.set.chapters[k];
    return { k, id: c.id, label: c.label, at: this.startOf(k), end: c.to * this.dt, local: this.local() };
  }

  cameraPose(): CameraPose {
    const L = this.cur();
    if (!L) return this.lastPose ?? { position: [0, 20, 20], target: [0, 0, 0], fov: 50 };
    const p = sampleTrack(L.track, this.t - L.at);
    this.lastPose = this.offsetY ? { ...p, position: [p.position[0], p.position[1] + this.offsetY, p.position[2]], target: [p.target[0], p.target[1] + this.offsetY, p.target[2]] } : p;
    return this.lastPose;
  }
  trackInfo(): { id: string; kind: string; own: boolean } {
    const L = this.cur();
    return { id: L?.trackId ?? '', kind: L?.trackKind ?? '', own: true };
  }
  shotLabel(): string {
    const L = this.cur();
    const shots = (L?.track as (CameraTrackData & { shots?: { label: string; t0: number; t1: number }[] }) | undefined)?.shots ?? [];
    const t = this.local();
    return shots.find((s) => t >= s.t0 && t < s.t1)?.label ?? shots.at(-1)?.label ?? '';
  }
  activeSteps(): TakeStep[] {
    const L = this.cur();
    const t = this.local();
    return L ? L.file.steps.filter((s) => s.start !== null && s.start <= t && (s.end === null || t < s.end)) : [];
  }

  /** The log on the set clock up to now (every chapter's lines, from the worker or the loaded chapter), plus whole-set totals. */
  diagnostics() {
    const logs = this.set.chapters.map((_, j) => this.checks[j]?.log ?? this.loaded.get(j)?.log ?? null);
    const all = logs.flatMap((l) => l ?? []);
    return {
      lines: all.filter((l) => l.t <= this.t),
      violations: all.filter((l) => l.kind === 'violation').length,
      failed: all.filter((l) => l.kind === 'failed').length,
      blocked: all.reduce((n, l) => n + (l.kind === 'blocked' ? (l.n ?? 1) : 0), 0),
      /** chapters whose log is known (the totals cover the whole set once this equals the chapter count) */
      chapters: logs.filter(Boolean).length,
    };
  }

  palmOf(id: string, hand: 'left' | 'right', out: THREE.Vector3) {
    return this.people?.palmOf(id, hand, out) ?? false;
  }
  recordedHands(id: string) {
    const L = this.cur();
    return L ? (sampleTake(L.file.take, this.local()).entities[id]?.hands ?? null) : null;
  }
  bones(id?: string) {
    return this.people?.bones(id) ?? {};
  }

  perf(reset = false) {
    const stat = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b), r = (x: number) => Math.round(x * 100) / 100;
      return s.length ? { mean: r(s.reduce((a, b) => a + b, 0) / s.length), p50: r(s[s.length >> 1]), p95: r(s[Math.floor(s.length * 0.95)]), max: r(s[s.length - 1]) } : null;
    };
    const out = { redraws: this.timing.length, pose: stat(this.timing.map((x) => x[0])), sample: stat(this.timing.map((x) => x[1])), swaps: [...this.swaps], loads: [...this.loads] };
    if (reset) this.timing = [];
    return out;
  }

  /** Test / readout view (take coordinates), independent of the camera. */
  info() {
    const L = this.cur();
    const f = this.frame && L ? sampleTake(L.file.take, this.local()) : null;
    const poses = f ? Object.fromEntries(Object.entries(f.entities).map(([id, e]) => [id, [Math.round(e.p[0] * 1000), Math.round(e.p[1] * 1000), Math.round(e.p[2] * 1000), Math.round(e.yaw * ANG_Q)]])) : {};
    return {
      set: this.set.id,
      t: this.t,
      duration: this.duration,
      playing: this.playing,
      speed: this.speed,
      engineCamera: this.engineCamera,
      chapter: this.chapter(),
      take: L?.file.take.id ?? null,
      loaded: [...this.loaded.keys()].sort((a, b) => a - b),
      waiting: this.waiting,
      error: this.error,
      entities: f ? Object.keys(f.entities).length : 0,
      rendered: { components: this.people?.componentCount() ?? 0, humans: this.people?.humanCount() ?? 0 },
      poseHash: hashOf(poses),
      shot: this.shotLabel(),
      track: this.trackInfo(),
      offsetY: this.offsetY,
      checks: { chapters: this.checks.map((c) => (c ? { id: c.id, hash: c.hash, start: c.start, lines: c.log.length } : null)), final: this.final },
      swaps: [...this.swaps],
    };
  }

  dispose() {
    this.people?.dispose();
    this.loaded.clear();
    this.group.removeFromParent();
  }
}
