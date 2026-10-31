// Item verbs (owner feedback §12, ITEMS.md): take_item, put_item, serve, eat, plus the internal
// hold_items that keeps a person's hand-held items at their hands every tick.
//
// Resources: `actor:<id>` (take_item / put_item walk the person), `hand:<id>:<left|right>` (whoever
// drives that hand's point this tick), `entity:<item>`, `holds:<id>` (the one hold_items per person).
// `serve` and `eat` are overlays: they never reserve `actor:`, so they run while the person is held by
// a sit / take_slot / gather / converse; they set activity `serve` / `eat` (after the holder has set
// its own activity this tick, because they are submitted later) and publish `human.baseActivity` =
// the activity they are layered on ('sit' = seated).
import { z } from 'zod';
import { angleDelta, clamp, heading, q6, rot2, wrapAngle, type Vec3 } from '../core/math.ts';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import { DT, type Runtime } from '../runtime/runtime.ts';
import type { Entity } from '../world/types.ts';
import { CATALOG } from '../world/catalog.ts';
import { CONTAINERS, ITEM_ASSETS } from '../world/catalog-items.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import type { Spatial } from '../spatial/service.ts';
import { clearanceAt } from '../spatial/grid.ts';
import { humanRadius } from '../bodies/humanoid.ts';
/** Clear ground left between a body and a long thing it puts down (covers the grid's rasterising). */
const PUT_CLEAR_M = 0.15;
/** Built-in catalogue items keep the historical 0.55 m exactly (their logged puts replay unchanged). */
const BUILT_IN_ITEMS: ReadonlySet<string> = new Set(ITEM_ASSETS.map((d) => d.id));
import { checkStations, childrenState, walkCrew, type Children } from '../construction/children.ts';
import { holdingDiagnostic } from '../construction/rules.ts';
import { SIT_TRANSITION } from '../social/actions.ts';
import { watering } from './watering.ts';
import {
  bodyFrame, bowlHand, carryHand, dipHand, HANDS, lerp3, mouthPoint, otherHand, restHand, rimHand, SEAT_DROP, smooth,
  type BodyFrame, type Hand,
} from './body.ts';
import {
  BODY_REACH, carryPoint, followHand, graspPoint, heldBy, inHand, isItem, itemReachSeconds, placeOnGround, placeOnSlot, putInHand,
  reachOf, reachStation, slotOccupant, surfaceSlot, whereIs, type Station, type SurfaceSlot,
} from './model.ts';

const id80 = z.string().min(1).max(80);
const handSchema = z.enum(['left', 'right']);
const ticks = (s: number) => Math.round(s / DT);

/** Items this close to a standing person's body axis (m, horizontal) are reached without stepping. */
export const HERE_REACH = 0.85;
/** Seconds: reach to an item / back. */
export const REACH_TIME = 0.4;
/** Eat cycle phases (s): dip 0.6 → lift to mouth 0.6 → pause 0.4 → return 0.8 = 2.4 s; ready / lower 0.4 s around the cycles. */
export const EAT_PHASES = { ready: 0.4, dip: 0.6, lift: 0.6, pause: 0.4, return: 0.8, lower: 0.4 } as const;
export const EAT_CYCLE = EAT_PHASES.dip + EAT_PHASES.lift + EAT_PHASES.pause + EAT_PHASES.return;
/** Fraction of a full bowl one spoonful takes. */
export const SPOONFUL = 0.2;
/** Fraction of the pot one serving takes; a served bowl is full (1.0). */
export const SERVING = 0.25;
/** Serve phases (s): serving hand to the pot, to the bowl (fills it), back. */
export const SERVE_PHASES = { toPot: 0.6, toBowl: 0.6, back: 0.4 } as const;
/** Activities a person may eat / serve from (seated, or standing still). */
export const STILL_ACTIVITIES: ReadonlySet<string> = new Set(['sit', 'idle', 'talk', 'watch', 'listen', 'warm']);
const OVERLAYS: ReadonlySet<string> = new Set(['eat', 'serve']);

const fail = (code: string, message: string, subjects: string[], extra: Partial<Diagnostic> = {}) => ({ ok: false as const, diagnostic: { code, message, subjects, ...extra } });

function personOf(rt: Runtime, id: string): Entity | Diagnostic {
  const e = rt.world.entities[id];
  if (!e) return { code: 'entity.unknown', message: `no actor "${id}"`, subjects: [id] };
  if (e.kind !== 'human' || !e.human) return { code: 'actor.not-human', message: `"${id}" is a ${e.kind}, not a person`, subjects: [id] };
  return e;
}
function itemOf(rt: Runtime, id: string): Entity | Diagnostic {
  const e = rt.world.entities[id];
  if (!e) return { code: 'entity.unknown', message: `no item "${id}"`, subjects: [id] };
  if (!isItem(e)) return { code: 'item.not-handheld', message: `${id} is a ${CATALOG[e.def]?.label ?? e.def}, not a small hand-held item`, subjects: [id] };
  return e;
}

// ---- hand points ----

