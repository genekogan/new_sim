// Social / inhabited-scene verbs (spec §17, milestone H). Each is a parent action that moves its
// people with child walk_to actions (arriving with `face`), then holds them in an activity
// ('sit', 'talk', 'warm', 'watch') until cancelled. People carry no loads here, so every social
// action cancels immediately and leaves its people idle where they stand.
//
// Pre-emption (spec §17 "explicit director commands take precedence"): a social action owns its
// people's `actor:<id>` reservations, so a directed task submitted for one of them fails with
// `reservation.conflict` naming the social action. There is no automatic pre-emption yet: the
// director cancels the social action first (`releaseForDirective` does exactly that per actor).
import { z } from 'zod';
import { angleDelta, clamp, dist2, dsin, heading, rot2, sub2, add2, wrapAngle, type Vec2 } from '../core/math.ts';
import type { ActionDef, ActionRecord, Diagnostic, Reservation, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity } from '../world/types.ts';
import { HUMAN_RADIUS } from '../world/catalog.ts';
import type { Spatial } from '../spatial/service.ts';
import { clearanceAt, nearestBlocker } from '../spatial/grid.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import { checkStations, childrenState, walkCrew, type Children } from '../construction/children.ts';
import { holdingDiagnostic } from '../construction/rules.ts';
import { assignNearest, isFree, slotById, whyTaken, slotResource, slotsOf, SLOT_CLEARANCE, type Slot, type SlotKind } from './slots.ts';
import { ambientWander } from './ambient.ts';

const id80 = z.string().min(1).max(80);
const xz = z.tuple([z.number().min(-500).max(500), z.number().min(-500).max(500)]);
export const ACTIVITIES = ['sit', 'watch', 'warm', 'talk', 'listen', 'idle'] as const;
const activity = z.enum(ACTIVITIES);
const DEFAULT_ACTIVITY: Record<SlotKind, (typeof ACTIVITIES)[number]> = { seat: 'sit', audience: 'watch', 'fire-circle': 'warm', stand: 'idle' };

// ---------- shared helpers ----------

export function humanOf(rt: Runtime, id: string): Entity | Diagnostic {
  const e = rt.world.entities[id];
  if (!e) return { code: 'entity.unknown', message: `no actor "${id}"`, subjects: [id] };
  if (e.kind !== 'human' || !e.human) return { code: 'actor.not-human', message: `"${id}" is a ${e.kind}, not a person`, subjects: [id] };
  return e;
}

/** Same wording as Runtime.reservationConflict, for plan-time checks of actions that hand claims to children. */
function busy(rt: Runtime, actor: string): Diagnostic | null {
  const h = rt.holder(`actor:${actor}`)[0];
  if (!h) return null;
  const rec = rt.records.get(h)!;
  return { code: 'reservation.conflict', message: `actor:${actor} is already reserved by action ${h} (${rec.verb}, ${rec.status})`, subjects: [actor], details: { resource: `actor:${actor}`, holder: h } };
}

/** Actor exists, is a person, and has free hands. */
function readyActor(rt: Runtime, id: string): Entity | Diagnostic {
  const a = humanOf(rt, id);
  if ('code' in a) return a;
  return holdingDiagnostic(rt.world, id) ?? a;
}

const pos2 = (e: Entity): Vec2 => [e.pose.p[0], e.pose.p[2]];

function setActivity(rt: Runtime, actors: string[], task: string, act: string) {
  for (const a of actors) {
    const h = rt.world.entities[a]?.human;
    if (!h) continue;
    h.task = task;
    h.activity = act;
  }
}
function idle(rt: Runtime, actors: string[], task: string) {
  for (const a of actors) {
    const h = rt.world.entities[a]?.human;
    if (h && h.task === task) { h.task = undefined; h.activity = 'idle'; }
  }
}

const turnToward = (yaw: number, want: number, max: number) => wrapAngle(yaw + clamp(angleDelta(yaw, want), -max, max));
const FACE_DONE = 0.03;

// ---------- take_slot / sit / stand ----------

