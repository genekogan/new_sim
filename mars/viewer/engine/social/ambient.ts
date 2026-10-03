// Ambient autonomy (spec §17): background life that never competes with directed work.
// ambient_wander reserves nothing. Each tick it looks at its people in list order and, for anyone
// idle and unclaimed whose pause has run out, submits a child walk_to to a random standable point
// of the region (world.rng only: deterministic, checkpointed with the world), then pauses them
// 2–8 s. It never touches a person with another task, and the moment anything else reserves one of
// its people (or cancels their ambient walk) it yields; a recorded successful directive can later re-adopt an eligible person.
import { z } from 'zod';
import { dist2, type Vec2 } from '../core/math.ts';
import { hashOf } from '../core/hash.ts';
import { nextRandom } from '../core/rng.ts';
import type { ActionDef, ActionRecord } from '../actions/types.ts';
import { DT, type Runtime } from '../runtime/runtime.ts';
import { HUMAN_RADIUS } from '../world/catalog.ts';
import type { Spatial } from '../spatial/service.ts';
import { clearanceAt } from '../spatial/grid.ts';
import { holdingDiagnostic } from '../construction/rules.ts';
import { pointInPolygon } from './slots.ts';

export const WANDER_PAUSE: [number, number] = [2, 8]; // s between walks
const WANDER_SPEED = 0.9; // m/s: an amble, not a commute
const DRAWS_PER_TRY = 12;
const TARGET_CLEARANCE = HUMAN_RADIUS + 0.25;
const TARGET_SPACING = 1.2; // m from other people and other wanderers' targets

type WanderReturn = { directive: string; region: string; regionHash: string };
type Who = { returnPending?: true; resume?: WanderReturn; actor: string; until: number; child?: ActionRecord; released?: string };
type WanderParams = { actors: string[]; region: string; seed?: number; duration?: number };
type WanderExec = {
  id: string;
  poly: [number, number][];
  bbox: [number, number, number, number];
  level: number;
  salt: number;
  endTick?: number;
  who: Who[];
  walks: { actor: string; target: Vec2; tick: number; id: string }[];
};

/** make-way nudges (walk.ts makeWay) are transient courtesy steps, not a new owner. */
const isNudge = (rt: Runtime, h: string) => rt.records.get(h)?.verb === 'walk_to' && h.includes(':make-way:');

function draw(rt: Runtime, ex: WanderExec) {
  const u = nextRandom(rt.world.rng) + ex.salt;
  return u >= 1 ? u - 1 : u;
}

function pickTarget(rt: Runtime, ex: WanderExec, me: string): Vec2 | null {
  const sp = rt.services.spatial as Spatial;
  sp.sync(rt.world);
  const g = sp.level(ex.level);
  if (!g) return null;
  const [x0, z0, x1, z1] = ex.bbox;
  const taken: Vec2[] = [];
  for (const e of Object.values(rt.world.entities)) if (e.id !== me && e.kind === 'human' && e.human?.level === ex.level) taken.push([e.pose.p[0], e.pose.p[2]]);
  for (const w of ex.who) if (w.child && w.actor !== me && rt.isActive(w.child.id)) { const q = w.child.params as { x: number; z: number }; taken.push([q.x, q.z]); }
  for (let k = 0; k < DRAWS_PER_TRY; k++) {
    const p: Vec2 = [x0 + (x1 - x0) * draw(rt, ex), z0 + (z1 - z0) * draw(rt, ex)];
    if (!pointInPolygon(p, ex.poly) || clearanceAt(g, p) < TARGET_CLEARANCE) continue;
    if (taken.some((q) => dist2(p, q) < TARGET_SPACING)) continue;
    return [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000];
  }
  return null;
}

const pauseTicks = (rt: Runtime, ex: WanderExec) => Math.round((WANDER_PAUSE[0] + (WANDER_PAUSE[1] - WANDER_PAUSE[0]) * draw(rt, ex)) / DT);

function skipReturn(rt: Runtime, ex: WanderExec, w: Who, reason: string) {
  rt.mark('ambient.return-skipped', { ambient: ex.id, actor: w.actor, directive: w.resume?.directive, reason });
  delete w.resume;
  delete w.returnPending;
  w.released = reason;
}

