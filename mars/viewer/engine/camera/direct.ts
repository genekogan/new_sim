// Camera direction language (OWNER_FEEDBACK_2026-09-28 §11, layer 1; docs/engineering/CAMERA_DIRECT.md).
// A director (LLM or person) fills typed `CameraDirection`s; this module validates them, resolves every
// name through the semantic world (entities, take structures, scene assemblies, regions, fixtures, social
// groups) and compiles each one into a `ShotIntent`: resolved subject + motion + timing + framing +
// context constraints. `synth.ts` turns intents into computed trajectories.
// Rules: ambiguity is a structured question (Diagnostic 'camera.direct.ambiguous' listing candidates),
// never a guess; unknown names are refused with what is known; nothing here mutates the world.
import { z } from 'zod';
import type { Diagnostic } from '../actions/types.ts';
import { obbCorners, type Vec3 } from '../core/math.ts';
import { entityCorners } from '../spatial/service.ts';
import type { Obstacle, SpatialScene } from '../spatial/types.ts';
import type { Entity, Region, WorldState } from '../world/types.ts';
import type { Take } from '../take/types.ts';
import { sunBehindWindow, type SunBehindWindow } from '../env/sun.ts';
import { DEFAULT_FOV } from './shots.ts';

// ---- vocabulary -------------------------------------------------------------------------------------

const ref = z.string().min(1).max(120);
const coord = z.number().min(-500).max(500);
const vec3 = z.tuple([coord, z.number().min(-50).max(300), coord]);

export const SUBJECT_KINDS = ['entity', 'assembly', 'region', 'group'] as const;
export const directionSubjectSchema = z
  .strictObject({
    kind: z.enum(SUBJECT_KINDS).describe("entity = one world entity; assembly = a building / structure (scene assembly or a take's connected rack structure); region = a campus region; group = the people currently in a named action / activity"),
    ref: ref.describe('id, or words of its name/label (all words must match; an exact id always wins)'),
  })
  .describe('what the shot is about');

export const MOTION_VERBS = ['pan', 'tilt', 'dolly', 'orbit', 'crane', 'push_in', 'pull_out', 'fly_through', 'hold'] as const;
export const motionSchema = z.discriminatedUnion('verb', [
  z.strictObject({ verb: z.literal('pan'), direction: z.enum(['left', 'right']).optional(), degrees: z.number().min(1).max(160).optional() }).describe('fixed camera, view sweeps horizontally across the subject'),
  z.strictObject({ verb: z.literal('tilt'), direction: z.enum(['up', 'down']).optional(), degrees: z.number().min(1).max(120).optional() }).describe('fixed camera, view sweeps vertically over the subject'),
  z.strictObject({ verb: z.literal('dolly'), direction: z.enum(['left', 'right']).optional(), distance: z.number().min(0.5).max(200).optional() }).describe('camera tracks sideways along the subject, looking at it'),
  z.strictObject({ verb: z.literal('orbit'), degrees: z.number().min(5).max(1080), direction: z.enum(['cw', 'ccw']).optional() }).describe('revolve around the subject by an angle (cw = clockwise seen from above)'),
  z.strictObject({ verb: z.literal('crane'), direction: z.enum(['up', 'down']).optional(), rise: z.number().min(0.5).max(60).optional() }).describe('camera rises (or descends) vertically while framing the subject'),
  z.strictObject({ verb: z.literal('push_in') }).describe('move toward the subject: wide → close'),
  z.strictObject({ verb: z.literal('pull_out') }).describe('move away from the subject: close → wide'),
  z.strictObject({ verb: z.literal('fly_through'), from: vec3.describe('start position (default: the previous shot’s camera, else a computed exterior viewpoint)').optional() }).describe('route through free space (camera navmesh) to a viewpoint on the subject / interior / lookAt'),
  z.strictObject({ verb: z.literal('hold') }).describe('static framing'),
]);

export const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;
export const framingSchema = z.strictObject({
  size: z.enum(['wide', 'medium', 'close']).describe('how much of the frame the subject fills (default medium)').optional(),
  headroom: z.number().min(0).max(0.4).describe('fraction of frame height kept above the subject top').optional(),
  thirds: z.enum(['left', 'center', 'right']).describe('put the subject on this vertical third line').optional(),
  side: z.enum(COMPASS).describe('compass side the camera stands on (default: computed; sunBehind decides it)').optional(),
});