type SlotParams = { actor: string; slot?: string; owner?: string; activity?: (typeof ACTIVITIES)[number] };
type SlotExec = { id: string; actor: string; slot: Slot; activity: string; phase: 'approach' | 'turn' | 'occupied'; child?: Children; error?: Diagnostic };

/** Plan-time slot choice, read back by reservations() (same params object; Runtime.submit calls plan first). */
const resolved = new WeakMap<object, Slot>();

function slotAction(verb: string, description: string, kinds: SlotKind[] | null, schema: z.ZodType<SlotParams>): ActionDef<SlotParams, Slot, SlotExec> {
  return {
    verb,
    description,
    schema,
    reservations(_w, p) {
      const s = resolved.get(p)?.id ?? p.slot;
      const out: Reservation[] = [{ resource: `actor:${p.actor}`, mode: 'exclusive' }];
      if (s) out.push({ resource: slotResource(s), mode: 'exclusive' });
      return out;
    },
    plan(rt, p) {
      const a = readyActor(rt, p.actor);
      if ('code' in a) return { ok: false, diagnostic: a };
      let slot: Slot;
      if (p.slot) {
        // an explicit slot is not checked for claims here: the runtime's reservation step names the holder
        const s = slotById(rt, p.slot);
        if ('code' in s) return { ok: false, diagnostic: s };
        slot = s;
      } else {
        const owner = p.owner!;
        const all = slotsOf(rt, owner);
        if (!Array.isArray(all)) return { ok: false, diagnostic: all };
        const ok = all.filter((s) => !kinds || kinds.includes(s.kind));
        const free = ok.filter((s) => isFree(rt.world, s, new Set([p.actor])));
        if (!free.length) {
          return { ok: false, diagnostic: { code: 'slot.none-free', message: `${p.actor} has no free ${kinds ? `${kinds.join('/')} ` : ''}slot at ${owner}: all ${ok.length} are taken (${whyTaken(rt.world, ok, new Set([p.actor]))})`, subjects: [p.actor, owner] } };
        }
        const me = pos2(a);
        slot = free.reduce((b, s) => (dist2(me, s.p) < dist2(me, b.p) - 1e-9 ? s : b));
      }
      if (kinds && !kinds.includes(slot.kind))
        return { ok: false, diagnostic: { code: 'slot.wrong-kind', message: `${slot.id} is a ${slot.kind} slot; ${verb} needs ${kinds.join('/')}`, subjects: [p.actor, slot.id] } };
      const d = checkStations(rt, [{ actor: p.actor, p: slot.p, level: slot.level }]);
      if (d) return { ok: false, diagnostic: d };
      resolved.set(p, slot);
      return { ok: true, program: slot };
    },
    start(rt, p, slot, id) {
      const a = rt.world.entities[p.actor];
      const ex: SlotExec = { id, actor: p.actor, slot, activity: p.activity ?? DEFAULT_ACTIVITY[slot.kind], phase: 'approach' };
      if (dist2(pos2(a), slot.p) < 0.05 && a.human!.level === slot.level) ex.phase = 'turn';
      else {
        const ch = walkCrew(rt, id, [{ actor: p.actor, p: slot.p, yaw: slot.yaw, level: slot.level }]);
        if ('code' in ch) ex.error = ch;
        else ex.child = ch;
      }
      a.human!.task ??= id;
      return ex;
    },
    step(rt, ex, dt): StepResult {
      if (ex.error) return { status: 'failed', diagnostic: ex.error };
      const a = rt.world.entities[ex.actor];
      if (ex.phase === 'approach') {
        const st = childrenState(ex.child!);
        if (st === 'running') return { status: 'running', phase: 'approach' };
        if (st !== 'done') return { status: 'failed', diagnostic: { ...st, message: `${ex.actor} could not reach ${ex.slot.id}: ${st.message}` } };
        ex.phase = 'turn';
      }
      if (ex.phase === 'turn') {
        a.human!.task = ex.id;
        if (Math.abs(angleDelta(a.pose.yaw, ex.slot.yaw)) > FACE_DONE) {
          a.pose.yaw = turnToward(a.pose.yaw, ex.slot.yaw, HUMAN_PROFILE.turnRate * dt);
          return { status: 'running', phase: 'turn' };
        }
        ex.phase = 'occupied';
      }
      setActivity(rt, [ex.actor], ex.id, ex.activity);
      return { status: 'running', phase: 'occupied' };
    },
    cancel(rt, ex) {
      idle(rt, [ex.actor], ex.id);
      return { ok: true };
    },
  };
}