function setHand(a: Entity, h: Hand, q: Vec3 | undefined) {
  const hs = a.human!.hands ?? {};
  if (q) hs[h] = [q[0], q[1], q[2]];
  else delete hs[h];
  if (hs.left || hs.right) a.human!.hands = hs;
  else delete a.human!.hands;
}
const handNow = (a: Entity, h: Hand, b: BodyFrame): Vec3 => a.human!.hands?.[h] ?? restHand(b, h);
const driven = (rt: Runtime, actor: string, h: Hand) => rt.holder(`hand:${actor}:${h}`).some((id) => {
  const record = rt.records.get(id);
  const policy = record && rt.registry.get(record.verb)?.drivesReservedHands;
  return typeof policy === 'function' ? policy(record!) : policy !== false;
});
const isSeated = (a: Entity) => {
  const act = OVERLAYS.has(a.human!.activity) ? a.human!.baseActivity ?? 'idle' : a.human!.activity;
  return act === 'sit' || act === 'sit-down';
};

/** Start the person's hold_items if none is running (after a grasp). */
function ensureHolder(rt: Runtime, actor: string): Diagnostic | null {
  if (rt.holder(`holds:${actor}`).length) return null;
  const r = rt.submit('hold_items', { actor });
  return r.status === 'failed' ? r.diagnostic ?? null : null;
}

// ---- hold_items (internal) ----

type HoldExec = { actor: string; k: number };
export const holdItems: ActionDef<{ actor: string }, null, HoldExec> = {
  verb: 'hold_items',
  description:
    "Internal, started by take_item on a grasp: every tick keeps the small items a person holds at their hands (carry points in front of the hips while walking, standing or seated; or wherever take_item / put_item / serve / eat drive that hand) and publishes human.hands. Completes when the person holds nothing. Reserves only holds:<actor>.",
  schema: z.strictObject({ actor: id80 }),
  reservations: (_w, p) => [{ resource: `holds:${p.actor}`, mode: 'exclusive' }],
  plan(rt, p) {
    const a = personOf(rt, p.actor);
    return 'code' in a ? { ok: false, diagnostic: a } : { ok: true, program: null };
  },
  start: (rt, p) => ({ actor: p.actor, k: isSeated(rt.world.entities[p.actor]) ? 1 : 0 }),
  step(rt, ex, dt): StepResult {
    const a = rt.world.entities[ex.actor];
    if (!a?.human) return { status: 'completed' };
    // seated fraction eases over the sit-down / stand-up time, so carried items follow the body down
    const want = isSeated(a) ? 1 : 0;
    if (want > ex.k) ex.k = Math.min(1, ex.k + dt / SIT_TRANSITION);
    else if (want < ex.k) ex.k = Math.max(0, ex.k - dt / SIT_TRANSITION);
    const b = bodyFrame(a, smooth(ex.k) * SEAT_DROP);
    const held = heldBy(rt.world, ex.actor);
    // a construction grip (carry / lift / hand_up) owns human.hands while it lasts: leave them alone
    for (const h of a.human.grip ? [] : HANDS) {
      if (driven(rt, ex.actor, h)) continue;
      const it = held.find((x) => x.hand === h);
      if (it) {
        const q = carryPoint(it.item, b, h);
        setHand(a, h, q);
        followHand(it.item, q, a.pose.yaw);
      } else setHand(a, h, undefined);
    }
    return held.length ? { status: 'running', phase: 'holding' } : { status: 'completed' };
  },
  cancel: () => ({ ok: true }),
  resumable: true,
};

// ---- take_item / put_item ----

type TransferParams = { actor: string; item: string; hand?: Hand; surfaceSlot?: string };
type Dest = { slot: SurfaceSlot; ownerPose: Entity['pose']; ownerDef: string } | { ground: Vec3 };
type TransferProgram = { hand: Hand; station?: Station; target: Vec3; dest?: Dest };
type TransferExec = {
  id: string; mode: 'take' | 'put'; actor: string; item: string; hand: Hand; station?: Station; target: Vec3; dest?: Dest;
  phase: 'approach' | 'turn' | 'reach' | 'withdraw'; child?: Children; error?: Diagnostic; t: number; from?: Vec3; to?: Vec3;
  /** Item support at plan time (take): the item must still be there when the hand arrives. */
  source?: string;
};

const supportKey = (e: Entity) => JSON.stringify(e.support ?? null);

/** Already within HERE_REACH of the target (e.g. the next item along the table): no walk, just turn to it. */
function fromHere(a: Entity, target: Vec3): Station | null {
  if (reachOf(a, target) > HERE_REACH || !STILL_ACTIVITIES.has(a.human!.activity) || a.human!.activity === 'sit') return null;
  return { p: [a.pose.p[0], a.pose.p[2]], yaw: heading([target[0] - a.pose.p[0], target[2] - a.pose.p[2]]) };
}