export const contextSchema = z.strictObject({
  sunBehind: z
    .union([z.boolean(), z.strictObject({ sunset: z.boolean().describe('require a low sun (≤ 12° up) — refused when the take is lit at another time').optional(), flareDeg: z.number().min(2).max(20).optional() })])
    .describe('sun in the background: camera on the far side of the subject from the sun, sun in frame but off the optical axis')
    .optional(),
  interior: ref.describe('region (room) the camera works inside: fly_through ends in it, the route enters it through an opening').optional(),
  lookAt: ref.describe('fixture / object to face (e.g. "sink"); searched inside `interior` first').optional(),
});

export const cameraDirectionSchema = z.strictObject({
  label: z.string().max(160).optional(),
  subject: directionSubjectSchema,
  motion: motionSchema,
  duration: z.number().min(0.5).max(3600).describe('seconds (default: computed from speed or the motion caps)').optional(),
  speed: z.number().positive().max(90).describe('deg/s for pan, tilt, orbit; m/s for dolly, crane, push_in, pull_out, fly_through').optional(),
  at: z.number().min(0).max(36000).describe('take seconds the shot starts (default: when the previous one ends, 0 for the first)').optional(),
  framing: framingSchema.optional(),
  context: contextSchema.optional(),
  fov: z.number().min(10).max(100).describe('vertical field of view, degrees (default 50)').optional(),
});
export type CameraDirection = z.infer<typeof cameraDirectionSchema>;
export type MotionVerb = (typeof MOTION_VERBS)[number];

// ---- semantic world -----------------------------------------------------------------------------------

export type Box = { min: Vec3; max: Vec3 };
export type NamedKind = 'entity' | 'assembly' | 'region' | 'fixture';
/** Something a direction can name. `members` = entity ids (take structures) or obstacle ids (scene things). */
export type Named = { kind: NamedKind; id: string; label: string; names: string[]; box?: Box; polygon?: [number, number][]; members?: string[]; source: 'world' | 'take-structure' | 'scene' };
/** Who is doing what at take time t (humans only): the owning action id and the activity. */
export type Facts = (t: number) => Record<string, { task: string | null; activity: string | null }>;

const STOP = new Set(['the', 'a', 'an', 'of', 'at', 'in', 'on', 'and', 'with', 'to', 'this', 'that', 'these', 'those']);
/** Lower-case name words: split on non-alphanumerics, stop words dropped, simple plural stripped. */
export function nameTokens(s: string): string[] {
  const out: string[] = [];
  for (let w of s.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!w || STOP.has(w)) continue;
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

const boxUnion = (a: Box | undefined, b: Box): Box =>
  a ? { min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])], max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])] } : { min: [...b.min], max: [...b.max] };
function obstacleBox(o: Obstacle): Box {
  const cs = obbCorners(o.obb);
  return { min: [Math.min(...cs.map((c) => c[0])), o.y0, Math.min(...cs.map((c) => c[1]))], max: [Math.max(...cs.map((c) => c[0])), o.y1, Math.max(...cs.map((c) => c[1]))] };
}
function entityBox(e: Entity): Box {
  try {
    const cs = entityCorners(e);
    return { min: [Math.min(...cs.map((c) => c[0])), Math.min(...cs.map((c) => c[1])), Math.min(...cs.map((c) => c[2]))], max: [Math.max(...cs.map((c) => c[0])), Math.max(...cs.map((c) => c[1])), Math.max(...cs.map((c) => c[2]))] };
  } catch {
    const p = e.pose.p;
    return { min: [p[0] - 0.3, p[1], p[2] - 0.3], max: [p[0] + 0.3, p[1] + 1.75, p[2] + 0.3] };
  }
}
export const boxCentre = (b: Box): Vec3 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];

