// Recorded take → three.js overlay (spec §21–23, §18). Reads only the take file:
// `sampleTake` for poses/discrete state, `sampleTrack` for the planned camera.
// Everything is random access in take time, so scrubbing, pausing, the speed
// and whether the engine camera is on can never change what is shown at a
// given t (spec §18: the take plays identically with any camera).
import * as THREE from 'three';
import { hashOf } from '../../engine/core/hash.ts';
import { ANG_Q, POS_Q, type CameraTrack, type PoseSample, type Take, type TakeEvent } from '../../engine/take/types.ts';
import { interpSample, replayFinalState, sampleTake, takeDuration, type TakeFrame } from '../../engine/take/replay.ts';
import { fileCamera, fileCameras, sampleTrack, trackData, withFileCamera, type CameraTrackData, type TakeFileCameras } from '../../engine/camera/track.ts';
import type { CameraPose } from '../../engine/camera/shots.ts';
import type { Vec3 } from '../../engine/core/math.ts';
import type { Entity, WorldState } from '../../engine/world/types.ts';
import type { SpatialScene } from '../../engine/spatial/types.ts';
import { def } from '../../engine/world/catalog.ts';
import { progressiveContributor } from '../../engine/construction/contributor.ts';
import { isPlywood } from '../../engine/construction/deck.ts';
import { ComponentViews } from './components.ts';
import { FixtureViews } from './fixtures.ts';
import { HumanViews, type Hands, type SampledHuman } from './humans.ts';
import type { Template } from './people.ts';

export type TakeStep = { id: string; verb: string; label?: string; start: number | null; end: number | null; status?: string };
export type TakeManifestEntry = {
  id: string;
  file: string;
  label: string;
  year: number;
  hypothetical: boolean;
  duration: number;
  entities: number;
  finalStateHash: string;
  cameraTrack: string;
  moments: Record<string, number>;
  violations: number;
  blockedWaits: number;
  bytes: number;
  /** Optional in older manifests. */
  ticks?: number;
  rulesVersion?: string;
  takeSchema?: string;
  /** 'year-build' marks a "Watch it being built" take; absent → inferred from `rulesVersion` (STUDIO_REPLAY.md). */
  kind?: string;
};
/** `takes`: recorded on the 2026 scene; `otherYears`: recorded in another year's frame. The studio lists both, filtered by `year`. */
export type TakeManifest = { schema: 'mars-take-manifest/1'; takes: TakeManifestEntry[]; otherYears?: TakeManifestEntry[] };
/** Build site of a take; `groundY` is the take's ground datum (the year-build fork: the Kit datum 0). */
export type TakeSite = { origin: [number, number]; yaw: number; groundY: number };
export type TakeReplayFile = {
  schema: 'mars-take-replay/1';
  label: string;
  hypothetical: boolean;
  note: string;
  /** Campus id of the year the take was recorded in (`mars-2026`, `mars-2022`, …). */
  campus?: string;
  site?: TakeSite;
  steps: TakeStep[];
  moments: Record<string, number>;
  take: Take;
  camera: CameraTrack;
  /** Extra camera tracks of this take (CAMERA_DIRECT.md §8.2: directed ones), keyed by id; absent when none. */
  cameras?: TakeFileCameras;
};
/** A year-build ("Watch it being built") manifest entry: explicit `kind`, else the year-build rules version. */
export const isYearBuild = (e: Pick<TakeManifestEntry, 'kind' | 'rulesVersion'>) => (e.kind ? e.kind === 'year-build' : /year-build/.test(e.rulesVersion ?? ''));
export const TAKE_MANIFEST_URL = '/engine/takes/manifest.json';

/** A take-log line for the diagnostics readout (failures, blocked waits, violations). `n`: repeated waits merged into
 *  the line (mars-take/4 events), counted in the totals. */
export type LogLine = { t: number; kind: 'violation' | 'failed' | 'blocked'; text: string; n?: number };