const oneOf = <T extends Record<string, unknown>>(keys: (keyof T)[]) => (p: T) => keys.filter((k) => p[k] !== undefined).length === 1;

export const takeSlot = slotAction(
  'take_slot',
  'Walk a person to an interaction slot (explicit `slot` id "<owner>#<slot>", or the nearest free slot of fixture/region `owner`), face its heading and hold `activity` (default by slot kind: seat→sit, audience→watch, fire-circle→warm) until cancelled or `stand`. Fails slot.none-free when every slot is taken.',
  null,
  z.strictObject({ actor: id80, slot: id80.optional(), owner: id80.optional(), activity: activity.optional() }).refine(oneOf(['slot', 'owner']), 'give exactly one of slot, owner'),
);

const sitSchema = z.strictObject({ actor: id80, slot: id80.optional(), fixture: id80.optional() }).refine(oneOf(['slot', 'fixture']), 'give exactly one of slot, fixture');
const sitBase = slotAction('sit', '', ['seat'], sitSchema as unknown as z.ZodType<SlotParams>);
type SitParams = z.infer<typeof sitSchema>;
const asSlot = (p: SitParams): SlotParams => {
  let q = resolvedSit.get(p);
  if (!q) { q = { actor: p.actor, slot: p.slot, owner: p.fixture, activity: 'sit' }; resolvedSit.set(p, q); }
  return q;
};
const resolvedSit = new WeakMap<object, SlotParams>();

export const sit: ActionDef<SitParams, Slot, SlotExec> = {
  ...sitBase,
  verb: 'sit',
  description: 'Walk a person to a seat (explicit `slot` id, or the nearest free seat of `fixture`, e.g. a camp-chair or bench), turn to face the seat direction and sit until `stand { actor }` or cancel. Two people can never hold one seat (reservation.conflict / slot.none-free).',
  schema: sitSchema,
  reservations: (w, p) => sitBase.reservations(w, asSlot(p)),
  plan: (rt, p) => sitBase.plan(rt, asSlot(p)),
  start: (rt, p, prog, id) => sitBase.start(rt, asSlot(p), prog, id),
};

type StandExec = { released: string };
export const stand: ActionDef<{ actor: string }, string, StandExec> = {
  verb: 'stand',
  description: 'End a person\'s sit / take_slot: they stand up where they are and become idle. Refused (social.in-group) for a member of a converse — cancel that action instead.',
  schema: z.strictObject({ actor: id80 }),
  reservations: () => [],
  plan(rt, p) {
    const a = humanOf(rt, p.actor);
    if ('code' in a) return { ok: false, diagnostic: a };
    const hs = rt.holder(`actor:${p.actor}`).map((h) => rt.records.get(h)!);
    const seat = hs.find((r) => r.verb === 'sit' || r.verb === 'take_slot');
    if (seat) return { ok: true, program: seat.id };
    const top = hs[0];
    if (top) return { ok: false, diagnostic: { code: 'social.in-group', message: `${p.actor} is held by ${top.verb} ${top.id}, not a seat; cancel ${top.id} to release them`, subjects: [p.actor, top.id] } };
    return { ok: false, diagnostic: { code: 'social.not-seated', message: `${p.actor} is not sitting or holding a slot`, subjects: [p.actor] } };
  },
  start(rt, _p, holder) {
    rt.cancel(holder);
    return { released: holder };
  },
  step: (_rt, ex) => ({ status: 'completed', outputs: { released: ex.released } }),
  cancel: () => ({ ok: true }),
};

// ---------- face ----------

type FaceParams = { actor: string; target: { entity: string } | { point: [number, number] } };
type FaceExec = { id: string; actor: string; target: FaceParams['target'] };