export function pointInPolygon(x: number, z: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Scene obstacles may carry manifest identity (CampusObstacle): assembly + component. */
type SceneObstacle = Obstacle & { assembly?: string; component?: string };
const shortLabel = (l: string) => l.split(' · ')[0].trim();

/**
 * Index of everything a direction may name, built once per (scene, world). Deterministic: every list is in
 * sorted-id order, so matches and candidate lists come out in the same order on every host.
 */
export class SemanticWorld {
  readonly entities: Named[] = [];
  readonly assemblies: Named[] = [];
  readonly regions: Named[] = [];
  readonly fixtures: Named[] = [];
  readonly groundY: number;
  readonly world: WorldState;
  readonly facts?: Facts;

  constructor(scene: SpatialScene, world: WorldState, facts?: Facts) {
    this.world = world;
    this.facts = facts;
    this.groundY = scene.levels.find((l) => l.id === 0)?.y ?? 0;
    const ents = Object.values(world.entities).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const e of ents) {
      const names = [e.id, e.kind, ...(e.label ? [e.label] : []), ...(e.def ? [e.def] : [])];
      const n: Named = { kind: 'entity', id: e.id, label: e.label ?? `${e.def ?? e.kind} ${e.id}`, names, box: entityBox(e), source: 'world' };
      this.entities.push(n);
      if (e.kind === 'fixture') this.fixtures.push({ ...n, kind: 'fixture' });
    }
    // take structures: connected components of the connection graph (a raised + beamed bay is one structure)
    const parent = new Map<string, string>();
    const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r; };
    for (const e of ents) if (e.kind === 'component') parent.set(e.id, e.id);
    for (const e of ents) for (const c of e.connections ?? []) if (parent.has(e.id) && parent.has(c.to)) { const a = find(e.id), b = find(c.to); if (a !== b) parent.set(a < b ? b : a, a < b ? a : b); }
    const sets = new Map<string, string[]>();
    for (const id of parent.keys()) { const r = find(id); const l = sets.get(r); if (l) l.push(id); else sets.set(r, [id]); }
    for (const members of [...sets.values()].filter((m) => m.length > 1).map((m) => m.sort()).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const defs = members.map((id) => world.entities[id].def ?? '');
      const rack = defs.some((d) => d.startsWith('upright-')) && defs.some((d) => d.startsWith('beam-'));
      const base = rack ? 'rack bay' : 'structure';
      let box: Box | undefined;
      for (const id of members) box = boxUnion(box, entityBox(world.entities[id]));
      const list = members.length > 6 ? `${members.slice(0, 6).join(', ')}, …` : members.join(', ');
      this.assemblies.push({ kind: 'assembly', id: `structure:${members[0]}`, label: `${base} (${members.length} parts: ${list})`, names: [base, ...(rack ? ['pallet rack', 'rack', 'bay'] : [])], box, members, source: 'take-structure' });
    }
    // scene assemblies + fixtures (obstacles grouped by manifest assembly / component)
    const sceneRegions = ((scene as SpatialScene & { regions?: Region[] }).regions ?? []);
    const regionLabel = new Map<string, string>();
    for (const r of sceneRegions) regionLabel.set(r.id, r.label);
    for (const r of Object.values(world.regions)) regionLabel.set(r.id, r.label);
    const byAssembly = new Map<string, { box?: Box; members: string[] }>();
    const byComponent = new Map<string, { box?: Box; members: string[]; label: string; assembly?: string }>();
    for (const o of scene.obstacles as SceneObstacle[]) {
      const b = obstacleBox(o);
      if (o.assembly) {
        const a = byAssembly.get(o.assembly) ?? { members: [] };
        a.box = boxUnion(a.box, b); a.members.push(o.id);
        byAssembly.set(o.assembly, a);
      }
      const key = o.component ?? o.id;
      const c = byComponent.get(key) ?? { members: [], label: shortLabel(o.label ?? o.id), assembly: o.assembly };
      c.box = boxUnion(c.box, b); c.members.push(o.id);
      byComponent.set(key, c);
    }
    for (const id of [...byAssembly.keys()].sort()) {
      const a = byAssembly.get(id)!;
      const label = regionLabel.get(id) ?? id;
      this.assemblies.push({ kind: 'assembly', id, label, names: [label], box: a.box, members: a.members, source: 'scene' });
    }
    for (const id of [...byComponent.keys()].sort()) {
      const c = byComponent.get(id)!;
      this.fixtures.push({ kind: 'fixture', id, label: c.label, names: [c.label], box: c.box, members: c.members, source: 'scene' });
    }
    // regions: the world's (authoritative) plus scene-only ones
    const seen = new Set<string>();
    const regions = [...Object.values(world.regions), ...sceneRegions].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true))).sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const r of regions) {
      const xs = r.polygon.map((p) => p[0]), zs = r.polygon.map((p) => p[1]);
      const a = byAssembly.get(r.id);
      let top = a?.box ? a.box.max[1] : -Infinity;
      if (!a) for (const o of scene.obstacles) if (o.y1 < this.groundY + 15 && pointInPolygon(o.obb.c[0], o.obb.c[1], r.polygon)) top = Math.max(top, o.y1);
      if (!(top > this.groundY + 0.5)) top = this.groundY + 3;
      this.regions.push({ kind: 'region', id: r.id, label: r.label, names: [r.label, r.kind], polygon: r.polygon, box: { min: [Math.min(...xs), this.groundY, Math.min(...zs)], max: [Math.max(...xs), top, Math.max(...zs)] }, source: 'world' });
    }
  }
}