/** The entity record the replay draws `id` from: the final state, else (mars-take/4) as first recorded (removed before the end). */
const recordOf = (take: Take, id: string) => take.finalState.entities[id] ?? take.entities0?.[id];

export async function loadTakeFile(url: string, signal?: AbortSignal): Promise<TakeReplayFile> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`take ${url}: HTTP ${r.status}`);
  const f = (await r.json()) as TakeReplayFile;
  if (f.schema !== 'mars-take-replay/1') throw new Error(`take ${url}: unexpected schema ${String(f.schema)}`);
  if (f.camera.takeId !== f.take.id) throw new Error(`camera track ${f.camera.id} belongs to take ${f.camera.takeId}, not ${f.take.id}`);
  fileCameras(f); // throws on a malformed track or one of another take (the planned `camera` and every `cameras` entry)
  replayFinalState(f.take); // throws if the recorded final state no longer hashes to finalStateHash
  return f;
}

/**
 * A render copy of a take shifted by `dy` metres in y (tracks, recorded hand points, final poses). Only for drawing:
 * its hashes no longer match, so hashing, sampling for the camera and the canonical check use the original.
 */
export function shiftTake(take: Take, dy: number): Take {
  if (!dy) return take;
  const q = Math.round(dy * POS_Q);
  const up = (p: number[] | undefined) => (p ? [p[0], p[1] + q, p[2]] : p); // recorded hand points are integer mm
  const tracks = Object.fromEntries(Object.entries(take.tracks).map(([id, s]) => [id, s.map((x) => { const y = [...x] as PoseSample; y[2] += q; return y; })]));
  const changes = take.changes.map((c) => {
    if (c[2] !== 'hands' || !c[3]) return c;
    const h = c[3] as { left?: number[]; right?: number[] };
    return [c[0], c[1], c[2], { ...(h.left ? { left: up(h.left) } : {}), ...(h.right ? { right: up(h.right) } : {}) }] as typeof c;
  });
  const entities = Object.fromEntries(Object.entries(take.finalState.entities).map(([id, e]) => [id, { ...e, pose: { ...e.pose, p: [e.pose.p[0], e.pose.p[1] + dy, e.pose.p[2]] as Vec3 } }]));
  return { ...take, tracks, changes, finalState: { ...take.finalState, entities } };
}

type Walk = { ticks: number[]; cum: number[]; track: PoseSample[] };
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const EMPTY_SCENE: SpatialScene = { bounds: [0, 0, 0, 0], levels: [], surfaces: [], obstacles: [], links: [] };

/**
 * People and components of a take at any time t — the random-access half of the replay, shared by the
 * studio (TakeReplay) and the lab's replay check. The same pose path as the live lab (humans.ts
 * setFrame → render, components attachHeld): when the take carries the engine's `hands`,
 * `baseActivity` and `on` fields (HumanState; TakeRecorder FIELDS), arms go to the recorded hand points
 * (`sampleTake`: metres, interpolated between mars-take/3 keyframes; a /2 take holds each tick's value), eat / serve sit on their base, postures are solved from the
 * hands, items `in-hand` (support from the frame, not the final state) ride the rendered palms; people
 * on a usable stairs link walk it tread by tread — links from the base scene (optional) plus the
 * construction contributor over the frame's components (installed flights with all treads).
 */
export class TakePeople {
  readonly group = new THREE.Group();
  readonly take: Take;
  private comps = new ComponentViews();
  private fixtures = new FixtureViews();
  private humans = new HumanViews();
  private walks = new Map<string, Walk>();
  private base: SpatialScene;
  private stairKey = '';
  frame: TakeFrame | null = null;
  /** Wall ms of the last show()'s `sampleTake` (the rest of show() is posing the three.js views). */
  sampleMs = 0;