function targetYaw(rt: Runtime, actor: Entity, t: FaceParams['target']): number | Diagnostic {
  let q: Vec2;
  if ('entity' in t) {
    const e = rt.world.entities[t.entity];
    if (!e) return { code: 'entity.unknown', message: `no entity "${t.entity}" to face`, subjects: [t.entity] };
    q = pos2(e);
  } else q = t.point;
  const d = sub2(q, pos2(actor));
  if (Math.hypot(d[0], d[1]) < 0.05) return { code: 'face.degenerate', message: `${actor.id} is standing on the point it was asked to face`, subjects: [actor.id] };
  return heading(d);
}

export const face: ActionDef<FaceParams, number, FaceExec> = {
  verb: 'face',
  description: 'Turn a person in place to face an entity ({ entity }) or a ground point ({ point: [x, z] }); activity idle.',
  schema: z.strictObject({ actor: id80, target: z.union([z.strictObject({ entity: id80 }), z.strictObject({ point: xz })]) }),
  reservations: (_w, p) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' }],
  plan(rt, p) {
    const a = readyActor(rt, p.actor);
    if ('code' in a) return { ok: false, diagnostic: a };
    const y = targetYaw(rt, a, p.target);
    return typeof y === 'number' ? { ok: true, program: y } : { ok: false, diagnostic: y };
  },
  start(rt, p, _y, id) {
    rt.world.entities[p.actor].human!.task = id;
    return { id, actor: p.actor, target: p.target };
  },
  step(rt, ex, dt) {
    const a = rt.world.entities[ex.actor];
    const y = targetYaw(rt, a, ex.target);
    if (typeof y !== 'number') return { status: 'failed', diagnostic: y };
    a.human!.activity = 'idle';
    if (Math.abs(angleDelta(a.pose.yaw, y)) > FACE_DONE) {
      a.pose.yaw = turnToward(a.pose.yaw, y, HUMAN_PROFILE.turnRate * dt);
      return { status: 'running', phase: 'turn' };
    }
    idle(rt, [ex.actor], ex.id);
    return { status: 'completed', outputs: { yaw: a.pose.yaw } };
  },
  cancel(rt, ex) {
    idle(rt, [ex.actor], ex.id);
    return { ok: true };
  },
};

// ---------- converse ----------

type ConverseParams = { actors: string[]; at?: [number, number]; duration?: number };
type Circle = { centre: Vec2; r: number; moves: { actor: string; p: Vec2; yaw: number; level: number }[] };
type ConverseExec = { id: string; actors: string[]; phase: 'gathering' | 'talking'; child?: Children; error?: Diagnostic; t: number; duration?: number; circle: Circle };

/** Circle radius: at least 0.8 m between neighbours, within 0.6–1.0 m. */
export const circleRadius = (n: number) => clamp(0.4 / dsin(Math.PI / n), 0.6, 1.0);

/** Actors keep their angular order around the centre (no crossing paths); the phase minimises total walking. */
function circleFor(rt: Runtime, centre: Vec2, actors: Entity[]): Circle {
  const n = actors.length, r = circleRadius(n), step = (2 * Math.PI) / n;
  const order = actors
    .map((a, i) => ({ a, i, ang: dist2(pos2(a), centre) > 1e-6 ? heading(sub2(pos2(a), centre)) : (i * step) - Math.PI }))
    .sort((x, y) => x.ang - y.ang || x.i - y.i);
  let best: Circle['moves'] = [], bestCost = Infinity;
  for (let k = 0; k < 24; k++) {
    const t0 = order[0].ang + (k * step) / 24 - step / 2;
    const moves = order.map((o, j) => {
      const p = add2(centre, rot2([r, 0], t0 + j * step));
      return { actor: o.a.id, p, yaw: heading(sub2(centre, p)), level: o.a.human!.level };
    });
    const cost = moves.reduce((s, m, j) => s + dist2(m.p, pos2(order[j].a)) ** 2, 0);
    if (cost < bestCost - 1e-12) { bestCost = cost; best = moves; }
  }
  best.sort((x, y) => actors.findIndex((a) => a.id === x.actor) - actors.findIndex((a) => a.id === y.actor));
  return { centre, r, moves: best };
}