function planTake(rt: Runtime, p: TransferParams) {
  const a = personOf(rt, p.actor);
  if ('code' in a) return { ok: false as const, diagnostic: a };
  const busy = holdingDiagnostic(rt.world, p.actor);
  if (busy) return { ok: false as const, diagnostic: busy };
  const it = itemOf(rt, p.item);
  if ('code' in it) return { ok: false as const, diagnostic: it };
  const hand = p.hand!;
  const s = it.support;
  if (s?.kind === 'in-hand')
    return s.by === p.actor
      ? fail('item.already-held', `${p.actor} already holds ${it.id} in their ${s.hand} hand`, [p.actor, it.id])
      : fail('item.held-by', `${it.id} is held by ${s.by} (${s.hand} hand); ${p.actor} cannot take it`, [p.actor, it.id, s.by]);
  const full = inHand(rt.world, p.actor, hand);
  if (full) return fail('item.hand-full', `${p.actor}'s ${hand} hand already holds ${full.id}; put it down or use the other hand`, [p.actor, full.id, it.id]);
  let owner: Entity | undefined;
  if (s?.kind === 'resting-on') {
    owner = rt.world.entities[s.on];
    if (!owner || !s.slot) return fail('item.unsupported-source', `${it.id} rests on ${s.on}, which is not a surface an item can be taken from`, [it.id, s.on]);
  } else if (s?.kind !== 'ground') return fail('item.unsupported-source', `${it.id} is ${whereIs(rt.world, it)}; only items on a surface or the ground can be taken`, [it.id]);
  const target = graspPoint(it);
  const st = fromHere(a, target) ?? reachStation(rt, a, target, owner, `${it.id} (${whereIs(rt.world, it)})`);
  if ('code' in st) return { ok: false as const, diagnostic: { ...st, subjects: [...new Set([...(st.subjects ?? []), it.id])] } };
  const here = Math.abs(st.p[0] - a.pose.p[0]) < 0.05 && Math.abs(st.p[1] - a.pose.p[2]) < 0.05;
  if (!here) {
    const d = checkStations(rt, [{ actor: p.actor, p: st.p, level: a.human!.level }]);
    if (d) return { ok: false as const, diagnostic: d };
  }
  return { ok: true as const, program: { hand, station: st, target } as TransferProgram };
}

/** Clear radius a thing needs on the ground (half its footprint diagonal). */
export function groundPutNeed(def: string): number { const d = CATALOG[def]; return d ? Math.sqrt(d.size[0] * d.size[0] + d.size[2] * d.size[2]) / 2 : 0; }
/** How far ahead put_item sets a thing on the ground: 0.55 m; a thing too long for that (a god-made watering can) goes far
 *  enough out that the body that put it down stays clear of it (else collision.human-static and the step is set aside). */
export function groundPutDistance(def: string, actor: Entity): number {
  return BUILT_IN_ITEMS.has(def) ? 0.55 : Math.max(0.55, humanRadius(actor) + groundPutNeed(def) + PUT_CLEAR_M);
}

function planPut(rt: Runtime, p: TransferParams) {
  const a = personOf(rt, p.actor);
  if ('code' in a) return { ok: false as const, diagnostic: a };
  const it = itemOf(rt, p.item);
  if ('code' in it) return { ok: false as const, diagnostic: it };
  const s = it.support;
  if (s?.kind !== 'in-hand' || s.by !== p.actor) return fail('item.not-held', `${p.actor} is not holding ${it.id} (it is ${whereIs(rt.world, it)})`, [p.actor, it.id]);
  const hand = s.hand;
  if (p.surfaceSlot === 'ground') {
    if (!STILL_ACTIVITIES.has(a.human!.activity) || a.human!.activity === 'sit') return fail('item.not-standing', `${p.actor} must be standing still to put ${it.id} on the ground (activity ${a.human!.activity})`, [p.actor, it.id]);
    const d = CATALOG[it.def], need = groundPutNeed(it.def);
    const f = rot2([groundPutDistance(it.def, a), 0], a.pose.yaw);
    const g: Vec3 = [a.pose.p[0] + f[0], a.pose.p[1], a.pose.p[2] + f[1]];
    const sp = rt.services.spatial as Spatial | undefined;
    sp?.sync(rt.world);
    const grid = sp?.level(a.human!.level);
    const cl = grid ? clearanceAt(grid, [g[0], g[2]]) : Infinity;
    if (cl < need) return fail('item.no-room', `no room for ${it.id} on the ground in front of ${p.actor} at (${g[0].toFixed(2)}, ${g[2].toFixed(2)}): ${cl.toFixed(2)} m clear, needs ${need.toFixed(2)} m`, [p.actor, it.id], { at: g });
    const gl = d.handling!.grips[1][0].local, go = rot2([gl[0], gl[2]], a.pose.yaw); // grip offset, world
    return { ok: true as const, program: { hand, target: [g[0] + go[0], g[1] + gl[1], g[2] + go[1]], dest: { ground: g } } as TransferProgram };
  }
  const slot = surfaceSlot(rt.world, p.surfaceSlot!);
  if ('code' in slot) return { ok: false as const, diagnostic: slot };
  const occ = slotOccupant(rt.world, slot.owner, slot.slot);
  if (occ) return fail('item.slot-occupied', `${slot.id} already has ${occ.id} on it`, [slot.id, occ.id]);
  const owner = rt.world.entities[slot.owner];
  const g = CATALOG[it.def].handling!.grips[1][0].local;
  const q = rot2([g[0], g[2]], owner.pose.yaw);
  const target: Vec3 = [slot.p[0] + q[0], slot.p[1] + g[1], slot.p[2] + q[1]];
  const st = fromHere(a, slot.p) ?? reachStation(rt, a, slot.p, owner, `surface slot ${slot.id}`);
  if ('code' in st) return { ok: false as const, diagnostic: st };
  const here = Math.abs(st.p[0] - a.pose.p[0]) < 0.05 && Math.abs(st.p[1] - a.pose.p[2]) < 0.05;
  if (!here) {
    const d = checkStations(rt, [{ actor: p.actor, p: st.p, level: a.human!.level }]);
    if (d) return { ok: false as const, diagnostic: d };
  }
  return { ok: true as const, program: { hand, station: st, target, dest: { slot, ownerPose: { ...owner.pose, p: [...owner.pose.p] }, ownerDef: owner.def } } as TransferProgram };
}