/** Facts over a recorded take: humans' `task` / `activity` at time t (from the take's discrete changes). */
export function takeFacts(take: Take): Facts {
  const per = new Map<string, { present: [number, unknown][]; task: [number, unknown][]; activity: [number, unknown][] }>();
  for (const [t, id, field, value] of take.changes) {
    if (field !== 'present' && field !== 'task' && field !== 'activity') continue;
    let e = per.get(id);
    if (!e) per.set(id, (e = { present: [], task: [], activity: [] }));
    e[field].push([t, value]);
  }
  const at = (l: [number, unknown][], tick: number) => { let v: unknown = null; for (const [t, x] of l) { if (t > tick) break; v = x; } return v; };
  const ids = [...per.keys()].sort();
  return (t) => {
    const tick = Math.round(t / take.dt);
    const out: Record<string, { task: string | null; activity: string | null }> = {};
    for (const id of ids) {
      const e = per.get(id)!;
      if (take.finalState.entities[id]?.kind !== 'human' || at(e.present, tick) !== true) continue;
      const task = at(e.task, tick), activity = at(e.activity, tick);
      out[id] = { task: typeof task === 'string' ? task : null, activity: typeof activity === 'string' ? activity : null };
    }
    return out;
  };
}

/** Facts over a live world (time-invariant): each human's current task / activity. */
export function worldFacts(world: WorldState): Facts {
  return () => {
    const out: Record<string, { task: string | null; activity: string | null }> = {};
    for (const e of Object.values(world.entities).sort((a, b) => (a.id < b.id ? -1 : 1))) if (e.kind === 'human') out[e.id] = { task: e.human?.task ?? null, activity: e.human?.activity ?? null };
    return out;
  };
}

// ---- resolver -----------------------------------------------------------------------------------------

/** A resolved subject. `ids` = sampler subjects scored for readability; `box` = static extent when known. */
export type ResolvedSubject = {
  kind: 'entity' | 'assembly' | 'region' | 'group' | 'fixture';
  ref: string;
  id: string;
  label: string;
  ids: string[];
  box?: Box;
  polygon?: [number, number][];
  members?: string[];
  /** Geometry follows the sampler over time (people, a moving entity), not a fixed box. */
  dynamic: boolean;
};
export type Candidate = { kind: string; id: string; label: string; at?: Vec3; members?: string[] };
export type Resolution = { ok: true; subject: ResolvedSubject } | { ok: false; diagnostic: Diagnostic };

const cand = (n: Named): Candidate => ({ kind: n.kind, id: n.id, label: n.label, ...(n.box ? { at: boxCentre(n.box).map((v) => Math.round(v * 100) / 100) as Vec3 } : {}) });

export function matchNamed(list: Named[], q: string): Named[] {
  const ql = q.trim().toLowerCase();
  const exact = list.filter((n) => n.id.toLowerCase() === ql);
  if (exact.length) return exact;
  const byLabel = list.filter((n) => n.label.toLowerCase() === ql);
  if (byLabel.length === 1) return byLabel;
  const qt = nameTokens(q);
  if (!qt.length) return [];
  return list.filter((n) => {
    const nt = new Set([n.id, ...n.names].flatMap(nameTokens));
    return qt.every((t) => nt.has(t));
  });
}

function refuseUnknown(field: string, kind: string, q: string, known: Named[]): Diagnostic {
  const list = known.slice(0, 24).map((n) => `${n.id} ('${n.label}')`);
  return {
    code: 'camera.direct.unknown',
    message: `${field}: no ${kind} named '${q}' — known: ${list.join(', ')}${known.length > 24 ? `, … (${known.length})` : ''}`,
    details: { field, kind, ref: q, known: known.slice(0, 50).map(cand) },
  };
}

