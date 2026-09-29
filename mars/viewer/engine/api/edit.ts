// Design edits (spec §21 "design-edit" cause): the one way a director changes world content
// without simulating it — spawn catalog items, move idle people / loose components / fixtures,
// remove loose components, add or replace regions. Edits apply in order to a private copy and
// are all-or-nothing; every placement gets the same exact footprint tests the carry verb's
// set-down uses (static obstacles and components at any height the item occupies, the level's
// floor, people), so an edit can never leave something inside a wall or a person.
// Pure w.r.t. history: the controller commits the result (engine_edit_world).
import type { z } from 'zod';
import { obbCorners, obbOverlap, pointInObb, type Vec2, hypot } from '../core/math.ts';
import { orientationFor, poseAt } from '../carry/formation.ts';
import { canonicalEntityOrder } from '../runtime/runtime.ts';
import { clearanceAt, nearestBlocker } from '../spatial/grid.ts';
import { entityFootprint, type Spatial } from '../spatial/service.ts';
import { CATALOG, HUMAN_RADIUS } from '../world/catalog.ts';
import { component, human } from '../world/factory.ts';
import type { Entity, Pose, Provenance, Region, WorldState } from '../world/types.ts';
import type { worldEditSchema } from './schemas.ts';
import { editStatic } from './edit-static.ts';

export type WorldEdit = z.infer<typeof worldEditSchema>;
export type EditRefusal = { ok: false; code: string; message: string; details: { index: number; edit: WorldEdit; subjects?: string[] } };
export type EditResult = { ok: true; world: WorldState; applied: string[] } | EditRefusal;

const COMPONENTS = new Set(['rack-upright', 'rack-beam', 'timber', 'plywood', 'stair']);
/** Phases in which a component is part of a structure or in someone's hands. */
const FIXED = new Set(['reserved', 'carried', 'raising', 'placed', 'installed']);
/** A person standing on a level blocks this height band above their feet. */
const PERSON_H = 1.9;
/** How far an item's underside may sit from its level's floor. */
const FLOOR_TOL = 0.05;

const f2 = (x: number) => x.toFixed(2);
const at = (p: Vec2) => `(${f2(p[0])}, ${f2(p[1])})`;