/** Why a circle does not fit on free ground, or null. */
function circleFit(rt: Runtime, c: Circle, members: Set<string>): Diagnostic | null {
  const sp = rt.services.spatial as Spatial;
  sp.sync(rt.world);
  for (const m of c.moves) {
    const g = sp.level(m.level);
    const cl = g ? clearanceAt(g, m.p) : 0;
    if (cl < SLOT_CLEARANCE) {
      const what = (g && nearestBlocker(g, m.p)) ?? 'the edge of walkable ground';
      return { code: 'converse.clearance', message: `a ${c.moves.length}-person circle (r ${c.r.toFixed(2)} m) around (${c.centre[0].toFixed(2)}, ${c.centre[1].toFixed(2)}) does not fit: ${m.actor}'s place at (${m.p[0].toFixed(2)}, ${m.p[1].toFixed(2)}) is ${cl.toFixed(2)} m from ${what}`, subjects: [m.actor, what], at: [m.p[0], 0, m.p[1]] };
    }
    for (const o of Object.values(rt.world.entities))
      if (o.kind === 'human' && o.human && !members.has(o.id) && o.human.level === m.level && dist2(pos2(o), m.p) < 2 * HUMAN_RADIUS + 0.1)
        return { code: 'converse.clearance', message: `a ${c.moves.length}-person circle around (${c.centre[0].toFixed(2)}, ${c.centre[1].toFixed(2)}) does not fit: ${o.id} is standing at ${m.actor}'s place (${m.p[0].toFixed(2)}, ${m.p[1].toFixed(2)})`, subjects: [m.actor, o.id], at: [m.p[0], 0, m.p[1]] };
  }
  return null;
}

export const converse: ActionDef<ConverseParams, Circle, ConverseExec> = {
  verb: 'converse',
  description: 'Gather 2–6 people into a conversation circle (radius 0.6–1.0 m) around `at` or, if omitted, the nearest free ground to their centroid; each faces the centre and talks until cancelled (or for `duration` s). Refused if someone is holding something (actor.holding) or the circle does not fit (converse.clearance).',
  schema: z.strictObject({ actors: z.array(id80).min(2).max(6), at: xz.optional(), duration: z.number().positive().max(3600).optional() }),
  reservations: (_w, p) => p.actors.map((a) => ({ resource: `actor:${a}`, mode: 'exclusive' as const })),
  plan(rt, p) {
    if (new Set(p.actors).size !== p.actors.length) return { ok: false, diagnostic: { code: 'action.invalid-params', message: `converse lists an actor twice: ${p.actors.join(', ')}`, subjects: p.actors } };
    const es: Entity[] = [];
    for (const id of p.actors) {
      const a = readyActor(rt, id);
      if ('code' in a) return { ok: false, diagnostic: a };
      if (es.length && a.human!.level !== es[0].human!.level)
        return { ok: false, diagnostic: { code: 'converse.levels', message: `${id} is on level ${a.human!.level} but ${es[0].id} is on level ${es[0].human!.level}`, subjects: [id, es[0].id] } };
      es.push(a);
    }
    const members = new Set(p.actors);
    const c0: Vec2 = p.at ?? [es.reduce((s, e) => s + e.pose.p[0], 0) / es.length, es.reduce((s, e) => s + e.pose.p[2], 0) / es.length];
    // explicit `at`: exactly there. Otherwise the centroid, then rings of candidates out to 3 m.
    const cands: Vec2[] = [c0];
    if (!p.at) for (const d of [0.5, 1, 1.5, 2, 2.5, 3]) for (let k = 0; k < 8; k++) cands.push(add2(c0, rot2([d, 0], (k * Math.PI) / 4)));
    let first: Diagnostic | null = null;
    for (const c of cands) {
      const circle = circleFor(rt, c, es);
      const bad = circleFit(rt, circle, members);
      if (bad) { first ??= bad; continue; }
      const d = checkStations(rt, circle.moves);
      if (d) { first ??= d; continue; }
      return { ok: true, program: circle };
    }
    return { ok: false, diagnostic: first! };
  },
  start(rt, p, circle, id) {
    const ex: ConverseExec = { id, actors: p.actors, phase: 'gathering', t: 0, duration: p.duration, circle };
    const ch = walkCrew(rt, id, circle.moves);
    if ('code' in ch) ex.error = ch;
    else ex.child = ch;
    return ex;
  },
  step(rt, ex, dt) {
    if (ex.error) return { status: 'failed', diagnostic: ex.error };
    if (ex.phase === 'gathering') {
      const st = childrenState(ex.child!);
      if (st === 'running') return { status: 'running', phase: 'gathering' };
      if (st !== 'done') return { status: 'failed', diagnostic: { ...st, message: `the conversation circle could not form: ${st.message}` } };
      ex.phase = 'talking';
    }
    setActivity(rt, ex.actors, ex.id, 'talk');
    ex.t += dt;
    if (ex.duration !== undefined && ex.t >= ex.duration - 1e-9) {
      idle(rt, ex.actors, ex.id);
      return { status: 'completed', outputs: { centre: ex.circle.centre, r: ex.circle.r, talked: ex.t } };
    }
    return { status: 'running', phase: 'talking' };
  },
  cancel(rt, ex) {
    idle(rt, ex.actors, ex.id);
    return { ok: true };
  },
};