function askAmbiguous(field: string, kind: string, q: string, cands: Candidate[]): Diagnostic {
  return {
    code: 'camera.direct.ambiguous',
    message: `${field}: '${q}' names ${cands.length} ${kind === 'entity' ? 'entities' : `${kind}s`} — which one? ${cands.map((c) => `${c.id} ('${c.label}')`).join(' | ')}`,
    subjects: cands.map((c) => c.id),
    details: { field, kind, ref: q, question: `Which ${kind} is '${q}'?`, candidates: cands },
  };
}

const presentIds = (sampler: ((t: number) => Record<string, unknown>) | undefined, t: number) => new Set(sampler ? Object.keys(sampler(t)) : []);

/**
 * Resolve a direction subject at take time t. `sampler` (optional) tells which ids are live subjects at t
 * (their poses then come from the take, not the final state).
 */
export function resolveSubject(sw: SemanticWorld, s: { kind: string; ref: string }, t: number, sampler?: (t: number) => Record<string, unknown>, field = 'subject'): Resolution {
  const live = presentIds(sampler, t);
  if (s.kind === 'group') {
    if (!sw.facts) return { ok: false, diagnostic: { code: 'camera.direct.no-activity-data', message: `${field}: group '${s.ref}' needs who-does-what data (a take or a live world); none was given` } };
    const facts = sw.facts(t);
    const q = s.ref.trim().toLowerCase();
    const groups = new Map<string, string[]>();
    for (const [id, f] of Object.entries(facts)) {
      const task = f.task?.toLowerCase() ?? null, act = f.activity?.toLowerCase() ?? null;
      const byTask = task !== null && (task === q || task === `step:${q}` || task.split(':').includes(q));
      if (!byTask && act !== q) continue;
      const key = f.task ?? `activity:${f.activity}`;
      const l = groups.get(key);
      if (l) l.push(id); else groups.set(key, [id]);
    }
    if (!groups.size) {
      const tasks = [...new Set(Object.values(facts).map((f) => f.task).filter((x): x is string => !!x))].sort();
      const acts = [...new Set(Object.values(facts).map((f) => f.activity).filter((x): x is string => !!x))].sort();
      return { ok: false, diagnostic: { code: 'camera.direct.unknown', message: `${field}: nobody is in '${s.ref}' at t=${t.toFixed(1)} s — actions now: ${tasks.join(', ') || 'none'}; activities: ${acts.join(', ') || 'none'}`, details: { field, kind: 'group', ref: s.ref, tasks, activities: acts } } };
    }
    const keys = [...groups.keys()].sort();
    if (keys.length > 1) return { ok: false, diagnostic: askAmbiguous(field, 'group', s.ref, keys.map((k) => ({ kind: 'group', id: k, label: `${groups.get(k)!.length} people: ${groups.get(k)!.sort().join(', ')}`, members: groups.get(k)! }))) };
    const members = groups.get(keys[0])!.sort();
    return { ok: true, subject: { kind: 'group', ref: s.ref, id: keys[0], label: `${keys[0]} (${members.join(', ')})`, ids: members, members, dynamic: true } };
  }
  const list = s.kind === 'entity' ? sw.entities : s.kind === 'assembly' ? sw.assemblies : sw.regions;
  const m = matchNamed(list, s.ref);
  if (!m.length) return { ok: false, diagnostic: refuseUnknown(field, s.kind, s.ref, list) };
  if (m.length > 1) return { ok: false, diagnostic: askAmbiguous(field, s.kind, s.ref, m.map(cand)) };
  const n = m[0];
  if (s.kind === 'entity') {
    const dyn = live.has(n.id);
    return { ok: true, subject: { kind: 'entity', ref: s.ref, id: n.id, label: n.label, ids: dyn ? [n.id] : [], ...(dyn ? {} : { box: n.box }), dynamic: dyn } };
  }
  // take structures: score the members already in place at t (within 0.25 m of their final pose); the rest are
  // still on piles or being carried
  let ids: string[] = [];
  if (n.source === 'take-structure' && sampler) {
    const now = sampler(t) as Record<string, { p: Vec3 }>;
    ids = (n.members ?? []).filter((id) => {
      const p = now[id]?.p, f = sw.world.entities[id]?.pose.p;
      return !!p && !!f && Math.abs(p[0] - f[0]) + Math.abs(p[1] - f[1]) + Math.abs(p[2] - f[2]) < 0.25;
    });
  }
  return { ok: true, subject: { kind: n.kind as ResolvedSubject['kind'], ref: s.ref, id: n.id, label: n.label, ids, box: n.box, ...(n.polygon ? { polygon: n.polygon } : {}), ...(n.members ? { members: n.members } : {}), dynamic: false } };
}