export function applyEdits(start: WorldState, edits: WorldEdit[], spatialFor: (w: WorldState) => Spatial, note?: string): EditResult {
  const w = structuredClone(start);
  const provenance: Provenance = { origin: 'design-edit', confidence: 'hypothetical', ...(note ? { note } : {}) };
  const applied: string[] = [];
  let sp: Spatial | null = null;
  const spatial = () => {
    if (!sp) (sp = spatialFor(w)).sync(w);
    return sp;
  };
  for (let index = 0; index < edits.length; index++) {
    const edit = edits[index];
    const refuse = (code: string, message: string, subjects?: string[]): EditRefusal => ({ ok: false, code, message: `edit ${index} (${edit.op} ${edit.id}): ${message}`, details: { index, edit, ...(subjects?.length ? { subjects } : {}) } });
    if (edit.op === 'static_add' || edit.op === 'static_update' || edit.op === 'static_remove') {
      const issue = editStatic(w, spatial(), edit);
      if (issue) return refuse(issue.code, issue.message, issue.subjects);
      sp = null;
      applied.push(`${edit.op} ${edit.id}`);
      continue;
    }
    if (edit.op === 'region') {
      const region: Region & { layout?: unknown } = {
        id: edit.id,
        label: edit.label ?? edit.id,
        kind: edit.kind,
        polygon: edit.polygon.map((p) => [p[0], p[1]] as [number, number]),
        ...(edit.level !== undefined ? { level: edit.level } : {}),
        ...(edit.layout ? { layout: edit.layout } : {}),
        provenance,
      };
      w.regions[edit.id] = region;
      applied.push(`region ${edit.id} (${edit.kind}, ${edit.polygon.length} corners)`);
      continue;
    }
    if (edit.op === 'remove') {
      const e = w.entities[edit.id];
      if (!e) return refuse('entity.unknown', `no entity "${edit.id}"`, [edit.id]);
      const rider = riderOf(w, e);
      if (rider) return refuse('edit.vehicle-ridden', `${e.id} is ridden by ${rider}; dismount first`, [e.id, rider]);
      const why = removeIssue(w, e);
      if (why) return refuse('edit.immovable', why, [edit.id]);
      delete w.entities[edit.id];
      applied.push(`removed ${edit.id} (${e.def})`);
      continue;
    }
    if ((edit.pose ? 1 : 0) + (edit.lying ? 1 : 0) !== 1) return refuse('edit.invalid', 'give exactly one of pose, lying');
    let e: Entity;
    let level: number;
    let s: Spatial;
    if (edit.op === 'spawn') {
      if (w.inventory !== 'unlimited')
        return refuse('edit.inventory-finite', `workspace inventory is finite, so nothing can be spawned; fork with inventory: 'unlimited' (engine_fork) to design with catalog stock`);
      if (w.entities[edit.id]) return refuse('edit.id-taken', `an entity "${edit.id}" already exists`, [edit.id]);
      const d = CATALOG[edit.def];
      if (!d) return refuse('edit.unknown-def', `no catalog def "${edit.def}" (see the def list in the tool schema)`);
      const isComponent = COMPONENTS.has(d.category);
      if (!isComponent && d.category !== 'fixture' && d.category !== 'human') return refuse('edit.not-spawnable', `${edit.def} is a ${d.category}; only components, fixtures and people can be spawned`);
      if (edit.phase && !isComponent) return refuse('edit.invalid', `phase applies to components only; ${edit.def} is a ${d.category}`);
      s = spatial();
      level = edit.level ?? 0;
      const y = levelY(s, level);
      if (y === undefined) return refuse('route.unknown-level', `level ${level} does not exist`);
      const pose = edit.lying ? lyingPose(edit.def, edit.lying, y) : edit.pose!;
      if (typeof pose === 'string') return refuse('edit.invalid', pose);
      if (d.category === 'human') e = human(edit.id, pose.p[0], pose.p[2], { level, y, yaw: pose.yaw, label: edit.label, provenance });
      else if (isComponent) e = component(edit.id, edit.def, [...pose.p], pose.yaw, { pose: { ...pose, p: [...pose.p] }, phase: edit.phase ?? (edit.lying ? 'staged' : 'stored'), provenance, ...(edit.label ? { label: edit.label } : {}) });
      else e = { id: edit.id, def: edit.def, kind: 'fixture', pose: { ...pose, p: [...pose.p] }, provenance, ...(edit.label ? { label: edit.label } : {}) };
    } else {
      const cur = w.entities[edit.id];
      if (!cur) return refuse('entity.unknown', `no entity "${edit.id}"`, [edit.id]);
      const rider = riderOf(w, cur);
      if (rider) return refuse('edit.vehicle-ridden', `${cur.id} is ridden by ${rider}; dismount first (a design edit only moves a parked vehicle)`, [cur.id, rider]);
      const why = moveIssue(w, cur);
      if (why) return refuse('edit.immovable', why, [edit.id]);
      s = spatial();
      level = edit.level ?? currentLevel(s, cur);
      const y = levelY(s, level);
      if (y === undefined) return refuse('route.unknown-level', `level ${level} does not exist`);
      const pose = edit.lying ? lyingPose(cur.def, edit.lying, y) : edit.pose!;
      if (typeof pose === 'string') return refuse('edit.invalid', pose);
      e = structuredClone(cur);
      e.pose = cur.kind === 'human' ? { p: [pose.p[0], y, pose.p[2]], yaw: pose.yaw } : { ...pose, p: [...pose.p] };
      if (e.human) e.human.level = level;
    }
    const others = { ...w, entities: { ...w.entities } };
    delete others.entities[e.id];
    const clash = placementIssue(s, others, e, level);
    if (clash) return refuse(clash.code, clash.reason, [e.id, ...clash.subjects]);
    w.entities[e.id] = e;
    const c = e.kind === 'human' ? ([e.pose.p[0], e.pose.p[2]] as Vec2) : entityFootprint(e).obb.c;
    applied.push(`${edit.op === 'spawn' ? 'spawned' : 'moved'} ${e.id} (${e.def}) centred at ${at(c)} yaw ${f2(e.pose.yaw)}, level ${level}`);
  }
  canonicalEntityOrder(w);
  return { ok: true, world: w, applied };
}