// ---------- gather / campfire_circle ----------

type GatherParams = { actors: string[]; region?: string; fixture?: string; activity?: (typeof ACTIVITIES)[number] };
type GatherProgram = { owner: string; pairs: { actor: string; slot: string }[]; left: string[]; activity?: string };
type GatherExec = { id: string; owner: string; kids: ActionRecord[] };

function planGather(rt: Runtime, p: GatherParams, kinds: SlotKind[] | null): { ok: true; program: GatherProgram } | { ok: false; diagnostic: Diagnostic } {
  const owner = (p.fixture ?? p.region)!;
  if (new Set(p.actors).size !== p.actors.length) return { ok: false, diagnostic: { code: 'action.invalid-params', message: `the actor list names someone twice: ${p.actors.join(', ')}`, subjects: p.actors } };
  for (const id of p.actors) {
    const a = readyActor(rt, id);
    if ('code' in a) return { ok: false, diagnostic: a };
    const b = busy(rt, id);
    if (b) return { ok: false, diagnostic: b };
  }
  const all = slotsOf(rt, owner);
  if (!Array.isArray(all)) return { ok: false, diagnostic: all };
  const members = new Set(p.actors);
  const free = all.filter((s) => (!kinds || kinds.includes(s.kind)) && isFree(rt.world, s, members));
  const { pairs, left } = assignNearest(rt.world, p.actors, free);
  if (!pairs.length) return { ok: false, diagnostic: { code: 'slot.none-free', message: `no free slot at ${owner} for ${p.actors.join(', ')} (all ${all.length} taken)`, subjects: [owner, ...p.actors] } };
  return { ok: true, program: { owner, pairs: pairs.map((q) => ({ actor: q.actor, slot: q.slot.id })), left, activity: p.activity } };
}

/**
 * Each assigned person gets a child take_slot (which holds their actor + slot claims). People left
 * over also get one, against the owner: it fails `slot.none-free` naming the fixture/region, so
 * the director sees exactly who found no place. The gather ends when all its children have.
 */
function startGather(rt: Runtime, prog: GatherProgram, id: string): GatherExec {
  const kids: ActionRecord[] = [];
  for (const q of prog.pairs) kids.push(rt.submit('take_slot', { actor: q.actor, slot: q.slot, activity: prog.activity }, { parent: id }));
  for (const a of prog.left) kids.push(rt.submit('take_slot', { actor: a, owner: prog.owner, activity: prog.activity }, { parent: id }));
  return { id, owner: prog.owner, kids };
}

function stepGather(_rt: Runtime, ex: GatherExec): StepResult {
  const live = ex.kids.filter((k) => k.status !== 'completed' && k.status !== 'failed' && k.status !== 'cancelled');
  if (!live.length)
    return {
      status: 'completed',
      outputs: {
        seated: ex.kids.filter((k) => k.history.some((h) => h.phase === 'occupied')).map((k) => (k.params as SlotParams).actor),
        unseated: ex.kids.filter((k) => k.status === 'failed').map((k) => ({ actor: (k.params as SlotParams).actor, code: k.diagnostic?.code, message: k.diagnostic?.message })),
      },
    };
  return { status: 'running', phase: live.some((k) => k.phase !== 'occupied') ? 'gathering' : 'gathered' };
}