  constructor(take: Take, opts: { scene?: SpatialScene } = {}) {
    this.take = take;
    this.base = opts.scene ?? EMPTY_SCENE;
    this.group.add(this.comps.group, this.fixtures.group, this.humans.group);
    for (const [id, s] of Object.entries(take.tracks)) {
      if (recordOf(take, id)?.kind !== 'human') continue;
      const cum = [0];
      for (let i = 1; i < s.length; i++) cum.push(cum[i - 1] + Math.hypot(s[i][1] - s[i - 1][1], s[i][3] - s[i - 1][3]) / POS_Q);
      this.walks.set(id, { ticks: s.map((x) => x[0]), cum, track: s });
    }
    this.humans.setStairs(this.base.links);
  }

  setTemplates(ts: Template[]) {
    this.humans.setTemplates(ts);
  }

  /** Metres walked by `id` up to `tick` along its recorded track (horizontal). */
  private walked(w: Walk, tick: number) {
    const s = w.track;
    if (tick <= s[0][0]) return 0;
    let lo = 0, hi = s.length - 1;
    if (tick >= s[hi][0]) return w.cum[hi];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid][0] <= tick) lo = mid;
      else hi = mid;
    }
    const p = interpSample(s[lo], s[hi], tick);
    return w.cum[lo] + Math.hypot(p[1] - s[lo][1], p[3] - s[lo][3]) / POS_Q;
  }

  /** Stair links for this frame's components (only when stair-relevant state changed). */
  private stairs(comps: Record<string, Entity>) {
    const rel = Object.values(comps).filter((e) => e.def === 'stair-tread' || def(e.def).category === 'stair' || isPlywood(e));
    const key = rel.map((e) => `${e.id}:${e.phase}:${e.pose.p.join(',')}`).join('|');
    if (key === this.stairKey) return;
    this.stairKey = key;
    const links = rel.length ? (progressiveContributor({ entities: comps } as unknown as WorldState, this.base).links ?? []) : [];
    this.humans.setStairs([...this.base.links, ...links]);
  }

  /** Pose everything at take time t (seconds). */
  show(t: number) {
    const s0 = performance.now();
    const frame = (this.frame = sampleTake(this.take, t));
    this.sampleMs = performance.now() - s0;
    const comps: Record<string, Entity> = {};
    const fixtures: Record<string, Entity> = {};
    const people: SampledHuman[] = [];
    const dt = this.take.dt, span = 0.15 / dt; // ±0.15 s speed window
    for (const [id, e] of Object.entries(frame.entities)) {
      const src = recordOf(this.take, id) as Entity | undefined; // pose / phase / contents below come from the frame
      if (!src) continue;
      const st = e.state as { grip?: { entity?: string; slot?: string }; support?: Entity['support']; connections?: Entity['connections']; contents?: Entity['contents']; hands?: Hands; baseActivity?: string; on?: string };
      if (src.kind === 'component') {
        // discrete state as of t (the final state's phase / support would put every item in its last place)
        comps[id] = { ...src, pose: { p: e.p, yaw: e.yaw, pitch: e.pitch, roll: e.roll }, ...(e.phase ? { phase: e.phase as Entity['phase'] } : {}), ...('support' in st ? { support: st.support ?? undefined } : {}), ...('connections' in st ? { connections: st.connections ?? undefined } : {}), ...(st.contents ? { contents: st.contents } : {}) };
        continue;
      }
      if (src.kind === 'fixture') {
        // piles / bundles, the cutting station, benches, campfires: pose + contents as of t (a pile shrinks)
        fixtures[id] = { ...src, pose: { p: e.p, yaw: e.yaw, pitch: e.pitch, roll: e.roll }, ...(st.contents ? { contents: st.contents } : {}) };
        continue;
      }
      if (src.kind !== 'human') continue;
      const w = this.walks.get(id);
      const dist = w ? this.walked(w, frame.tick) : 0;
      const speed = w ? (this.walked(w, frame.tick + span) - this.walked(w, frame.tick - span)) / (2 * span * dt) : 0;
      const climbing = !!e.activity?.startsWith('climb');
      const g = st.grip;
      people.push({ id, p: e.p, yaw: e.yaw, walk: climbing ? 1 : clamp01((speed - 0.06) / 0.25), walkDist: dist, activity: e.activity, grip: g?.entity, gripSlot: g?.slot, hands: e.hands, baseActivity: st.baseActivity ?? undefined, on: st.on ?? undefined });
    }
    this.stairs(comps);
    this.comps.onTick({ entities: comps });
    this.comps.render(1);
    this.fixtures.onTick({ entities: fixtures });
    this.fixtures.render(t);
    this.humans.setFrame(people, t, { ...comps, ...fixtures }); // seats / fires come from the fixtures
    this.humans.render(1, (id, from, out) => this.comps.nearestPoint(id, from, out));
    this.comps.attachHeld(this.humans);
    return frame;
  }

  /** Pose readout (lab hook / tests): as HumanViews.bones for the last show(). */
  bones(id?: string) {
    return this.humans.bones(id);
  }

  /** Rendered palm of a person's hand and an item's rendered origin (tests: items ride the palm). */
  palmOf(id: string, hand: 'left' | 'right', out: THREE.Vector3) {
    return this.humans.palmOf(id, hand, out);
  }
  positionOf(id: string) {
    return this.comps.positionOf(id);
  }
  /** Stair flights in use (readout). */
  flights() {
    return this.humans.stairs();
  }
  humanCount() {
    return this.humans.group.children.length;
  }
  /** Components and fixtures drawn. */
  componentCount() {
    return this.comps.group.children.length + this.fixtures.group.children.length;
  }
  /** Bundles / stacks drawn with their piece counts (readout). */
  stacks() {
    return this.fixtures.stacks();
  }

  dispose() {
    this.humans.clear();
    this.comps.dispose();
    this.fixtures.dispose();
    this.group.removeFromParent();
  }
}