function transfer(mode: 'take' | 'put', verb: string, description: string, schema: z.ZodType<TransferParams>): ActionDef<TransferParams, TransferProgram, TransferExec> {
  const handOf = (rt: Runtime, p: TransferParams) => (mode === 'take' ? p.hand! : ((rt.world.entities[p.item]?.support as { hand?: Hand } | undefined)?.hand ?? 'right'));
  return {
    verb,
    description,
    schema,
    reservations: (w, p) => [
      { resource: `actor:${p.actor}`, mode: 'exclusive' },
      { resource: `hand:${p.actor}:${mode === 'take' ? p.hand : (w.entities[p.item]?.support as { hand?: Hand } | undefined)?.hand ?? 'right'}`, mode: 'exclusive' },
      { resource: `entity:${p.item}`, mode: 'exclusive' },
      ...(mode === 'put' && p.surfaceSlot !== 'ground' ? [{ resource: `surface-slot:${p.surfaceSlot}`, mode: 'exclusive' as const }] : []),
    ],
    drivesReservedHands: (record) => record.phase === 'reach' || record.phase === 'withdraw',
    plan: (rt, p) => (mode === 'take' ? planTake(rt, p) : planPut(rt, p)),
    start(rt, p, prog, id) {
      const a = rt.world.entities[p.actor];
      const ex: TransferExec = { id, mode, actor: p.actor, item: p.item, hand: handOf(rt, p), station: prog.station, target: prog.target, dest: prog.dest, phase: 'turn', t: 0, source: supportKey(rt.world.entities[p.item]) };
      if (prog.station && (Math.abs(prog.station.p[0] - a.pose.p[0]) >= 0.05 || Math.abs(prog.station.p[1] - a.pose.p[2]) >= 0.05)) {
        const ch = walkCrew(rt, id, [{ actor: p.actor, p: prog.station.p, yaw: prog.station.yaw, level: a.human!.level }]);
        if ('code' in ch) ex.error = ch;
        else { ex.child = ch; ex.phase = 'approach'; }
      }
      a.human!.task = id;
      return ex;
    },
    step(rt, ex): StepResult {
      if (ex.error) return { status: 'failed', diagnostic: ex.error };
      const a = rt.world.entities[ex.actor];
      const it = rt.world.entities[ex.item];
      if (ex.phase === 'approach') {
        const st = childrenState(ex.child!);
        if (st === 'running') return { status: 'running', phase: 'approach' };
        if (st !== 'done') return { status: 'failed', diagnostic: { ...st, message: `${ex.actor} could not reach the ${ex.mode === 'take' ? `standing point for ${ex.item}` : 'table'}: ${st.message}` } };
        ex.phase = 'turn';
      }
      if (ex.phase === 'turn') {
        a.human!.task = ex.id;
        a.human!.activity = 'idle';
        const want = ex.station?.yaw ?? a.pose.yaw;
        if (Math.abs(angleDelta(a.pose.yaw, want)) > 0.03) {
          a.pose.yaw = wrapAngle(a.pose.yaw + clamp(angleDelta(a.pose.yaw, want), -HUMAN_PROFILE.turnRate * DT, HUMAN_PROFILE.turnRate * DT));
          return { status: 'running', phase: 'turn' };
        }
        if (ex.mode === 'take' && supportKey(it) !== ex.source) {
          const s = it.support;
          if (s?.kind === 'in-hand') return { status: 'failed', diagnostic: { code: 'item.held-by', message: `${ex.item} was taken by ${s.by} before ${ex.actor} reached it`, subjects: [ex.actor, ex.item, s.by] } };
          return { status: 'failed', diagnostic: { code: 'item.moved', message: `${ex.item} moved (now ${whereIs(rt.world, it)}) before ${ex.actor} reached it`, subjects: [ex.actor, ex.item] } };
        }
        if (ex.mode === 'put' && 'slot' in ex.dest!) {
          const occ = slotOccupant(rt.world, ex.dest.slot.owner, ex.dest.slot.slot);
          if (occ) return { status: 'failed', diagnostic: { code: 'item.slot-occupied', message: `${ex.dest.slot.id} was taken by ${occ.id} before ${ex.actor} got there`, subjects: [ex.dest.slot.id, occ.id] } };
        }
        ex.phase = 'reach';
        ex.t = 0;
        ex.from = handNow(a, ex.hand, bodyFrame(a));
        ex.to = ex.target;
      }
      a.human!.activity = 'reach';
      ex.t++;
      const reachTicks = ticks(itemReachSeconds(it) ?? REACH_TIME);
      const k = smooth(ex.t / reachTicks);
      const q = lerp3(ex.from!, ex.to!, k);
      setHand(a, ex.hand, q);
      const holding = (ex.mode === 'take') === (ex.phase === 'withdraw');
      if (holding) followHand(it, q, a.pose.yaw);
      if (ex.t < reachTicks) return { status: 'running', phase: ex.phase };
      if (ex.phase === 'reach') {
        const b = bodyFrame(a);
        if (ex.mode === 'take') {
          putInHand(it, ex.actor, ex.hand);
          followHand(it, q, a.pose.yaw);
          const d = ensureHolder(rt, ex.actor);
          if (d) return { status: 'failed', diagnostic: d };
          ex.to = carryPoint(it, b, ex.hand);
        } else {
          if ('slot' in ex.dest!) {
            const dest = ex.dest, owner = rt.world.entities[dest.slot.owner];
            const current = surfaceSlot(rt.world, dest.slot.id);
            if ('code' in current) return { status: 'failed', diagnostic: {
              code: 'item.destination-unavailable',
              message: `${ex.actor} cannot release ${ex.item}: destination ${dest.slot.id} is no longer available (${current.message})`,
              subjects: [ex.actor, ex.item, dest.slot.id, dest.slot.owner],
            } };
            if (owner.def !== dest.ownerDef || JSON.stringify(owner.pose) !== JSON.stringify(dest.ownerPose) || current.p.some((p, i) => p !== dest.slot.p[i]))
              return { status: 'failed', diagnostic: {
                code: 'item.destination-moved',
                message: `${ex.actor} cannot release ${ex.item}: surface ${dest.slot.owner} or slot ${dest.slot.id} changed after the placement was planned`,
                subjects: [ex.actor, ex.item, dest.slot.id, dest.slot.owner],
              } };
            const occupied = slotOccupant(rt.world, dest.slot.owner, dest.slot.slot);
            if (occupied) return { status: 'failed', diagnostic: {
              code: 'item.slot-occupied',
              message: `${ex.actor} cannot release ${ex.item}: ${dest.slot.id} is now occupied by ${occupied.id}`,
              subjects: [ex.actor, ex.item, dest.slot.id, occupied.id],
            } };
            // a hook (Soul Actions 34): what hangs keeps the yaw it was hung with (no turn at the release)
            placeOnSlot(it, dest.slot, dest.slot.hang ? it.pose.yaw : owner.pose.yaw);
          }
          else placeOnGround(it, ex.dest!.ground, a.pose.yaw);
          ex.to = restHand(b, ex.hand);
        }
        ex.phase = 'withdraw';
        ex.t = 0;
        ex.from = q;
        return { status: 'running', phase: 'withdraw' };
      }
      if (ex.mode === 'put') setHand(a, ex.hand, undefined);
      if (a.human!.task === ex.id) { a.human!.task = undefined; a.human!.activity = 'idle'; }
      return { status: 'completed', outputs: { item: ex.item, hand: ex.hand, support: rt.world.entities[ex.item].support } };
    },
    cancel(rt, ex) {
      const a = rt.world.entities[ex.actor];
      // light items: stop at once; an item already grasped stays in hand (hold_items keeps it there)
      if (a?.human) {
        if (!inHand(rt.world, ex.actor, ex.hand)) setHand(a, ex.hand, undefined);
        if (a.human.task === ex.id) { a.human.task = undefined; a.human.activity = 'idle'; }
      }
      return { ok: true };
    },
    resumable: true,
  };
}

