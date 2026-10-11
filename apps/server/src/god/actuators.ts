// VOCAB-MECH: def actuators as Soul actions. A def's declarative `actions` (vocab ACTUATORS: switch-on/off, open/close,
// lock/unlock, fill/empty, light/put-out, play/stop — or any def/1 action with `when` and `then` on its own state) become
// actions of the god thing's `built` object (perceive.ts), so a Soul near a lamp is offered
// `object:<entity>:switch-off`, walks up to it, reaches out, and the lamp's state changes in the world (an engine edit:
// in the ledger, broadcast to viewers, never the god's to undo). Nothing in the edge changes: the object framework's own
// capabilities, admission, receipts and body plans carry it.
import type { Entity, StoredDef } from '@sim/world-compiler';
import type { EdgeSoul } from '../edge/contract.ts';
import { afterCommit } from '../edge/comms/store.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Vec2 = [number, number];
type Action = StoredDef['actions'][number];
type Refusal = { code: string; reason: string };

/** Souls act on things within this distance of their body (they walk the rest of the way as part of the act). */
export const ACT_SIGHT = 30;
/** Close enough to reach out and touch it without walking. */
export const ACT_REACH = 1.6;

/** The fields of an entity's state the def's actions read or write, with defaults filled (public: Souls see them). */
export function actuatedState(e: Entity, def: StoredDef): Record<string, unknown> {
  const fields = new Set<string>();
  for (const a of def.actions) { for (const w of a.when) fields.add(w.field); for (const t of a.then) if ('field' in t) fields.add(t.field); }
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
  /** Commit a state change of a god thing as an engine edit. */
  commit(id: string, patch: Record<string, unknown>, note: string): { accepted: boolean };
  /** The thing's actuator state as the world has it now (the object's copy may lag a sync behind). */
  stateOf?(id: string): Record<string, unknown> | null;
};
type BuiltLike = { at: Vec2 | null; state?: Record<string, unknown>; removed?: boolean; key?: string; front?: Vec2 | null };

/** Object-kind actions for a def's actions (the `built` kind of things of that def). */
export function kindActions(def: StoredDef, host: ActuatorHost, nameOf: (s: BuiltLike) => string) {
  const out: Record<string, any> = {};
  for (const a of def.actions) {
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(a.name)) continue;
    const check = (s: BuiltLike, ctx: { soul: EdgeSoul }): Refusal | null => {
      if (s.removed || !s.at) return { code: 'object.gone', reason: 'It is not there any more.' };
      const me = host.bodyAt(ctx.soul); if (!me) return { code: 'body.unavailable', reason: 'Your body is unavailable.' };
      const d = Math.hypot(s.at[0] - me[0], s.at[1] - me[1]);
      if (d > ACT_SIGHT) return { code: 'object.out-of-reach', reason: `${nameOf(s)} is ${Math.round(d)} m away; walk closer first.` };
      return whenRefusal(a, (s.key && host.stateOf?.(s.key)) || s.state || {}, nameOf(s));
    };
    out[a.name] = {
      label: a.label, roles: 'anyone', reach: 'anywhere', params: {}, movesBody: true,
      available: (s: BuiltLike, ctx: any) => check(s, ctx),
      validate: (s: BuiltLike, _p: unknown, ctx: any) => check(s, ctx),
      apply: (s: BuiltLike, params: Record<string, unknown>, ctx: any) => {
        const me = host.bodyAt(ctx.soul)!, to = s.front ?? s.at!, far = Math.hypot(s.at![0] - me[0], s.at![1] - me[1]) > ACT_REACH;
        const patch = thenPatch(a, (s.key && host.stateOf?.(s.key)) || s.state || {}, params);
        return { state: s, result: { action: a.name, set: patch }, bodies: [{ label: `${a.label}`, steps: [...(far ? [{ verb: 'walk_to', params: { to, standoff: 0.5 } }] : []), { verb: 'wave', params: { at: s.key, seconds: 1 } }] }] };
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
    const t = find(id), a = t?.def.actions.find((x) => x.name === input.action);
    if (!t || !a) return out;
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