const actorsSchema = z.array(id80).min(1).max(40);

export const gather: ActionDef<GatherParams, GatherProgram, GatherExec> = {
  verb: 'gather',
  description: 'Send people to free slots of a fixture (bench, campfire) or a place region with an audience layout; deterministic nearest-first assignment. Each person holds their slot (child take_slot) until cancelled or `stand`; people left without a slot fail slot.none-free naming the fixture/region.',
  schema: z.strictObject({ actors: actorsSchema, region: id80.optional(), fixture: id80.optional(), activity: activity.optional() }).refine(oneOf(['region', 'fixture']), 'give exactly one of region, fixture'),
  reservations: () => [], // claims are held by the child take_slot actions
  plan: (rt, p) => planGather(rt, p, null),
  start: (rt, _p, prog, id) => startGather(rt, prog, id),
  step: stepGather,
  cancel: () => ({ ok: true }), // the runtime cancels live children (take_slot → people idle in place)
};

export const campfireCircle: ActionDef<{ actors: string[]; fire: string }, GatherProgram, GatherExec> = {
  verb: 'campfire_circle',
  description: 'Gather people around a campfire fixture: each takes a free fire-circle place (1.6 m from the fire, facing it) and warms themselves until cancelled; extra people fail slot.none-free naming the fire.',
  schema: z.strictObject({ actors: actorsSchema, fire: id80 }),
  reservations: () => [],
  plan(rt, p) {
    const f = rt.world.entities[p.fire];
    const all = f ? slotsOf(rt, p.fire) : null;
    if (!f || !Array.isArray(all) || !all.some((s) => s.kind === 'fire-circle'))
      return { ok: false, diagnostic: { code: 'campfire.not-a-fire', message: f ? `${p.fire} (${f.def}) has no fire-circle places` : `no campfire "${p.fire}"`, subjects: [p.fire] } };
    return planGather(rt, { actors: p.actors, fixture: p.fire, activity: 'warm' }, ['fire-circle']);
  },
  start: (rt, _p, prog, id) => startGather(rt, prog, id),
  step: stepGather,
  cancel: () => ({ ok: true }),
};

// ---------- pre-emption helpers (director side) ----------

export const SOCIAL_VERBS: ReadonlySet<string> = new Set(['sit', 'take_slot', 'stand', 'face', 'converse', 'gather', 'campfire_circle', 'ambient_wander']);

/** The social action that currently owns `actor` (nearest social ancestor of an `actor:` holder), if any. */
export function socialHolder(rt: Runtime, actor: string): ActionRecord | undefined {
  for (const h of rt.holder(`actor:${actor}`)) {
    for (let r = rt.records.get(h); r; r = r.parent ? rt.records.get(r.parent) : undefined) if (SOCIAL_VERBS.has(r.verb)) return r;
  }
  return undefined;
}

/**
 * Free `actor` for a directed task (spec §17). Cancels the smallest social unit holding them: their
 * own sit/take_slot (other gather members stay), their current ambient walk (ambient_wander then
 * releases them for good), or the whole converse / face. Never touches non-social holders (a carry
 * or raise must be finished or cancelled by the director on its own terms). Returns cancelled ids.
 */
export function releaseForDirective(rt: Runtime, actor: string): string[] {
  const out: string[] = [];
  for (const h of rt.holder(`actor:${actor}`)) {
    const rec = rt.records.get(h)!;
    const parent = rec.parent ? rt.records.get(rec.parent) : undefined;
    const target = rec.verb === 'walk_to' && parent?.verb === 'ambient_wander' ? rec : socialHolder(rt, actor);
    if (!target || !rt.isActive(target.id) || out.includes(target.id)) continue;
    rt.cancel(target.id);
    out.push(target.id);
  }
  return out;
}

export const SOCIAL_ACTIONS: ActionDef[] = [sit, takeSlot, stand, face, converse, gather, campfireCircle, ambientWander];
