// VOCAB-MECH: def actuators as Soul actions. A def's declarative `actions` (vocab ACTUATORS: switch-on/off, open/close,
// lock/unlock, fill/empty, light/put-out, play/stop — or any def/1 action with `when` and `then` on its own state) become
// actions of the god thing's `built` object (perceive.ts), so a Soul near a lamp is offered
// `object:<entity>:switch-off`, walks up to it, reaches out, and the lamp's state changes in the world (an engine edit:
// in the ledger, broadcast to viewers, never the god's to undo). Nothing in the edge changes: the object framework's own
// capabilities, admission, receipts and body plans carry it.
import type { Entity, StoredDef } from '@sim/world-compiler';
import type { EdgeSoul } from '../edge/contract.ts';
import { isContactActuator, CONTACT_REACH } from './contact-actuator.ts';
import { afterCommit } from '../edge/comms/store.ts';
import { SOURCE_NEAR_VESSEL, asPlant, asTank, drawWater, isWaterAction, waterActions, waterFields, waterPlant, waterRole, type Transfer } from './water.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Vec2 = [number, number];
type Action = StoredDef['actions'][number];
type Refusal = { code: string; reason: string };

/** Souls act on things within this distance of their body (they walk the rest of the way as part of the act). */
export const ACT_SIGHT = 30;
/** Close enough to reach out and touch it without walking. */
export const ACT_REACH = 1.6;

/** W5 (water.ts): a def's own actions plus those its water role gives it (draw-water at a tank, water a planter). */
export const actionsOf = (def: StoredDef): Action[] => { const w = waterActions(def); return w.length ? [...def.actions, ...w] : def.actions; };

/** The fields of an entity's state the def's actions read or write, with defaults filled (public: Souls see them). */
export function actuatedState(e: Entity, def: StoredDef): Record<string, unknown> {
  const fields = new Set<string>(waterFields(def));
  for (const a of actionsOf(def)) { for (const w of a.when) fields.add(w.field); for (const t of a.then) if ('field' in t) fields.add(t.field); }
  const out: Record<string, unknown> = {};
  for (const f of fields) { const v = e.state?.[f] ?? (def.state as Record<string, { default?: unknown }>)[f]?.default; if (v !== undefined) out[f] = v; }
  return out;
}
const same = (a: unknown, b: unknown) => a === b || (a == null && b == null) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9);
/** Why an action cannot be taken in this state (null = it can). */
export function whenRefusal(a: Action, state: Record<string, unknown>, name: string): Refusal | null {
  for (const w of a.when) {
    const v = state[w.field];
    if (w.is !== undefined && !same(v, w.is)) return { code: 'object.state', reason: `${name} is ${describeState(w.field, v)}.` };
    if (w.not !== undefined && same(v, w.not)) return { code: 'object.state', reason: `${name} is ${describeState(w.field, v)}.` };
  }
  return null;
}
function describeState(field: string, v: unknown) {
  if (field === 'on') return v ? 'already on' : 'off';
  if (field === 'open') return v ? 'already open' : 'closed';
  if (field === 'locked') return v ? 'locked' : 'not locked';
  if (field === 'lit') return v ? 'already lit' : 'not lit';
  if (field === 'playing') return v ? 'already playing' : 'not playing';
  if (field === 'level') return v === 1 ? 'full' : v === 0 ? 'empty' : `at ${v}`;
  if (field === 'moisture') return v === 1 ? 'well watered' : v === 0 ? 'dry' : `at moisture ${v}`;
  return `${field} ${JSON.stringify(v)}`;
}
/** The state patch an action makes (`set` and `toggle`; attach/detach are left to the engine's own verbs). */
export function thenPatch(a: Action, state: Record<string, unknown>, params: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const t of a.then) {
    if (t.op === 'set') out[t.field] = typeof t.value === 'object' && t.value !== null && 'param' in (t.value as object) ? params[(t.value as { param: string }).param] : t.value;
    else if (t.op === 'toggle') out[t.field] = !(out[t.field] ?? state[t.field]);
  }
  return out;
}

export type ActuatorHost = {
  /** The Soul's body position (x, z), or null. */
  bodyAt(soul: EdgeSoul): Vec2 | null;
  deferContacts?: boolean;
  contactPlan?(soul:EdgeSoul,target:string,action:string):{params:Record<string,unknown>;root:[number,number,number];level?:number}|null;
  /** Commit a state change of a god thing as an engine edit. */
  commit(id: string, patch: Record<string, unknown>, note: string): { accepted: boolean };
  /** The thing's actuator state as the world has it now (the object's copy may lag a sync behind). */
  stateOf?(id: string): Record<string, unknown> | null;
  /** LAYERS: why this Soul may not touch it (a private thing of someone else's), or null. */
  access?(id: string, soul: EdgeSoul): Refusal | null;
  /** SOULFIX: a standing point within reach that the body can walk to (front, back, else any side), or null. */
  approach?(id: string, soul: EdgeSoul, front: Vec2 | null, radius?: number): { p: Vec2; level: number } | null;
  /** W5 water (water.ts): the things involved in moving water, and an atomic commit of several state changes. */
  water?: WaterHost;
};
export type Thing = { id: string; name: string; def: StoredDef; state: Record<string, unknown>; params: Record<string, unknown> };
export type WaterHost = {
  /** The god thing in this Soul's hand, or null. */
  held(soul: EdgeSoul): Thing | null;
  thing(id: string): Thing | null;
  /** The nearest water source within `r` metres of a thing (a can standing under a tank's tap). */
  sourceNear(id: string, r: number): Thing | null;
  commit(set: Transfer['set'], note: string): { accepted: boolean };
};