export const takeItem = transfer(
  'take',
  'take_item',
  `A person takes a small hand-held item (bowl, spoon, plate, cup, pot) into one hand: walks to a standing point at the table edge within ${0.6} m reach of it (or beside it on the ground), reaches (${REACH_TIME} s, activity reach), grasps, draws the hand back. Refused item.held-by, item.hand-full, item.unreachable (naming blockers), item.not-handheld.`,
  z.strictObject({ actor: id80, item: id80, hand: handSchema }) as z.ZodType<TransferParams>,
);

export const putItem = transfer(
  'put',
  'put_item',
  `A person puts an item they hold onto a table surface slot ("<table>#<slot>", walking to the table edge first) or on the ground in front of them ('ground'); reach ${REACH_TIME} s, release, hand back. Refused item.not-held, item.slot-occupied, item.unreachable, item.no-room.`,
  z.strictObject({ actor: id80, item: id80, surfaceSlot: id80 }) as z.ZodType<TransferParams>,
);

// ---- overlays: serve, eat ----

/** Refusal if the person is moving / transitioning (eat and serve need them seated or standing still). */
function stillness(rt: Runtime, a: Entity, verb: string): Diagnostic | null {
  const walk = rt.holder(`actor:${a.id}`).map((h) => rt.records.get(h)!).find((r) => r.verb === 'walk_to');
  const act = a.human!.activity;
  if (walk || !STILL_ACTIVITIES.has(act))
    return {
      code: `${verb}.not-still`,
      message: `${a.id} is ${walk ? `walking (walk_to ${walk.id})` : `busy (activity ${act})`}; ${verb} needs them seated or standing still`,
      subjects: [a.id, ...(walk ? [walk.id] : [])],
    };
  return null;
}

function holding(rt: Runtime, actor: string, id: string, what: string): Entity | Diagnostic {
  const it = itemOf(rt, id);
  if ('code' in it) return it;
  const s = it.support;
  if (s?.kind !== 'in-hand' || s.by !== actor) return { code: 'item.not-held', message: `${actor} must hold the ${what} ${id} (it is ${whereIs(rt.world, it)})`, subjects: [actor, id] };
  return it;
}

type OverlayBase = { id: string; actor: string; at: Vec3; level: number; base: string; t: number };

