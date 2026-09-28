// Recorded take → three.js overlay (spec §21–23, §18). Reads only the take file:
// `sampleTake` for poses/discrete state, `sampleTrack` for the planned camera.
// Everything is random access in take time, so scrubbing, pausing, the speed
// and whether the engine camera is on can never change what is shown at a
// given t (spec §18: the take plays identically with any camera).
import * as THREE from 'three';
import { hashOf } from '../../engine/core/hash.ts';
import { ANG_Q, POS_Q, type CameraTrack, type PoseSample, type Take, type TakeEvent } from '../../engine/take/types.ts';
import { interpSample, replayFinalState, sampleTake, takeDuration, type TakeFrame } from '../../engine/take/replay.ts';
import { sampleTrack, trackData, type CameraTrackData } from '../../engine/camera/track.ts';
import type { CameraPose } from '../../engine/camera/shots.ts';
import type { Vec3 } from '../../engine/core/math.ts';
import type { Entity, WorldState } from '../../engine/world/types.ts';
import type { SpatialScene } from '../../engine/spatial/types.ts';
import { def } from '../../engine/world/catalog.ts';
import { progressiveContributor } from '../../engine/construction/contributor.ts';
import { isPlywood } from '../../engine/construction/deck.ts';
import { ComponentViews } from './components.ts';
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
};
export type TakeManifest = { schema: 'mars-take-manifest/1'; takes: TakeManifestEntry[] };
export type TakeReplayFile = {
  schema: 'mars-take-replay/1';
  label: string;
  hypothetical: boolean;
  note: string;
  steps: TakeStep[];
  moments: Record<string, number>;
  take: Take;
  camera: CameraTrack;
};
export const TAKE_MANIFEST_URL = '/engine/takes/manifest.json';

/** A take-log line for the diagnostics readout (failures, blocked waits, violations). */
export type LogLine = { t: number; kind: 'violation' | 'failed' | 'blocked'; text: string };

export async function loadTakeFile(url: string, signal?: AbortSignal): Promise<TakeReplayFile> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`take ${url}: HTTP ${r.status}`);
  const f = (await r.json()) as TakeReplayFile;
  if (f.schema !== 'mars-take-replay/1') throw new Error(`take ${url}: unexpected schema ${String(f.schema)}`);
  if (f.camera.takeId !== f.take.id) throw new Error(`camera track ${f.camera.id} belongs to take ${f.camera.takeId}, not ${f.take.id}`);
  replayFinalState(f.take); // throws if the recorded final state no longer hashes to finalStateHash
  return f;
}

type Walk = { ticks: number[]; cum: number[]; track: PoseSample[] };
/** One person's recorded hand points: the take's `hands` change events, in tick order. */
type HandTrack = { ticks: number[]; hands: (Hands | null)[] };
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const EMPTY_SCENE: SpatialScene = { bounds: [0, 0, 0, 0], levels: [], surfaces: [], obstacles: [], links: [] };

/**
 * People and components of a take at any time t — the random-access half of the replay, shared by the
 * studio (TakeReplay) and the lab's replay check. The same pose path as the live lab (humans.ts
 * setFrame → render, components attachHeld): when the take carries the engine's `hands`,
 * `baseActivity` and `on` fields (HumanState; TakeRecorder FIELDS), arms go to the recorded hand points
 * (interpolated between consecutive ticks), eat / serve sit on their base, postures are solved from the
 * hands, items `in-hand` (support from the frame, not the final state) ride the rendered palms; people
 * on a usable stairs link walk it tread by tread — links from the base scene (optional) plus the
 * construction contributor over the frame's components (installed flights with all treads).
 */
export class TakePeople {
  readonly group = new THREE.Group();
  readonly take: Take;
  private comps = new ComponentViews();
  private humans = new HumanViews();
  private walks = new Map<string, Walk>();
  private handTracks = new Map<string, HandTrack>();
  private base: SpatialScene;
  private stairKey = '';
  frame: TakeFrame | null = null;