function levelY(sp: Spatial, level: number): number | undefined {
  return sp.scene.levels.find((l) => l.id === level)?.y;
}

function currentLevel(sp: Spatial, e: Entity): number {
  if (e.human) return e.human.level;
  const y0 = entityFootprint(e).y0;
  let best = 0, bd = Infinity;
  for (const l of sp.scene.levels)
    if (Math.abs(l.y - y0) < bd) {
      bd = Math.abs(l.y - y0);
      best = l.id;
    }
  return best;
}

/** Flat set-down pose of a carriable component (the carry verb's lay orientation), or why not. */
function lyingPose(defId: string, l: { x: number; z: number; yaw: number }, y: number): Pose | string {
  const d = CATALOG[defId];
  if (!d?.handling || !COMPONENTS.has(d.category)) return `\`lying\` applies to carriable components; ${defId} is ${d ? `a ${d.category}` : 'unknown'} — give a pose`;
  return poseAt(defId, orientationFor(d, 'flat'), { x: l.x, z: l.z, th: l.yaw }, { bottom: y });
}

/** The person riding a vehicle (support ridden-by, or a human whose `riding` names it), if any. */
function riderOf(w: WorldState, e: Entity): string | undefined {
  if (e.kind !== 'vehicle') return undefined;
  if (e.support?.kind === 'ridden-by') return e.support.by;
  return Object.values(w.entities).find((o) => o.human?.riding === e.id)?.id;
}

/** Resting-on/connected dependants that would be left floating if `e` moved. */
function dependants(w: WorldState, id: string): string[] {
  const out: string[] = [];
  for (const o of Object.values(w.entities)) {
    if (o.id === id) continue;
    const s = o.support;
    if ((s?.kind === 'resting-on' && s.on === id) || (s?.kind === 'connected' && s.to.includes(id)) || o.connections?.some((c) => c.to === id)) out.push(o.id);
  }
  return out;
}

function moveIssue(w: WorldState, e: Entity): string | null {
  if (e.reservedBy) return `${e.id} is reserved by action ${e.reservedBy}`;
  if (e.kind === 'human') {
    const h = e.human!;
    if (h.task || h.activity !== 'idle' || h.grip) return `${e.id} is busy (${h.activity}${h.task ? `, task ${h.task}` : ''}); only idle people can be moved by a design edit`;
    return null;
  }
  if (e.kind === 'marker') return `${e.id} is a marker; design edits move people, components, fixtures and parked vehicles`;
  if (e.kind === 'vehicle') {
    // a parked vehicle is a static obstacle (LM-005): movable unless something is on its forks
    const load = Object.values(w.entities).find((o) => o.support?.kind === 'forks' && o.support.vehicle === e.id);
    if (load) return `${e.id} has ${load.id} on its forks; set the load down first`;
  }
  if (e.phase && FIXED.has(e.phase)) return `${e.id} is ${e.phase}; only loose (stored/staged) components can be moved`;
  const s = e.support?.kind;
  if (s === 'held' || s === 'connected' || s === 'forks') return `${e.id} is ${s === 'held' ? 'held' : s === 'forks' ? 'on forks' : 'connected'}; only loose items can be moved`;
  if (e.connections?.length) return `${e.id} is connected to ${e.connections.map((c) => c.to).join(', ')}`;
  const dep = dependants(w, e.id);
  if (dep.length) return `${dep.join(', ')} ${dep.length > 1 ? 'rest' : 'rests'} on ${e.id}; move ${dep.length > 1 ? 'them' : 'it'} first`;
  return null;
}