/** A camera track the replay can drive the view with: the take's own planned track or a directed one. */
export type ActiveTrack = { id: string; kind: string; data: CameraTrackData };
/** One entry of the replay bar's camera picker. `own`: the take's planned track; `saved`: carried by the take file. */
export type CameraOption = { id: string; kind: string; label: string; own: boolean; saved: boolean };
/** Picker text for a track: its kind (the planned shot list reads "planned"), id and shot count. */
export function cameraLabel(t: ActiveTrack): string {
  const shots = (t.data as CameraTrackData & { shots?: unknown[] }).shots?.length ?? 0;
  const kind = t.kind === 'planned-shot-list' ? 'planned' : t.kind;
  return `${kind} · ${t.id}${shots ? ` · ${shots} shot${shots === 1 ? '' : 's'}` : ''}`;
}

export class TakeReplay {
  readonly group = new THREE.Group();
  readonly file: TakeReplayFile;
  readonly take: Take;
  readonly duration: number;
  /**
   * Render datum: take coordinates + (0, offsetY, 0) = scene coordinates. The drawn people / parts (a shifted render
   * copy of the take) and the engine camera are both shifted, so the take stays self-consistent (STUDIO_REPLAY.md: year-build takes are at the Kit datum y = 0, the
   * studio draws the ground at the year file's `groundY`).
   */
  readonly offsetY: number;
  private own: ActiveTrack;
  private active: ActiveTrack;
  t = 0;
  playing = false;
  speed = 1;
  engineCamera = true;
  private people: TakePeople;
  private log: LogLine[];
  private frame: TakeFrame | null = null;
  private dirty = true;