/**
 * Resolve a look-at fixture: search inside `within` (a region polygon) first, then everywhere. Matching
 * scene components that touch each other (≤ 0.3 m apart, e.g. "sink bowl" + "stainless sink rim") are one
 * physical thing; separate things are a question.
 */
export function resolveFixture(sw: SemanticWorld, q: string, within?: [number, number][], field = 'context.lookAt'): Resolution {
  const inside = (n: Named) => !within || (n.box ? pointInPolygon((n.box.min[0] + n.box.max[0]) / 2, (n.box.min[2] + n.box.max[2]) / 2, within) : false);
  let m = matchNamed(sw.fixtures.filter(inside), q);
  if (!m.length && within) m = matchNamed(sw.fixtures, q);
  if (!m.length) m = matchNamed(sw.entities, q);
  if (!m.length) return { ok: false, diagnostic: refuseUnknown(field, 'fixture', q, sw.fixtures.filter(inside).length ? sw.fixtures.filter(inside) : sw.fixtures) };
  // cluster touching boxes (union-find, deterministic order)
  const near = (a: Box, b: Box, g: number) => a.min[0] - g <= b.max[0] && b.min[0] - g <= a.max[0] && a.min[2] - g <= b.max[2] && b.min[2] - g <= a.max[2] && a.min[1] - g <= b.max[1] && b.min[1] - g <= a.max[1];
  const root = m.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) if (m[i].box && m[j].box && near(m[i].box!, m[j].box!, 0.3)) { const a = find(i), b = find(j); if (a !== b) root[Math.max(a, b)] = Math.min(a, b); }
  const clusters = new Map<number, Named[]>();
  m.forEach((n, i) => { const r = find(i); const l = clusters.get(r); if (l) l.push(n); else clusters.set(r, [n]); });
  const groups = [...clusters.values()].map((ns) => {
    let box: Box | undefined;
    for (const n of ns) if (n.box) box = boxUnion(box, n.box);
    return { id: ns[0].id, label: ns.map((n) => n.label).filter((l, i, a) => a.indexOf(l) === i).join(' + '), box, members: ns.flatMap((n) => n.members ?? [n.id]) };
  });
  if (groups.length > 1) return { ok: false, diagnostic: askAmbiguous(field, 'fixture', q, groups.map((g) => ({ kind: 'fixture', id: g.id, label: g.label, ...(g.box ? { at: boxCentre(g.box).map((v) => Math.round(v * 100) / 100) as Vec3 } : {}) }))) };
  const g = groups[0];
  return { ok: true, subject: { kind: 'fixture', ref: q, id: g.id, label: g.label, ids: [], box: g.box, members: g.members, dynamic: false } };
}

// ---- compiler -----------------------------------------------------------------------------------------

/** A direction with every name resolved and every context constraint turned into numbers. */
export type ShotIntent = {
  index: number;
  label: string;
  direction: CameraDirection;
  verb: MotionVerb;
  /** Take seconds the shot starts. */
  t0: number;
  subject: ResolvedSubject;
  interior?: ResolvedSubject;
  lookAt?: ResolvedSubject;
  sun?: SunBehindWindow;
  fov: number;
};
export type DirectContext = {
  semantic: SemanticWorld;
  /** Local datetime the take is lit at (world.env.datetime). */
  datetime: string;
  /** Take length (s); shots must end inside it. */
  duration: number;
  sampler?: (t: number) => Record<string, unknown>;
};
export type IntentResult = { ok: true; intent: ShotIntent } | { ok: false; diagnostics: Diagnostic[] };

export const SUNSET_MAX_ELEVATION = 12; // deg: "sunset" means the sun at most this high

