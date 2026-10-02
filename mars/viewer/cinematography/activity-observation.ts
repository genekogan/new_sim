// Read-only activity facts into the existing camera vocabulary. No execution or policy.
import type { Vec3 } from '../engine/core/math.ts';
import type { SpatialScene } from '../engine/spatial/types.ts';
import type { Observation } from './types.ts';

export interface CameraActivityFact {
  id: string;
  actors: string[];
  phase: string;
  mode: string;
  status: string;
  focus?: string;
  objects?: string[];
  purpose?: string;
  waitingReason?: string;
}
export interface CameraEntity {
  id: string;
  kind: string;
  pose: { p: number[]; yaw: number };
  human?: { activity?: string; sleepPose?: { mat: string; standingFraction: number } };
  corners?: number[][];
}
const ACTIVITY_CAMERA_SCENARIOS = new Set([
  'prepared-day-4', 'prepared-day-8', 'prepared-day-studio',
  'living-day-4', 'living-day-studio', 'music-dance', 'garden-care',
]);
export const activityCameraScenario = (name: string) => ACTIVITY_CAMERA_SCENARIOS.has(name);
const finitePoint = (p: number[]): p is Vec3 => p.length === 3 && p.every(Number.isFinite);
function phase(f: CameraActivityFact): string {
  const p = f.phase.toLowerCase();
  if (/arriv|joining/.test(p)) return 'arriving';
  if (/depart|leav/.test(p)) return 'departing';
  if (/question/.test(p)) return 'question';
  if (/present|talk-floor/.test(p)) return 'presenting';
  if (/walk|trip|route/.test(p)) return 'walking';
  if (/discuss|convers|gather|social/.test(p)) return 'conversing';
  // Preparation, music, rest and original work use existing focused activity shots.
  return 'working';
}
function priority(f: CameraActivityFact): number {
  if (['completed', 'cancelled', 'failed'].includes(f.status)) return -1;
  if (f.waitingReason || ['waiting', 'paused', 'draining', 'ending'].includes(f.mode)) return 6;
  if (phase(f) === 'question') return 5;
  if (phase(f) === 'presenting') return 4;
  return f.focus ? 3 : 2;
}

export class ActivityObserver {
  session = '';
  version = 0;
  cursor = 0;
  fingerprint = '';
  diagnostics: string[] = [];
  reset(session: string) {
    this.session = session;
    this.version = this.cursor = 0;
    this.fingerprint = '';
    this.diagnostics = [];
  }
  read(entities: readonly CameraEntity[], facts: readonly CameraActivityFact[],
    tick: number, time: number, scene: SpatialScene, geometryVersion = 0,
    aspect = 16 / 9): Observation {
    const subjects: Observation['subjects'] = {};
    this.diagnostics = [];
    for (const e of [...entities].sort((a, b) => a.id.localeCompare(b.id))) {
      if (!finitePoint(e.pose.p) || !Number.isFinite(e.pose.yaw)) {
        this.diagnostics.push(`camera.activity.invalid-subject: ${e.id}`);
        continue;
      }
      const corners = e.corners?.filter(finitePoint);
      const human = e.kind === 'human';
      const seated = e.human?.activity === 'sit';
      const height = human ? (seated ? 1.4 : 1.75)
        : corners?.length ? Math.max(.02, Math.max(...corners.map(p => p[1])) - Math.min(...corners.map(p => p[1]))) : .3;
      let points: Vec3[] = human
        ? [[e.pose.p[0], e.pose.p[1] + height * .72, e.pose.p[2]], [e.pose.p[0], e.pose.p[1] + height - .1, e.pose.p[2]]]
        : corners?.length ? corners.map(p => [...p] as Vec3) : [[...e.pose.p] as Vec3];
      if (human && e.human?.sleepPose) {
        // Frame the authored support extent while lying; no guessed head/finger pose.
        const mat = entities.find(q => q.id === e.human!.sleepPose!.mat);
        const support = mat?.corners?.filter(finitePoint);
        const rise = Math.max(0, Math.min(1, e.human.sleepPose.standingFraction));
        if (support?.length && rise < 1) points = [...support.map(p => [...p] as Vec3),
          [e.pose.p[0], e.pose.p[1] + height * rise, e.pose.p[2]]];
      }
      subjects[e.id] = { p: [...e.pose.p], yaw: e.pose.yaw, height, points,
        ...(human ? { kind: 'human' as const } : {}) };
    }
    const available = (id: string) => !!subjects[id];
    const ordered = [...facts].filter(f => priority(f) >= 0 && f.actors.some(available))
      .sort((a, b) => priority(b) - priority(a) || a.id.localeCompare(b.id));
    const f = ordered[0];
    const members = f ? [...new Set(f.actors)].filter(available).sort()
      : entities.filter(e => e.kind === 'human' && available(e.id)).map(e => e.id).sort();
    const focus = f?.focus && available(f.focus) ? f.focus : members[0];
    const semantic: Observation['activity'] = {
      phase: f ? phase(f) : 'idle', members,
      ...(focus ? { focus, speaker: focus } : {}),
      ...(f?.objects?.find(available) ? { display: f.objects.find(available) } : {}),
      departing: f && phase(f) === 'departing' ? members : [],
    };
    // Identity, purpose and interruption edges matter; elapsed quantities do not.
    const fp = JSON.stringify([semantic, ordered.map(q => [q.id, q.phase, q.mode, q.status, q.purpose, q.waitingReason]), geometryVersion, aspect]);
    if (fp !== this.fingerprint) { this.version++; this.cursor++; this.fingerprint = fp; }
    return { schema: 'mars-camera-observation/1', session: this.session, tick, time,
      aspect, semanticVersion: this.version, geometryVersion, eventCursor: this.cursor,
      subjects, activity: semantic, scene };
  }
}
