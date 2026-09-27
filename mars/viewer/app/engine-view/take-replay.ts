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
import type { Entity } from '../../engine/world/types.ts';
import { ComponentViews } from './components.ts';
import { HumanViews, type SampledHuman } from './humans.ts';
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
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

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
  private comps = new ComponentViews();
  private humans = new HumanViews();
  private walks = new Map<string, Walk>();
  private log: LogLine[];
  private frame: TakeFrame | null = null;
  private dirty = true;

  constructor(file: TakeReplayFile) {
    this.file = file;
    this.take = file.take;
    this.track = trackData(file.camera);
    this.duration = takeDuration(file.take);
    this.group.name = 'Take replay · HYPOTHETICAL build scenario (not historical)';
    this.group.add(this.comps.group, this.humans.group);
    for (const [id, s] of Object.entries(this.take.tracks)) {
      if (this.take.finalState.entities[id]?.kind !== 'human') continue;
      const cum = [0];
      for (let i = 1; i < s.length; i++) cum.push(cum[i - 1] + Math.hypot(s[i][1] - s[i - 1][1], s[i][3] - s[i - 1][3]) / POS_Q);
      this.walks.set(id, { ticks: s.map((x) => x[0]), cum, track: s });
    }
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
    this.humans.setTemplates(ts);
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

  private apply() {
    this.dirty = false;
    const frame = (this.frame = sampleTake(this.take, this.t));
    const comps: Record<string, Entity> = {};
    const people: SampledHuman[] = [];
    const dt = this.take.dt, span = 0.15 / dt; // ±0.15 s speed window
    for (const [id, e] of Object.entries(frame.entities)) {
      const src = this.take.finalState.entities[id];
      if (!src) continue;
      if (src.kind === 'component') {
        comps[id] = { ...src, pose: { p: e.p, yaw: e.yaw, pitch: e.pitch, roll: e.roll } };
        continue;
      }
      const w = this.walks.get(id);
      const dist = w ? this.walked(w, frame.tick) : 0;
      const speed = w ? (this.walked(w, frame.tick + span) - this.walked(w, frame.tick - span)) / (2 * span * dt) : 0;
      const climbing = !!e.activity?.startsWith('climb');
      const grip = (e.state.grip as { entity?: string } | undefined)?.entity;
      people.push({ id, p: e.p, yaw: e.yaw, walk: climbing ? 1 : clamp01((speed - 0.06) / 0.25), walkDist: dist, activity: e.activity, grip });
    }
    this.comps.onTick({ entities: comps });
    this.comps.render(1);
    this.humans.setFrame(people, this.t);
    this.humans.render(1, (id, from, out) => this.comps.nearestPoint(id, from, out));
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
      rendered: { components: this.comps.group.children.length, humans: this.humans.group.children.length },
      finalStateHash: hashOf(this.take.finalState),
      recordedFinalStateHash: this.take.finalStateHash,
      poseHash: hashOf(poses),
      shot: this.shotLabel(),
    };
  }

  dispose() {
    this.humans.clear();
    this.comps.dispose();
    this.group.removeFromParent();
  }
}