/** W5: what a water action would do now (a refusal or the transfer); null when the action is not about water. */
export function waterPlan(a: Action, id: string, soul: EdgeSoul, host: ActuatorHost): Transfer | Refusal | null {
  const w = host.water; if (!w) return null;
  const t = w.thing(id); if (!t) return null;
  const role = waterRole(t.def);
  if (!(isWaterAction(a) || (role === 'vessel' && a.name === 'fill'))) return null;
  const vessel = (x: Thing | null) => (x && waterRole(x.def) === 'vessel' ? asTank(x.id, x.name, x.def, x.state, x.params) : null);
  if (role === 'source') return drawWater(asTank(t.id, t.name, t.def, t.state, t.params), vessel(w.held(soul)));
  if (role === 'plant') return waterPlant(asPlant(t.id, t.name, t.def, t.state, t.params), vessel(w.held(soul)));
  if (role === 'vessel') {
    const src = w.sourceNear(id, SOURCE_NEAR_VESSEL);
    if (!src) return { code: 'water.no-source', reason: `There is no water by ${t.name}; carry it to a water tank or a rain barrel and fill it there.` };
    return drawWater(asTank(src.id, src.name, src.def, src.state, src.params), vessel(t));
  }
  return null;
}
const isRefusal = (x: Transfer | Refusal | null): x is Refusal => !!x && 'code' in x;
type BuiltLike = { at: Vec2 | null; state?: Record<string, unknown>; removed?: boolean; key?: string; front?: Vec2 | null };

/** Object-kind actions for a def's actions (the `built` kind of things of that def). */
export function kindActions(def: StoredDef, host: ActuatorHost, nameOf: (s: BuiltLike) => string) {
  const out: Record<string, any> = {};
  for (const a of actionsOf(def)) {
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(a.name)) continue;
    const check = (s: BuiltLike, ctx: { soul: EdgeSoul }): Refusal | null => {
      if (s.removed || !s.at) return { code: 'object.gone', reason: 'It is not there any more.' };
      const me = host.bodyAt(ctx.soul); if (!me) return { code: 'body.unavailable', reason: 'Your body is unavailable.' };
      const d = Math.hypot(s.at[0] - me[0], s.at[1] - me[1]);
      if (d > ACT_SIGHT) return { code: 'object.out-of-reach', reason: `${nameOf(s)} is ${Math.round(d)} m away; walk closer first.` };
      const denied = s.key ? host.access?.(s.key, ctx.soul) : null; if (denied) return denied;
      if(host.deferContacts&&def.tags.includes('wall-window')&&s.key&&!host.contactPlan?.(ctx.soul,s.key,a.name))return {code:'contact.out-of-reach',reason:'This window handle is outside standing hand reach from your floor.'};
      const water = s.key ? waterPlan(a, s.key, ctx.soul, host) : null; if (water) return isRefusal(water) ? water : null;
      return whenRefusal(a, (s.key && host.stateOf?.(s.key)) || s.state || {}, nameOf(s));
    };
    out[a.name] = {
      label: a.label, roles: 'anyone', reach: 'anywhere', params: {}, movesBody: true,
      available: (s: BuiltLike, ctx: any) => check(s, ctx),
      validate: (s: BuiltLike, _p: unknown, ctx: any) => check(s, ctx),
      apply: (s: BuiltLike, params: Record<string, unknown>, ctx: any) => {
        const contact = host.deferContacts && isContactActuator(def, a);
        const motion=contact&&s.key?host.contactPlan?.(ctx.soul,s.key,a.name):null;
        if(motion){const me=host.bodyAt(ctx.soul)!,far=(motion.level??0)>0||Math.hypot(me[0]-motion.root[0],me[1]-motion.root[2])>.1;
          return {state:s,result:{action:a.name,set:thenPatch(a,(s.key&&host.stateOf?.(s.key))||s.state||{},params)},bodies:[{label:a.label,steps:[{verb:'stand',params:{}},...(far?[(motion.level??0)>0?{verb:'mars:walk_to',params:{x:motion.root[0],z:motion.root[2],level:motion.level}}:{verb:'walk_to',params:{to:[motion.root[0],motion.root[2]],standoff:0}}]:[]),{verb:'mars:hand_actuator_v1',params:motion.params}]}]};}

        const me = host.bodyAt(ctx.soul)!, to = s.front ?? s.at!, far = Math.hypot(s.at![0] - me[0], s.at![1] - me[1]) > (contact ? CONTACT_REACH : ACT_REACH);
        const water = s.key ? waterPlan(a, s.key, ctx.soul, host) : null;
        const patch = water && !isRefusal(water) ? { litres: water.litres } : thenPatch(a, (s.key && host.stateOf?.(s.key)) || s.state || {}, params);
        // A door works from either side. Prefer the side the Soul already occupies,
        // so "close behind me" cannot silently walk it back out of the room.
        const front=contact&&def.components.opening&&s.front&&s.at
          &&(me[0]-s.at[0])*(s.front[0]-s.at[0])+(me[1]-s.at[1])*(s.front[1]-s.at[1])<0
          ? [2*s.at[0]-s.front[0],2*s.at[1]-s.front[1]] as Vec2 : s.front??null;
        const ap = far && s.key ? host.approach?.(s.key, ctx.soul, front, contact ? .75 : undefined) : null;
        const walk = !far ? [] : ap ? [ap.level === 0 ? { verb: 'walk_to', params: { to: ap.p, standoff: 0 } } : { verb: 'mars:walk_to', params: { x: ap.p[0], z: ap.p[1], level: ap.level } }] : [{ verb: 'walk_to', params: { to, standoff: 0.5 } }];
        return { state: s, result: { action: a.name, set: patch, ...(water && !isRefusal(water) ? { summary: water.summary } : {}) }, bodies: [{ label: `${a.label}`, steps: contact ? [{verb:'stand',params:{}},...walk,{verb:'mars:pose_v1',params:{activity:'operate',seconds:1.2,face:s.at!}}] : [...walk, { verb: 'wave', params: { at: s.key, seconds: 1 } }] }] };
      },
    };
  }
  return out;
}