  constructor(take: Take, opts: { scene?: SpatialScene } = {}) {
    this.take = take;
    this.base = opts.scene ?? EMPTY_SCENE;
    this.group.add(this.comps.group, this.humans.group);
    for (const [id, s] of Object.entries(take.tracks)) {
      if (take.finalState.entities[id]?.kind !== 'human') continue;
      const cum = [0];
      for (let i = 1; i < s.length; i++) cum.push(cum[i - 1] + Math.hypot(s[i][1] - s[i - 1][1], s[i][3] - s[i - 1][3]) / POS_Q);
      this.walks.set(id, { ticks: s.map((x) => x[0]), cum, track: s });
    }
    for (const [tick, id, field, value] of take.changes) {
      if (field !== 'hands') continue;
      let h = this.handTracks.get(id);
      if (!h) this.handTracks.set(id, (h = { ticks: [], hands: [] }));
      h.ticks.push(tick);
      h.hands.push((value as Hands | null) ?? null);
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

  /** Recorded hand points at (fractional) `tick`: the last change, blended into the next one when that is the next tick (a hand moving every tick). */
  private handsAt(id: string, tick: number): Hands | undefined {
    const h = this.handTracks.get(id);
    if (!h || tick < h.ticks[0]) return undefined;
    let lo = 0, hi = h.ticks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (h.ticks[mid] <= tick) lo = mid;
      else hi = mid - 1;
    }
    const a = h.hands[lo] ?? undefined, b = h.hands[lo + 1] ?? undefined;
    const f = tick - h.ticks[lo];
    if (!a || !b || f <= 0 || h.ticks[lo + 1] - h.ticks[lo] !== 1) return a;
    const one = (p?: Vec3, q?: Vec3): Vec3 | undefined => (p && q ? [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f] : p);
    return { ...(a.left ? { left: one(a.left, b.left) } : {}), ...(a.right ? { right: one(a.right, b.right) } : {}) };
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
    const frame = (this.frame = sampleTake(this.take, t));
    const comps: Record<string, Entity> = {};
    const people: SampledHuman[] = [];
    const dt = this.take.dt, span = 0.15 / dt; // ±0.15 s speed window
    for (const [id, e] of Object.entries(frame.entities)) {
      const src = this.take.finalState.entities[id];
      if (!src) continue;
      const st = e.state as { grip?: { entity?: string; slot?: string }; support?: Entity['support']; connections?: Entity['connections']; contents?: Entity['contents']; hands?: Hands; baseActivity?: string; on?: string };
      if (src.kind === 'component') {
        // discrete state as of t (the final state's phase / support would put every item in its last place)
        comps[id] = { ...src, pose: { p: e.p, yaw: e.yaw, pitch: e.pitch, roll: e.roll }, ...(e.phase ? { phase: e.phase as Entity['phase'] } : {}), ...('support' in st ? { support: st.support ?? undefined } : {}), ...('connections' in st ? { connections: st.connections ?? undefined } : {}), ...(st.contents ? { contents: st.contents } : {}) };
        continue;
      }
      const w = this.walks.get(id);
      const dist = w ? this.walked(w, frame.tick) : 0;
      const speed = w ? (this.walked(w, frame.tick + span) - this.walked(w, frame.tick - span)) / (2 * span * dt) : 0;
      const climbing = !!e.activity?.startsWith('climb');
      const g = st.grip;
      people.push({ id, p: e.p, yaw: e.yaw, walk: climbing ? 1 : clamp01((speed - 0.06) / 0.25), walkDist: dist, activity: e.activity, grip: g?.entity, gripSlot: g?.slot, hands: this.handsAt(id, frame.tick), baseActivity: st.baseActivity ?? undefined, on: st.on ?? undefined });
    }
    this.stairs(comps);
    this.comps.onTick({ entities: comps });
    this.comps.render(1);
    this.humans.setFrame(people, t, comps);
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
  componentCount() {
    return this.comps.group.children.length;
  }

  dispose() {
    this.humans.clear();
    this.comps.dispose();
    this.group.removeFromParent();
  }
}

export class TakeReplay {
  readonly group = new THREE.Group();
  readonly file: TakeReplayFile;
  readonly take: Take;
  readonly track: CameraTrackData;
  readonly duration: number;
  t = 0;
  playing = false;
  speed = 1;
  engineCamera = true;
  private people: TakePeople;
  private log: LogLine[];
  private frame: TakeFrame | null = null;
  private dirty = true;

  /** `scene`: the take's base SpatialScene when the host has it (its stairs links get the stair gait). */
  constructor(file: TakeReplayFile, opts: { scene?: SpatialScene } = {}) {
    this.file = file;
    this.take = file.take;
    this.track = trackData(file.camera);
    this.duration = takeDuration(file.take);
    this.group.name = 'Take replay · HYPOTHETICAL build scenario (not historical)';
    this.people = new TakePeople(file.take, opts);
    this.group.add(this.people.group);
    const stepLabel = new Map(file.steps.map((s) => [`step:${s.id}`, s.label ?? s.id]));
    this.log = this.take.events.flatMap((e: TakeEvent): LogLine[] => {
      const t = e.t * this.take.dt;
      if (e.type === 'violation') return [{ t, kind: 'violation', text: `${e.code}: ${e.message}` }];
      if (e.type !== 'action') return [];
      const who = stepLabel.get(e.id) ?? e.id;
      if (e.status === 'failed') return [{ t, kind: 'failed', text: `${who} failed${e.code ? ` (${e.code})` : ''}${e.message ? `: ${e.message}` : ''}` }];
      if (e.status === 'blocked') return [{ t, kind: 'blocked', text: `${who} waiting: ${e.code ?? 'blocked'}${e.message ? ` — ${e.message}` : ''}` }];
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
    this.frame = this.people.show(this.t);
  }

  /** Pose readout of the people on screen (HumanViews.bones). */
  bones(id?: string) {
    return this.people.bones(id);
  }

  /** Planned engine camera at the current take time. */
  cameraPose(): CameraPose {
    return sampleTrack(this.track, this.t);
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
      blocked: this.log.filter((l) => l.kind === 'blocked').length,
    };
  }

  /** Test / readout view: what is on screen right now, independent of the camera. */
  info() {
    const f = this.frame ?? sampleTake(this.take, this.t);
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
    };
  }

  dispose() {
    this.people.dispose();
    this.group.removeFromParent();
  }
}