/** Still in place and not re-tasked into motion; refreshes `base` from the holder's activity this tick. */
function stillCheck(rt: Runtime, ex: OverlayBase, verb: string): Diagnostic | null {
  const a = rt.world.entities[ex.actor];
  const act = a.human!.activity;
  const moved = Math.abs(a.pose.p[0] - ex.at[0]) > 1e-6 || Math.abs(a.pose.p[2] - ex.at[2]) > 1e-6 || a.human!.level !== ex.level;
  if (moved || !(STILL_ACTIVITIES.has(act) || act === verb))
    return { code: `${verb}.not-still`, message: `${ex.actor} stopped being still during ${verb} (${moved ? 'moved' : `activity ${act}`})`, subjects: [ex.actor] };
  if (act !== verb) ex.base = act;
  return null;
}
function overlayOn(a: Entity, verb: string, base: string) {
  a.human!.activity = verb;
  a.human!.baseActivity = base;
}
function overlayOff(rt: Runtime, ex: OverlayBase, verb: string) {
  const a = rt.world.entities[ex.actor];
  if (!a?.human) return;
  if (a.human.activity === verb) a.human.activity = ex.base;
  delete a.human.baseActivity;
}
const frameOf = (a: Entity, base: string) => bodyFrame(a, base === 'sit' ? SEAT_DROP : 0);

// serve

type ServeParams = { actor: string; pot: string; bowl: string };
type ServeExec = OverlayBase & { pot: string; bowl: string; bowlHand: Hand; hand: Hand; phase: 'to-pot' | 'to-bowl' | 'back'; from: Vec3; bowlFrom: Vec3 };

/** Shared pots are checked again at the deposit, after other diners may serve. */
function servingContents(pot: Entity, bowl: Entity): Diagnostic | undefined {
  if (pot.foodPreparation && pot.foodPreparation.complete !== true) return {
    code: 'serve.preparation-incomplete', message: `${pot.id} is still being prepared; finish its ingredient deposits and mixing before serving`, subjects: [pot.id],
  };
  if ((bowl.contents?.fraction ?? 0) > 0) return {
    code: 'serve.bowl-not-empty', message: `${bowl.id} still contains food; finish or explicitly preserve it before requesting a full serving`, subjects: [bowl.id],
  };
  if (!pot.contents || pot.contents.fraction < SERVING) return {
    code: 'serve.insufficient-food', message: `${pot.id} has ${pot.contents?.fraction ?? 0} of a pot, but filling ${bowl.id} requires ${SERVING}; the remaining food is preserved`, subjects: [pot.id, bowl.id],
  };
}