/** Wrap the framework's `act` (what the ledger's commit calls) so an accepted actuator action changes the world. */
export function wrapAct(objects: { act(id: string, soul: EdgeSoul, input: Record<string, unknown>): any } & { __vocabAct?: boolean }, find: (id: string) => { def: StoredDef; state: Record<string, unknown>; name: string } | null, host: ActuatorHost, log: (m: string) => void) {
  if (objects.__vocabAct) return; objects.__vocabAct = true;
  const orig = objects.act.bind(objects);
  objects.act = (id: string, soul: EdgeSoul, input: Record<string, unknown>) => {
    const out = orig(id, soul, input);
    if (!out?.accepted) return out;
    const t = find(id), a = t ? actionsOf(t.def).find((x) => x.name === input.action) : undefined;
    if (!t || !a) return out;
    if (host.deferContacts && isContactActuator(t.def, a)) return out;
    // W5: water moves between two things (tank → can, can → planter) in one commit, planned again at commit time
    const water = waterPlan(a, id, soul, host);
    if (water) {
      if (isRefusal(water)) { log(`water ${a.name} on ${id}: ${water.reason}`); return out; }
      const go = () => { try { const now = waterPlan(a, id, soul, host); if (!now || isRefusal(now)) { log(`water ${a.name} on ${id}: by commit time ${now ? now.reason : 'not water'}`); return; } const r = host.water!.commit(now.set, `${soul.soulId} ${a.name} ${t.name}: ${now.litres} L`); if (!r.accepted) log(`water ${a.name} on ${id}: the world refused ${JSON.stringify(now.set)}`); } catch (e) { log(`water ${a.name} on ${id}: ${(e as Error).message}`); } };
      const db0 = (objects as unknown as { core?: { db?: unknown } }).core?.db;
      try { if (db0) afterCommit(db0 as never, go); else setImmediate(go); } catch { setImmediate(go); }
      return out;
    }
    const patch = thenPatch(a, t.state, (input.params ?? {}) as Record<string, unknown>);
    if (!Object.keys(patch).length) return out;
    // the object act runs inside the ledger's transaction (and may still roll back with the body's admission): change the
    // world only once that transaction has committed, never inside it (the world store has its own transaction)
    const apply = () => { try { const r = host.commit(id, patch, `${soul.soulId} ${a.name} ${t.name}`); if (!r.accepted) log(`actuator ${a.name} on ${id}: the world refused ${JSON.stringify(patch)}`); } catch (e) { log(`actuator ${a.name} on ${id}: ${(e as Error).message}`); } };
    const db = (objects as unknown as { core?: { db?: unknown } }).core?.db;
    try { if (db) afterCommit(db as never, apply); else setImmediate(apply); } catch { setImmediate(apply); }
    return out;
  };
}