  /** `scene`: the take's base SpatialScene when the host has it (its stairs links get the stair gait). */
  constructor(file: TakeReplayFile, opts: { scene?: SpatialScene; offsetY?: number } = {}) {
    this.file = file;
    this.take = file.take;
    this.own = this.active = { id: file.camera.id, kind: file.camera.kind, data: trackData(file.camera) };
    this.duration = takeDuration(file.take);
    this.offsetY = opts.offsetY ?? 0;
    this.group.name = 'Take replay · HYPOTHETICAL build scenario (not historical)';
    // the render copy is shifted in data (not by moving the group): the arm / leg solvers mix bone world positions with
    // the engine's target points, so the people must be posed in scene coordinates
    this.people = new TakePeople(shiftTake(file.take, this.offsetY), opts);
    this.group.add(this.people.group);
    const stepLabel = new Map(file.steps.map((s) => [`step:${s.id}`, s.label ?? s.id]));
    this.log = this.take.events.flatMap((e: TakeEvent): LogLine[] => {
      const t = e.t * this.take.dt;
      if (e.type === 'violation') return [{ t, kind: 'violation', text: `${e.code}: ${e.message}` }];
      if (e.type !== 'action') return [];
      const who = stepLabel.get(e.id) ?? e.id;
      if (e.status === 'failed') return [{ t, kind: 'failed', text: `${who} failed${e.code ? ` (${e.code})` : ''}${e.message ? `: ${e.message}` : ''}` }];
      if (e.status === 'blocked') return [{ t, kind: 'blocked', text: `${who} waiting: ${e.code ?? 'blocked'}${e.message ? ` — ${e.message}` : ''}${e.n ? ` (×${e.n} until ${(e.until! * this.take.dt).toFixed(1)} s)` : ''}`, ...(e.n ? { n: e.n } : {}) }];
      return [];
    });
  }

  setTemplates(ts: Template[]) {
    this.people.setTemplates(ts);
    this.dirty = true;
  }

  seek(t: number) {
    this.t = Math.max(0, Math.min(this.duration, t));
    this.dirty = true;
  }

  /** Advance the take clock (only while playing) and redraw if anything changed. */
  update(dt: number) {
    if (this.playing) {
      this.seek(this.t + dt * this.speed);
      if (this.t >= this.duration) this.playing = false;
    }
    if (this.dirty) this.apply();
  }

  private apply() {
    this.dirty = false;
    const t0 = performance.now();
    this.frame = this.people.show(this.t);
    this.timing.push([performance.now() - t0, this.people.sampleMs]);
    if (this.timing.length > 4000) this.timing.splice(0, 2000);
  }
  private timing: [number, number][] = [];