export const serve: ActionDef<ServeParams, { bowlHand: Hand }, ServeExec> = {
  verb: 'serve',
  description: `A person holding an empty bowl fills it from a pot within ${BODY_REACH.toFixed(2)} m (on the table or in their other hand): the other hand goes to the pot (${SERVE_PHASES.toPot} s), to the bowl (${SERVE_PHASES.toBowl} s; the bowl becomes full of the pot's food, the pot loses ${SERVING}) and back (${SERVE_PHASES.back} s). Seated or standing still; refused item.out-of-reach, item.not-held, serve.pot-empty, serve.insufficient-food, serve.bowl-not-empty, serve.not-still. Quantity is rechecked at deposit; no partial serving or implicit replacement of existing food.`,
  schema: z.strictObject({ actor: id80, pot: id80, bowl: id80 }),
  reservations: (w, p) => [
    { resource: `hand:${p.actor}:left`, mode: 'exclusive' },
    { resource: `hand:${p.actor}:right`, mode: 'exclusive' },
    // the pot is shared: several people may ladle from it in the same moment (take_item is exclusive)
    { resource: `entity:${p.pot}`, mode: 'shared' },
    { resource: `entity:${p.bowl}`, mode: 'exclusive' },
  ],
  plan(rt, p) {
    const a = personOf(rt, p.actor);
    if ('code' in a) return { ok: false, diagnostic: a };
    const bowl = holding(rt, p.actor, p.bowl, 'bowl');
    if ('code' in bowl) return { ok: false, diagnostic: bowl };
    if (!CONTAINERS.has(bowl.def)) return fail('item.not-container', `${bowl.id} (${bowl.def}) cannot hold food`, [bowl.id]);
    const pot = itemOf(rt, p.pot);
    if ('code' in pot) return { ok: false, diagnostic: pot };
    if (pot.foodPreparation && pot.foodPreparation.complete !== true) {
      return { ok: false, diagnostic: servingContents(pot, bowl)! };
    }
    if (!CONTAINERS.has(pot.def) || !pot.contents || pot.contents.fraction <= 1e-9) return fail('serve.pot-empty', `${pot.id} has no food to serve`, [pot.id]);
    const contents = servingContents(pot, bowl);
    if (contents) return { ok: false, diagnostic: contents };
    const ps = pot.support;
    if (ps?.kind === 'in-hand' && ps.by !== p.actor) return fail('item.held-by', `${pot.id} is held by ${ps.by}`, [p.actor, pot.id, ps.by]);
    if (ps?.kind !== 'in-hand') {
      const d = reachOf(a, pot.pose.p);
      if (d > BODY_REACH)
        return fail('item.out-of-reach', `${p.actor} at (${a.pose.p[0].toFixed(2)}, ${a.pose.p[2].toFixed(2)}) is ${d.toFixed(2)} m from ${pot.id} (${whereIs(rt.world, pot)}); reach ${BODY_REACH.toFixed(2)} m`, [p.actor, pot.id], { at: pot.pose.p });
    }
    const still = stillness(rt, a, 'serve');
    if (still) return { ok: false, diagnostic: still };
    return { ok: true, program: { bowlHand: (bowl.support as { hand: Hand }).hand } };
  },
  start(rt, p, prog, id) {
    const a = rt.world.entities[p.actor];
    const base = a.human!.activity;
    const b = frameOf(a, base);
    const hand = otherHand(prog.bowlHand);
    return {
      id, actor: p.actor, pot: p.pot, bowl: p.bowl, bowlHand: prog.bowlHand, hand, at: [...a.pose.p] as Vec3, level: a.human!.level, base, t: 0, phase: 'to-pot',
      from: handNow(a, hand, b), bowlFrom: handNow(a, prog.bowlHand, b),
    };
  },
  step(rt, ex): StepResult {
    const d = stillCheck(rt, ex, 'serve');
    if (d) { overlayOff(rt, ex, 'serve'); return { status: 'failed', diagnostic: d }; }
    const a = rt.world.entities[ex.actor];
    const pot = rt.world.entities[ex.pot], bowl = rt.world.entities[ex.bowl];
    const b = frameOf(a, ex.base);
    overlayOn(a, 'serve', ex.base);
    const potTop: Vec3 = [pot.pose.p[0], pot.pose.p[1] + CATALOG[pot.def].size[1] + 0.05, pot.pose.p[2]];
    const bowlAt = bowlHand(b);
    const overBowl = rimHand(b, ex.hand);
    const dur = ticks(SERVE_PHASES[ex.phase === 'to-pot' ? 'toPot' : ex.phase === 'to-bowl' ? 'toBowl' : 'back']);
    ex.t++;
    const k = smooth(ex.t / dur);
    let q: Vec3, qb: Vec3;
    if (ex.phase === 'to-pot') { q = lerp3(ex.from, potTop, k); qb = lerp3(ex.bowlFrom, bowlAt, k); }
    else if (ex.phase === 'to-bowl') { q = lerp3(potTop, overBowl, k); qb = bowlAt; }
    else { q = lerp3(overBowl, inHand(rt.world, ex.actor, ex.hand) ? carryHand(b, ex.hand) : restHand(b, ex.hand), k); qb = lerp3(bowlAt, carryHand(b, ex.bowlHand), k); }
    setHand(a, ex.hand, q);
    setHand(a, ex.bowlHand, qb);
    followHand(bowl, qb, a.pose.yaw);
    const other = inHand(rt.world, ex.actor, ex.hand);
    if (other) followHand(other, q, a.pose.yaw);
    if (ex.t < dur) return { status: 'running', phase: ex.phase };
    ex.t = 0;
    if (ex.phase === 'to-pot') { ex.phase = 'to-bowl'; return { status: 'running', phase: 'to-bowl' }; }
    if (ex.phase === 'to-bowl') {
      const contents = servingContents(pot, bowl);
      if (contents) {
        overlayOff(rt, ex, 'serve');
        return { status: 'failed', diagnostic: contents };
      }
      bowl.contents = { food: pot.contents!.food, fraction: 1 };
      pot.contents = { food: pot.contents!.food, fraction: Math.max(0, q6(pot.contents!.fraction - SERVING)) };
      ex.phase = 'back';
      return { status: 'running', phase: 'back' };
    }
    if (!other) setHand(a, ex.hand, undefined);
    overlayOff(rt, ex, 'serve');
    return { status: 'completed', outputs: { bowl: bowl.contents, pot: pot.contents } };
  },
  cancel(rt, ex) {
    overlayOff(rt, ex, 'serve');
    return { ok: true };
  },
  resumable: true,
};

// eat

type EatParams = { actor: string; bowl: string; spoon: string; cycles?: number };
type EatPhase = 'ready' | 'dip' | 'lift' | 'pause' | 'return' | 'lower';
type EatExec = OverlayBase & {
  bowl: string; spoon: string; bowlHand: Hand; spoonHand: Hand; /** cycles asked (0 = until empty) */ max: number; done: number; phase: EatPhase;
  /** Hand points when the ready / lower transition began. */
  fromBowl: Vec3; fromSpoon: Vec3;
};
const NEXT: Record<EatPhase, EatPhase> = { ready: 'dip', dip: 'lift', lift: 'pause', pause: 'return', return: 'dip', lower: 'lower' };

/** Eat-cycle hand points for phase progress k ∈ [0, 1] (exported for tests / renderer previews). */
export function eatHands(b: BodyFrame, spoon: Hand, phase: Exclude<EatPhase, 'ready' | 'lower'>, k: number): { bowl: Vec3; spoon: Vec3 } {
  const rim = rimHand(b, spoon), dip = dipHand(b, spoon), mouth = mouthPoint(b);
  let s: Vec3;
  if (phase === 'dip') s = k < 0.5 ? lerp3(rim, dip, smooth(2 * k)) : lerp3(dip, rim, smooth(2 * k - 1));
  else if (phase === 'lift') s = lerp3(rim, mouth, smooth(k));
  else if (phase === 'pause') s = mouth;
  else s = lerp3(mouth, rim, smooth(k));
  return { bowl: bowlHand(b), spoon: s };
}