function removeIssue(w: WorldState, e: Entity): string | null {
  const spawned = e.provenance.origin === 'design-edit';
  if (e.kind === 'component') {
    if (e.phase !== 'stored' && e.phase !== 'staged' && !spawned) return `${e.id} is ${e.phase ?? 'in use'}; only stored/staged components (or items a design edit spawned) can be removed`;
    return moveIssue(w, e);
  }
  if (!spawned) return `${e.id} is a ${e.kind} of this scene (provenance ${e.provenance.origin}); only stored/staged components and items a design edit spawned can be removed`;
  return moveIssue(w, e);
}

/** Why `e` cannot stand/lie at its pose on `level` in `w` (which must not contain `e`), or null. */
export function placementIssue(sp: Spatial, w: WorldState, e: Entity, level: number): { code: string; reason: string; subjects: string[] } | null {
  sp.sync(w);
  const y = levelY(sp, level)!;
  const floors = sp.scene.surfaces.filter((s) => s.level === level);
  const people = Object.values(w.entities).filter((o) => o.kind === 'human' && o.human && o.human.level === level);
  if (e.kind === 'human') {
    const p: Vec2 = [e.pose.p[0], e.pose.p[2]];
    if (!floors.some((s) => pointInObb(p, s.obb, 1e-6))) return { code: 'edit.off-floor', reason: `${at(p)} is off the floor of level ${level}`, subjects: [] };
    const g = sp.level(level);
    if (g && clearanceAt(g, p) < HUMAN_RADIUS - 0.02) {
      const b = nearestBlocker(g, p, 1.0);
      const lab = b ? sp.scene.obstacles.find((o) => o.id === b)?.label ?? b : undefined;
      return { code: 'edit.blocked', reason: `a person at ${at(p)} would be inside ${lab ? `'${lab}'` : 'the edge of the floor'}`, subjects: b ? [b] : [] };
    }
    for (const o of people)
      if (hypot(o.pose.p[0] - p[0], o.pose.p[2] - p[1]) < 2 * HUMAN_RADIUS) return { code: 'edit.blocked', reason: `a person at ${at(p)} would overlap ${o.id}`, subjects: [o.id] };
    return null;
  }
  const fp = entityFootprint(e);
  if (Math.abs(fp.y0 - y) > FLOOR_TOL)
    return { code: 'edit.unsupported', reason: `its underside would be at y ${f2(fp.y0)} m but level ${level}'s floor is at ${f2(y)} m (lay it on the floor: \`lying\`, or a pose with p[1] on the floor)`, subjects: [] };
  for (const o of sp.scene.obstacles) {
    if (o.y1 <= fp.y0 + 1e-3 || o.y0 >= fp.y1 - 1e-3) continue;
    if (obbOverlap(fp.obb, o.obb)) return { code: 'edit.blocked', reason: `its footprint would overlap '${o.label ?? o.id}'`, subjects: [o.id] };
  }
  for (const c of obbCorners(fp.obb))
    if (!floors.some((s) => pointInObb(c, s.obb, 1e-6))) return { code: 'edit.off-floor', reason: `its footprint would leave the floor of level ${level} at ${at(c)}`, subjects: [] };
  for (const o of people)
    if (fp.y0 < o.pose.p[1] + PERSON_H && pointInObb([o.pose.p[0], o.pose.p[2]], fp.obb, HUMAN_RADIUS)) return { code: 'edit.blocked', reason: `its footprint would overlap ${o.id}, who is standing at ${at([o.pose.p[0], o.pose.p[2]])}`, subjects: [o.id] };
  return null;
}