export const ambientWander: ActionDef<WanderParams, WanderExec['poly'], WanderExec> = {
  verb: 'ambient_wander',
  resumable: true,
  description:
    'Background autonomy: idle people in `actors` stroll to random standable points of `region`, pausing 2–8 s between walks (deterministic from world.rng; `seed` varies the pattern). Reserves nothing: a person with another task is never touched, and a directed participant may rejoin after successful completion if no newer work intervenes. Runs until cancelled (or `duration` s); cancel stops new walks.',
  schema: z.strictObject({
    actors: z.array(z.string().min(1).max(80)).min(1).max(40),
    region: z.string().min(1).max(80),
    seed: z.number().int().min(0).max(1e9).optional(),
    duration: z.number().positive().max(24 * 3600).optional(),
  }),
  reservations: () => [],
  plan(rt, p) {
    const r = rt.world.regions[p.region];
    if (!r) return { ok: false, diagnostic: { code: 'region.unknown', message: `no region "${p.region}"`, subjects: [p.region] } };
    if (r.polygon.length < 3) return { ok: false, diagnostic: { code: 'region.degenerate', message: `region ${p.region} has fewer than 3 corners`, subjects: [p.region] } };
    if (new Set(p.actors).size !== p.actors.length) return { ok: false, diagnostic: { code: 'action.invalid-params', message: `ambient_wander lists an actor twice: ${p.actors.join(', ')}`, subjects: p.actors } };
    for (const a of p.actors) {
      const e = rt.world.entities[a];
      if (!e?.human) return { ok: false, diagnostic: { code: e ? 'actor.not-human' : 'entity.unknown', message: e ? `"${a}" is a ${e.kind}, not a person` : `no actor "${a}"`, subjects: [a] } };
    }
    return { ok: true, program: r.polygon };
  },
  start(rt, p, poly, id) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of poly) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    const salt = p.seed === undefined ? 0 : (p.seed * 0.6180339887498949) % 1;
    const ex: WanderExec = { id, poly, bbox: [x0, z0, x1, z1], level: rt.world.regions[p.region].level ?? 0, salt, who: [], walks: [] };
    if (p.duration !== undefined) ex.endTick = rt.tick + Math.round(p.duration / DT);
    // staggered first walks: 0–2 s
    for (const a of p.actors) ex.who.push({ actor: a, until: rt.tick + Math.round((2 * draw(rt, ex)) / DT) });
    return ex;
  },
  step(rt, ex) {
    const stopping = ex.endTick !== undefined && rt.tick >= ex.endTick;
    for (const w of ex.who) {
      if (w.released) continue;
      let returning = false;
      if (w.resume) {
        if (stopping) { skipReturn(rt, ex, w, 'ambient-ended'); continue; }
        if (rt.isActive(w.resume.directive)) continue;
        const status = rt.records.get(w.resume.directive)?.status;
        if (status !== 'completed') { skipReturn(rt, ex, w, status ?? 'directive-missing'); continue; }
        if (w.child && rt.isActive(w.child.id)) continue;
        const region = rt.world.regions[w.resume.region];
        if (!region || hashOf(region) !== w.resume.regionHash) { skipReturn(rt, ex, w, 'region.changed-or-missing'); continue; }
        const person = rt.world.entities[w.actor];
        if (!person?.human) { skipReturn(rt, ex, w, 'entity.unknown'); continue; }
        if (holdingDiagnostic(rt.world, w.actor) || Object.values(rt.world.entities).some((e) => e.support?.kind === 'in-hand' && e.support.by === w.actor)) { skipReturn(rt, ex, w, 'actor.holding'); continue; }
        if (rt.holder(`actor:${w.actor}`).length || person.human.task) { skipReturn(rt, ex, w, 'actor.busy'); continue; }
        w.child = undefined;
        w.until = rt.tick;
        returning = true;
      }
      if (w.child) {
        if (rt.isActive(w.child.id)) continue; // our walk holds actor:<id>
        const c = w.child;
        w.child = undefined;
        if (c.status === 'cancelled') { w.released = `walk ${c.id} was cancelled`; continue; } // someone intervened
        w.until = rt.tick + pauseTicks(rt, ex); // completed or failed (e.g. blocked route): rest, then try elsewhere
        continue;
      }
      const e = rt.world.entities[w.actor];
      if (!e?.human) { w.released = 'no longer in the world'; continue; }
      const hs = rt.holder(`actor:${w.actor}`);
      const foreign = hs.filter((h) => !isNudge(rt, h));
      if (foreign.length) { w.released = `reserved by ${foreign[0]} (${rt.records.get(foreign[0])!.verb})`; continue; }
      if (e.human.grip || (e.human.task && !isNudge(rt, e.human.task))) { w.released = `busy with ${e.human.grip ? `holding ${e.human.grip.entity}` : e.human.task}`; continue; }
      if (hs.length || e.human.task || stopping || rt.tick < w.until) continue;
      const t = pickTarget(rt, ex, w.actor);
      if (!t && returning) { skipReturn(rt, ex, w, 'ambient.no-return-target'); continue; }
      if (!t) { w.until = rt.tick + Math.round(1 / DT); continue; }
      const rec = rt.submit('walk_to', { actor: w.actor, x: t[0], z: t[1], level: ex.level, speed: WANDER_SPEED }, { parent: ex.id });
      if (rec.status === 'failed' && returning) { skipReturn(rt, ex, w, rec.diagnostic?.code ?? 'ambient.return-refused'); continue; }
      if (rec.status === 'failed') { w.until = rt.tick + Math.round(1 / DT); continue; }
      w.child = rec;
      if (returning) { rt.mark('ambient.readopted', { ambient: ex.id, actor: w.actor, directive: w.resume!.directive, walk: rec.id }); delete w.resume; delete w.returnPending; }
      ex.walks.push({ actor: w.actor, target: t, tick: rt.tick, id: rec.id });
    }
    const active = ex.who.some((w) => w.child && rt.isActive(w.child.id));
    const outputs = () => ({ walks: ex.walks.length, released: ex.who.filter((w) => w.released).map((w) => ({ actor: w.actor, why: w.released })) });
    if ((stopping || ex.who.every((w) => w.released)) && !active) return { status: 'completed', outputs: outputs() };
    return { status: 'running', phase: stopping ? 'stopping' : 'wandering' };
  },
  onDirective(rt, ex, by, claims, ancestors) {
    for (const w of ex.who) {
      if (w.released || !claims.some((r) => r.resource === `actor:${w.actor}`)) continue;
      if (w.resume) {
        if (ancestors.includes(w.resume.directive)) continue;
        skipReturn(rt, ex, w, 'newer-directive'); continue;
      }
      if (rt.registry.get(by.verb)?.yieldTo || w.child?.status === 'cancelled') continue;
      const person = rt.world.entities[w.actor];
      const foreign = rt.holder(`actor:${w.actor}`).some((id) => id !== w.child?.id && !isNudge(rt, id));
      if (!person?.human || foreign || person.human.grip || (person.human.task && person.human.task !== w.child?.id && !isNudge(rt, person.human.task))) continue;
      const regionId = (rt.records.get(ex.id)!.params as WanderParams).region;
      const region = rt.world.regions[regionId];
      if (!region) continue;
      const directive = ancestors.at(-1) ?? by.id;
      w.returnPending = true;
      w.resume = { directive, region: regionId, regionHash: hashOf(region) };
      rt.mark('ambient.return-pending', { ambient: ex.id, actor: w.actor, directive });
    }
  },
  validateSnapshot(rt, ex, self) {
    const bad = () => ({ code: 'snapshot.ambient-invalid', message: `ambient ${self.id} has invalid member/return provenance`, subjects: [self.id] });
    const params = self.params as WanderParams;
    if (!Array.isArray(ex.who) || ex.who.length !== params.actors.length || new Set(ex.who.map((w) => w?.actor)).size !== params.actors.length) return bad();
    for (const w of ex.who) {
      if (!w || !params.actors.includes(w.actor) || (w.returnPending === true) !== !!w.resume || (w.returnPending !== undefined && w.returnPending !== true)) return bad();
      if (w.child && (rt.records.get(w.child.id) !== w.child || w.child.parent !== ex.id || w.child.verb !== 'walk_to' || (w.child.params as { actor?: string }).actor !== w.actor)) return bad();
      if (w.resume) {
        const q = w.resume, directive = rt.records.get(q.directive);
        if (w.released || !directive || directive.parent || directive.id === ex.id || q.region !== params.region || typeof q.regionHash !== 'string' || !/^[a-f0-9]{64}$/.test(q.regionHash)) return bad();
      }
    }
    return null;
  },
  cancel: () => ({ ok: true }), // no new walks; the runtime cancels in-progress walks (people stop where they are)
  // A directed task cancels only this person's walk; the pending intent can re-adopt later.
  yieldTo: (_rt, _self, holder, _a, by) => (/:make-way:\d+$/.test(by.id) ? [] : [holder.id]),
};