  /**
   * Wall ms per redraw since the last reset (at most the last 2000–4000): `pose` = the whole show() (sampleTake + posing
   * people, parts and piles), `sample` = sampleTake alone. Rendering is not included (the studio's frame loop).
   */
  perf(reset = false) {
    const stat = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b), r = (x: number) => Math.round(x * 100) / 100;
      return s.length ? { mean: r(s.reduce((a, b) => a + b, 0) / s.length), p50: r(s[s.length >> 1]), p95: r(s[Math.floor(s.length * 0.95)]), max: r(s[s.length - 1]) } : null;
    };
    const out = { redraws: this.timing.length, pose: stat(this.timing.map((x) => x[0])), sample: stat(this.timing.map((x) => x[1])) };
    if (reset) this.timing = [];
    return out;
  }

  /** Pose readout of the people on screen (HumanViews.bones). */
  bones(id?: string) {
    return this.people.bones(id);
  }

  /** Track driving the engine camera (take coordinates). */
  get track(): CameraTrackData {
    return this.active.data;
  }
  /** Id / kind of the active track (the take's own `planned-shot-list`, or a `directed` one). */
  trackInfo(): { id: string; kind: string; own: boolean } {
    return { id: this.active.id, kind: this.active.kind, own: this.active === this.own };
  }
  /** Drive the engine camera with another track of this take (a directed one), or back to the take's own (null). */
  setTrack(track: ActiveTrack | null) {
    this.active = track ?? this.own;
  }

  /** Every camera track the take file carries: the planned one first, then `cameras` in id order (`fileCameras`). */
  fileTracks(): CameraOption[] {
    return fileCameras(this.file).map((c) => {
      const own = c.id === this.own.id;
      return { id: c.id, kind: c.kind, label: cameraLabel(own ? this.own : { id: c.id, kind: c.kind, data: trackData(c) }), own, saved: true };
    });
  }
  /** Drive the engine camera with one of the file's tracks by id (the planned one restores the take's own). */
  useFileTrack(id: string): ActiveTrack {
    if (id === this.own.id) return (this.active = this.own);
    const c = fileCamera(this.file, id);
    if (!c) throw new Error(`take ${this.take.id} has no camera track ${id}`);
    return (this.active = { id: c.id, kind: c.kind, data: trackData(c) });
  }
  /**
   * The take file with `track` added to its `cameras` map (`withFileCamera`: checked, the take and the planned camera
   * untouched). The replay's own file carries it from now on, so the picker lists it as saved.
   */
  withTrack(track: ActiveTrack): TakeReplayFile {
    const f = withFileCamera(this.file, { id: track.id, takeId: this.take.id, kind: track.kind, data: track.data });
    this.file.cameras = f.cameras;
    return f;
  }

  /** Engine camera at the current take time, in scene coordinates (the datum offset applied). */
  cameraPose(): CameraPose {
    const p = sampleTrack(this.track, this.t);
    if (!this.offsetY) return p;
    return { ...p, position: [p.position[0], p.position[1] + this.offsetY, p.position[2]], target: [p.target[0], p.target[1] + this.offsetY, p.target[2]] };
  }

  /** Rendered palm of a person's hand in scene coordinates (posed on the last update). */
  palmOf(id: string, hand: 'left' | 'right', out: THREE.Vector3) {
    return this.people.palmOf(id, hand, out);
  }
  /** The recorded `hands` of a person at the current time (take coordinates: add offsetY for the scene). */
  recordedHands(id: string): Hands | null {
    return sampleTake(this.take, this.t).entities[id]?.hands ?? null;
  }

  /** Current shot label from the planned shot list (if the track carries one). */
  shotLabel(): string {
    const shots = (this.track as CameraTrackData & { shots?: { label: string; t0: number; t1: number }[] }).shots ?? [];
    return shots.find((s) => this.t >= s.t0 && this.t < s.t1)?.label ?? shots.at(-1)?.label ?? '';
  }

  /** Steps executing at the current time. */
  activeSteps(): TakeStep[] {
    return this.file.steps.filter((s) => s.start !== null && s.start <= this.t && (s.end === null || this.t < s.end));
  }

  /** Diagnostics log up to the current time (newest last) plus totals over the whole take. */
  diagnostics() {
    const upTo = this.log.filter((l) => l.t <= this.t);
    return {
      lines: upTo,
      violations: this.log.filter((l) => l.kind === 'violation').length,
      failed: this.log.filter((l) => l.kind === 'failed').length,
      blocked: this.log.reduce((k, l) => k + (l.kind === 'blocked' ? (l.n ?? 1) : 0), 0),
    };
  }

  /** Test / readout view: what is on screen right now, independent of the camera. */
  info() {
    const f = !this.offsetY && this.frame ? this.frame : sampleTake(this.take, this.t); // take coordinates
    const poses = Object.fromEntries(Object.entries(f.entities).map(([id, e]) => [id, [Math.round(e.p[0] * 1000), Math.round(e.p[1] * 1000), Math.round(e.p[2] * 1000), Math.round(e.yaw * ANG_Q)]]));
    return {
      id: this.take.id,
      t: this.t,
      duration: this.duration,
      playing: this.playing,
      speed: this.speed,
      engineCamera: this.engineCamera,
      entities: Object.keys(f.entities).length,
      rendered: { components: this.people.componentCount(), humans: this.people.humanCount() },
      finalStateHash: hashOf(this.take.finalState),
      recordedFinalStateHash: this.take.finalStateHash,
      poseHash: hashOf(poses),
      shot: this.shotLabel(),
      track: this.trackInfo(),
      /** Sampled now but not drawable: no final-state record and no `entities0` (a pre-mars-take/4 take's emptied pile). */
      undrawable: Object.keys(f.entities).filter((id) => !recordOf(this.take, id)),
      offsetY: this.offsetY,
    };
  }

  dispose() {
    this.people.dispose();
    this.group.removeFromParent();
  }
}