export const eat: ActionDef<EatParams, { bowlHand: Hand }, EatExec> = {
  verb: 'eat',
  description: `A seated (or still-standing) person eats from a bowl held in one hand with a spoon in the other: bowl held 0.25 m in front of the chest; each ${EAT_CYCLE} s cycle is dip ${EAT_PHASES.dip} → lift to the mouth ${EAT_PHASES.lift} → pause ${EAT_PHASES.pause} → return ${EAT_PHASES.return} s and takes ${SPOONFUL} of the bowl, until it is empty or \`cycles\` are done. Publishes human.hands every tick. Runs inside sit / gather / converse (activity eat, human.baseActivity = the group's activity). Refused eat.not-still (walking / transitioning), item.not-held, eat.bowl-empty.`,
  schema: z.strictObject({ actor: id80, bowl: id80, spoon: id80, cycles: z.number().int().min(1).max(200).optional() }),
  reservations: (_w, p) => [
    { resource: `hand:${p.actor}:left`, mode: 'exclusive' },
    { resource: `hand:${p.actor}:right`, mode: 'exclusive' },
    { resource: `entity:${p.bowl}`, mode: 'exclusive' },
    { resource: `entity:${p.spoon}`, mode: 'exclusive' },
  ],
  plan(rt, p) {
    const a = personOf(rt, p.actor);
    if ('code' in a) return { ok: false, diagnostic: a };
    const bowl = holding(rt, p.actor, p.bowl, 'bowl');
    if ('code' in bowl) return { ok: false, diagnostic: bowl };
    const spoon = holding(rt, p.actor, p.spoon, 'spoon');
    if ('code' in spoon) return { ok: false, diagnostic: spoon };
    if (!bowl.contents || bowl.contents.fraction <= 1e-9) return fail('eat.bowl-empty', `${bowl.id} is empty; serve it first`, [p.actor, bowl.id]);
    const still = stillness(rt, a, 'eat');
    if (still) return { ok: false, diagnostic: still };
    return { ok: true, program: { bowlHand: (bowl.support as { hand: Hand }).hand } };
  },
  start(rt, p, prog, id) {
    const a = rt.world.entities[p.actor];
    const base = a.human!.activity;
    const b = frameOf(a, base);
    return {
      id, actor: p.actor, bowl: p.bowl, spoon: p.spoon, bowlHand: prog.bowlHand, spoonHand: otherHand(prog.bowlHand), max: p.cycles ?? 0, done: 0,
      at: [...a.pose.p] as Vec3, level: a.human!.level, base, t: 0, phase: 'ready',
      fromBowl: handNow(a, prog.bowlHand, b), fromSpoon: handNow(a, otherHand(prog.bowlHand), b),
    };
  },
  step(rt, ex): StepResult {
    const d = stillCheck(rt, ex, 'eat');
    if (d) { overlayOff(rt, ex, 'eat'); return { status: 'failed', diagnostic: d }; }
    const a = rt.world.entities[ex.actor];
    const bowl = rt.world.entities[ex.bowl], spoon = rt.world.entities[ex.spoon];
    const b = frameOf(a, ex.base);
    overlayOn(a, 'eat', ex.base);
    const dur = ticks(EAT_PHASES[ex.phase]);
    ex.t++;
    const k = ex.t / dur;
    let qb: Vec3, qs: Vec3;
    if (ex.phase === 'ready') {
      qb = lerp3(ex.fromBowl, bowlHand(b), smooth(k));
      qs = lerp3(ex.fromSpoon, rimHand(b, ex.spoonHand), smooth(k));
    } else if (ex.phase === 'lower') {
      qb = lerp3(ex.fromBowl, carryHand(b, ex.bowlHand), smooth(k));
      qs = lerp3(ex.fromSpoon, carryHand(b, ex.spoonHand), smooth(k));
    } else ({ bowl: qb, spoon: qs } = eatHands(b, ex.spoonHand, ex.phase, k));
    setHand(a, ex.bowlHand, qb);
    setHand(a, ex.spoonHand, qs);
    followHand(bowl, qb, a.pose.yaw);
    followHand(spoon, qs, a.pose.yaw);
    if (ex.t < dur) return { status: 'running', phase: ex.phase };
    ex.t = 0;
    if (ex.phase === 'lower') {
      overlayOff(rt, ex, 'eat');
      return { status: 'completed', outputs: { cycles: ex.done, fraction: bowl.contents?.fraction ?? 0 } };
    }
    if (ex.phase === 'dip' && bowl.contents) bowl.contents = { food: bowl.contents.food, fraction: Math.max(0, q6(bowl.contents.fraction - SPOONFUL)) };
    if (ex.phase === 'return') {
      ex.done++;
      if ((ex.max > 0 && ex.done >= ex.max) || !bowl.contents || bowl.contents.fraction <= 1e-9) {
        ex.phase = 'lower';
        ex.fromBowl = qb;
        ex.fromSpoon = qs;
        return { status: 'running', phase: 'lower' };
      }
    }
    ex.phase = NEXT[ex.phase];
    return { status: 'running', phase: ex.phase };
  },
  cancel(rt, ex) {
    overlayOff(rt, ex, 'eat');
    return { ok: true };
  },
  resumable: true,
};

export const ITEM_ACTIONS: ActionDef[] = [takeItem, putItem, serve, eat, holdItems, watering as unknown as ActionDef];