/** Validate one direction (zod) — invalid verbs, missing fields and bad numbers come back as one diagnostic. */
export function parseDirection(input: unknown, index: number): { ok: true; direction: CameraDirection } | { ok: false; diagnostic: Diagnostic } {
  const r = cameraDirectionSchema.safeParse(input);
  if (!r.success) {
    const issues = r.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message }));
    return { ok: false, diagnostic: { code: 'camera.direct.invalid', message: `direction ${index}: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`, details: { index, issues, verbs: MOTION_VERBS } } };
  }
  if (r.data.duration !== undefined && r.data.speed !== undefined) return { ok: false, diagnostic: { code: 'camera.direct.invalid', message: `direction ${index}: give duration or speed, not both`, details: { index } } };
  return { ok: true, direction: r.data };
}

const INTERIOR_VERBS: ReadonlySet<MotionVerb> = new Set(['fly_through', 'hold', 'pan', 'tilt', 'push_in']);

/** Compile one parsed direction starting at take time t0 (names resolved at t0). */
export function compileDirection(d: CameraDirection, index: number, t0: number, ctx: DirectContext): IntentResult {
  const diags: Diagnostic[] = [];
  const where = `direction ${index}`;
  const sub = resolveSubject(ctx.semantic, d.subject, t0, ctx.sampler, `${where} subject`);
  if (!sub.ok) diags.push(sub.diagnostic);
  let interior: ResolvedSubject | undefined, lookAt: ResolvedSubject | undefined, sun: SunBehindWindow | undefined;
  const c = d.context ?? {};
  if (c.interior !== undefined) {
    const r = resolveSubject(ctx.semantic, { kind: 'region', ref: c.interior }, t0, ctx.sampler, `${where} context.interior`);
    if (r.ok) interior = r.subject; else diags.push(r.diagnostic);
    if (!INTERIOR_VERBS.has(d.motion.verb)) diags.push({ code: 'camera.direct.incompatible', message: `${where}: '${d.motion.verb}' cannot run inside a room (interior moves: ${[...INTERIOR_VERBS].join(', ')})` });
  }
  if (c.lookAt !== undefined) {
    const r = resolveFixture(ctx.semantic, c.lookAt, interior?.polygon, `${where} context.lookAt`);
    if (r.ok) lookAt = r.subject; else diags.push(r.diagnostic);
  }
  const fov = d.fov ?? DEFAULT_FOV;
  if (c.sunBehind) {
    const o = typeof c.sunBehind === 'object' ? c.sunBehind : {};
    sun = sunBehindWindow(ctx.datetime, { vfovDeg: fov, ...(o.flareDeg !== undefined ? { flareDeg: o.flareDeg } : {}) });
    const el = sun.sun.elevationDeg;
    if (!sun.aboveHorizon) diags.push({ code: 'camera.direct.sun-below-horizon', message: `${where}: the take is lit at ${ctx.datetime}, when the sun is ${el.toFixed(1)}° (below the horizon) — no sun to put behind the subject` });
    else if (o.sunset && el > SUNSET_MAX_ELEVATION) diags.push({ code: 'camera.direct.not-sunset', message: `${where}: 'sunset' needs the sun ≤ ${SUNSET_MAX_ELEVATION}° up, but the take is lit at ${ctx.datetime} (sun ${el.toFixed(1)}° up, azimuth ${sun.sun.azimuthDeg.toFixed(0)}°) — change the take's time of day or drop 'sunset'`, details: { elevationDeg: el, datetime: ctx.datetime } });
    const span = (2 * sun.cameraHeading.halfWidth * 180) / Math.PI;
    if (d.motion.verb === 'orbit' && d.motion.degrees > span) diags.push({ code: 'camera.direct.incompatible', message: `${where}: an orbit of ${d.motion.degrees}° cannot keep the sun behind the subject (the sun stays in a ${span.toFixed(0)}° window of camera headings)` });
    if (d.motion.verb === 'fly_through') diags.push({ code: 'camera.direct.incompatible', message: `${where}: sunBehind is not supported for fly_through (the route decides the headings)` });
  }
  if (t0 >= ctx.duration) diags.push({ code: 'camera.direct.beyond-take', message: `${where}: starts at ${t0.toFixed(1)} s, the take lasts ${ctx.duration.toFixed(1)} s` });
  if (diags.length || !sub.ok) return { ok: false, diagnostics: diags };
  return {
    ok: true,
    intent: { index, label: d.label ?? `${d.motion.verb} ${d.subject.kind} '${d.subject.ref}'`, direction: d, verb: d.motion.verb, t0, subject: sub.subject, ...(interior ? { interior } : {}), ...(lookAt ? { lookAt } : {}), ...(sun ? { sun } : {}), fov },
  };
}
