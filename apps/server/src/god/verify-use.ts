// Authoritative, temporary resident probes. No HTTP, model, clock acceleration,
// invitation or owner credential is involved in verification.
import {z} from 'zod';
import type {Entity} from '@sim/world-compiler';
import type {WorldHost} from '../world.ts';
import type {Souls} from '../souls.ts';
import type {SoulRow} from '../db.ts';
import type {EdgeSoul} from '../edge/contract.ts';
import type {EdgeLedger} from '../edge/ledger/ledger.ts';
import {inPoly} from '../edge/ledger/places.ts';
import {engineBridges, type EngineBridge} from './engine-bridge.ts';
import type {GodMode} from './god.ts';
import {runQuery} from './query.ts';
import {isVerificationProbe} from '../verification-probe.ts';

type V2 = [number, number];
type Use = 'enter' | 'sit';
export const verifyCodes = ['verify.no-target', 'verify.no-seat', 'verify.timeout', 'verify.busy', 'verify.refused'] as const;
export const verifyUseSchema = z.object({
  target: z.string().min(1).max(200),
  uses: z.array(z.enum(['enter', 'sit'])).min(1).max(2).refine(a => new Set(a).size === a.length, 'uses must be unique').default(['enter', 'sit']),
  from: z.union([z.string().min(1).max(200), z.tuple([z.number().finite(), z.number().finite()])]).optional(),
  seat: z.string().min(1).max(200).optional(),
  timeoutMs: z.number().int().min(1).max(180_000).default(150_000),
}).strict();
type Input = z.infer<typeof verifyUseSchema>;
type Reason = {code: typeof verifyCodes[number]; message: string; engineCode?: string};
type UseResult = {use: Use; ok: boolean; door?: string; crossing?: {at: V2; distToDoor?: number}; room?: string; seat?: string; occupant?: string; distanceToSlot?: number; reason?: Reason};
export type VerifyReceipt = {ok: boolean; target: string; uses: UseResult[]; probe: {removed: boolean}; ms: number; notes: string[]; reason?: Reason};
type Description = {id: string; path: string; rooms: {id: string; floor: number; polygon: V2[]}[]; slots: {id: string; kind: string; p: [number, number, number]; capacity: number; used: number; occupants: string[]}[]};
type Door = {id: string; at: V2; outward: V2; level: number};
type Body = {pose: {p: [number, number, number]}; human?: {activity?: string; level?: number}};
type Engine = {world: {entities: Record<string, Body>}; standableNearV1(at: V2, level?: number, except?: string, minClear?: number, maxRing?: number): V2 | null};
const active = new WeakSet<WorldHost>();
const round = (n: number) => Math.round(n * 1000) / 1000;
const dist = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
class Failure extends Error {
  reason: Reason;
  constructor(code: Reason['code'], message: string, engineCode?: string) { super(message); this.reason = {code, message, ...(engineCode ? {engineCode} : {})}; }
}
const reasonOf = (e: unknown): Reason => e instanceof Failure ? e.reason : {code: 'verify.refused', message: e instanceof Error ? e.message : String(e), ...((e as {code?: string})?.code ? {engineCode: (e as {code: string}).code} : {})};

export class VerifyUse {
  readonly host: WorldHost; readonly souls: Souls; readonly god: GodMode; readonly edge?: EdgeLedger;
  constructor(host: WorldHost, souls: Souls, god: GodMode, edge?: EdgeLedger) { this.host = host; this.souls = souls; this.god = god; this.edge = edge; }

  async run(raw: unknown): Promise<VerifyReceipt> {
    const started = performance.now();
    const receipt: VerifyReceipt = {ok: false, target: typeof (raw as Input)?.target === 'string' ? (raw as Input).target : '', uses: [], probe: {removed: true}, ms: 0, notes: []};
    const parsed = verifyUseSchema.safeParse(raw);
    const fail = (reason: Reason, uses: Use[] = []) => { receipt.reason = reason; receipt.uses = uses.map(use => ({use, ok: false, reason})); receipt.ms = round(performance.now() - started); return receipt; };
    if (!parsed.success) return fail({code: 'verify.refused', message: parsed.error.issues.map(i => i.message).join('; '), engineCode: 'invalid'});
    const input = parsed.data;
    if (active.has(this.host) || [...this.host.minds.keys()].some(isVerificationProbe)) return fail({code: 'verify.busy', message: 'This world already has a verifier probe.'}, input.uses);
    active.add(this.host);
    let probe: SoulRow | undefined, listener: WorldHost['listeners'][number] | undefined;
    const deadline = started + input.timeoutMs;
    try {
      const target = this.god.model.get(input.target);
      if (!target) throw new Failure('verify.no-target', `No such target: ${input.target}`);
      receipt.target = this.god.model.pathOf(target.id);
      const bridge = engineBridges.get(this.god.model);
      if (!bridge || !this.edge) throw new Failure('verify.refused', 'The resident engine bridge and edge ledger are required.', 'unavailable');
      const engine = this.host.engine as unknown as Engine;
      const desc = this.describe(target.id), footprint = this.footprint(target), doors = this.doors(target);
      const version = target.v;
      const unchanged = () => { if (this.god.model.entities.get(target.id)?.v !== version) throw new Failure('verify.refused', 'The target changed during verification; retry against its current geometry.', 'revision.stale'); };
      const inside = (p: V2, level: number) => desc.rooms.length
        ? desc.rooms.find(r => (bridge.nav.thing(`${receipt.target}/${r.id}`)?.level ?? r.floor) === level && inPoly(p[0], p[1], r.polygon))?.id
        : level === (bridge.nav.thing(receipt.target)?.level ?? 0) && inPoly(p[0], p[1], footprint) ? receipt.target : undefined;
      const start = this.start(input, target, footprint, doors, bridge, engine);
      const created = this.souls.createVerificationProbe(); probe = created.soul;
      receipt.probe.removed = false;
      // Accept the normal lifecycle queue without advancing the world's clock.
      this.host.drainInputs(); await created.ready;
      const soul: EdgeSoul = {soulId: probe.id, entityId: probe.entity_id, name: probe.name, owner: probe.owner};
      const relocated = this.host.enqueue('edge-relocate', `verify-use:${probe.id}`, {soulId: probe.id, entityId: probe.entity_id, to: start, why: 'verifier probe: start use verification'});
      this.host.drainInputs(); await relocated;
      const body = () => engine.world.entities[soul.entityId];
      if (!body()) throw new Failure('verify.refused', 'Probe birth produced no engine body.', 'not-in-world');
      const position = (): V2 => [body().pose.p[0], body().pose.p[2]];
      if (dist(position(), start) > 6.4) throw new Failure('verify.refused', 'The engine could not relocate the probe to the requested start.', 'route.no-start');
      if (dist(position(), start) > 0.05) receipt.notes.push(`The engine chose clear standing ground ${round(dist(position(), start))} m from the requested start.`);
      let previous = position(), previousInside = inside(previous, body().human?.level ?? 0);
      let crossing: UseResult['crossing'], crossingDoor: string | undefined;
      listener = {afterTick: () => {
        if (!body()) return;
        const p = position(), room = inside(p, body().human?.level ?? 0);
        if (!crossing && !previousInside && room) {
          // Refine the first outside→inside engine step to the polygon boundary.
          let lo = 0, hi = 1;
          for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2, q: V2 = [previous[0] + (p[0] - previous[0]) * mid, previous[1] + (p[1] - previous[1]) * mid]; if (inside(q, body().human?.level ?? 0)) hi = mid; else lo = mid; }
          const at: V2 = [round(previous[0] + (p[0] - previous[0]) * hi), round(previous[1] + (p[1] - previous[1]) * hi)];
          const floor = desc.rooms.find(r => r.id === room)?.floor ?? 0;
          const nearest = doors.filter(d => d.level === floor).sort((a, b) => dist(a.at, at) - dist(b.at, at))[0];
          crossing = {at, ...(nearest ? {distToDoor: round(dist(nearest.at, at))} : {})}; crossingDoor = nearest?.id;
        }
        previous = p; previousInside = room;
      }};
      this.host.listeners.push(listener);
      receipt.notes.push(`Temporary ${probe.name}; birth and retirement are journaled under ${probe.id}.`, 'Actions use the existing edge ledger; positions and seat occupants are engine reads.');
      for (const use of (['enter', 'sit'] as const).filter(use => input.uses.includes(use))) {
        const result: UseResult = {use, ok: false}; receipt.uses.push(result);
        try {
          this.checkTime(deadline);
          unchanged();
          if (use === 'enter') {
            if (previousInside) throw new Failure('verify.refused', 'The start position is already inside; no entry crossing can be proved.', 'verify.start-inside');
            // Prefer a real room goal: a closed building walk can stop outside.
            const roomRef = desc.rooms.map(r => `${receipt.target}/${r.id}`).find(ref => this.edge!.capabilities(soul).some(c => c.id === `walk:${ref}`));
            await this.action(soul, `walk:${roomRef ?? receipt.target}`, deadline);
            unchanged();
            const room = inside(position(), body().human?.level ?? 0);
            result.ok = !!room && !!crossing;
            if (room) result.room = room;
            if (crossing) result.crossing = crossing;
            if (crossingDoor) result.door = crossingDoor;
            if (!result.ok) throw new Failure('verify.refused', 'The walk finished without a proved crossing and engine position inside the target.', 'route.outside');
          } else {
            const seat = this.seat(input.seat, target, position());
            result.seat = this.god.model.pathOf(seat.id);
            await this.action(soul, `sit:${seat.id}`, deadline, () => {
              const obs = this.edge!.observe(soul, new Set()) as {self: {activity: string}};
              const slots = this.describe(seat.id).slots.filter(s => s.kind === 'seat' && s.occupants.includes(soul.name));
              const distance = slots.length ? Math.min(...slots.map(s => dist(position(), [s.p[0], s.p[2]]))) : Infinity;
              if (Number.isFinite(distance)) result.distanceToSlot = round(distance);
              if (slots.length) result.occupant = soul.name;
              return obs.self.activity === 'sit' && body().human?.activity === 'sit' && slots.length > 0 && distance <= 0.6;
            });
            unchanged();
            result.ok = true;
          }
        } catch (e) { result.ok = false; result.reason = reasonOf(e); }
      }
    } catch (e) { const reason = reasonOf(e); receipt.reason = reason; for (const use of input.uses) if (!receipt.uses.some(r => r.use === use)) receipt.uses.push({use, ok: false, reason}); }
    finally {
      if (listener) { const i = this.host.listeners.indexOf(listener); if (i >= 0) this.host.listeners.splice(i, 1); }
      if (probe) {
        try {
          const retired = this.souls.retire(probe); this.host.drainInputs(); await retired;
          // Native retirement safely releases a sit controller over subsequent
          // ticks. Wait for that normal path; never delete a supported body.
          const cleanupDeadline = performance.now() + 5000;
          while (this.host.engine.world.entities[probe.entity_id] && performance.now() < cleanupDeadline) await this.wait(cleanupDeadline);
          if (!this.host.engine.world.entities[probe.entity_id]) engineBridges.get(this.god.model)?.bodyRetired({entityId: probe.entity_id});
          receipt.probe.removed = !this.host.minds.has(probe.id) && !this.host.engine.world.entities[probe.entity_id] && !this.god.model.entities.has(probe.entity_id);
          if (!receipt.probe.removed) receipt.notes.push('Probe retirement was accepted but removal could not be confirmed.');
        } catch (e) { receipt.probe.removed = false; receipt.notes.push(`Probe cleanup failed: ${reasonOf(e).message}`); }
      }
      if (receipt.probe.removed) active.delete(this.host);
      else if (probe) {
        // A paused world may still owe native physical cleanup. Keep it busy
        // until the normal engine tick removes the retired probe.
        const entityId = probe.entity_id, cleanup = {afterTick: () => {
          if (this.host.engine.world.entities[entityId]) return;
          engineBridges.get(this.god.model)?.bodyRetired({entityId});
          if (this.god.model.entities.has(entityId)) return;
          active.delete(this.host); const i = this.host.listeners.indexOf(cleanup); if (i >= 0) this.host.listeners.splice(i, 1);
        }};
        this.host.listeners.push(cleanup);
      }
      receipt.ok = receipt.uses.length > 0 && receipt.uses.every(r => r.ok) && receipt.probe.removed;
      receipt.ms = round(performance.now() - started);
    }
    return receipt;
  }

  private describe(ref: string) { return runQuery(this.god.model, {describe: ref}).describe as Description; }
  private footprint(e: Entity): V2[] {
    if (e.shape && 'area' in e.shape) return e.shape.area;
    const m = this.god.model, def = m.resolvedDef(e.def)!, baked = m.bake(def, e.params ?? {}, e.seed ?? 0, e.shape);
    return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as V2[]).map(([x, z]) => this.worldPoint(e, [x * baked.box[0] / 2, z * baked.box[2] / 2]));
  }
  private worldPoint(e: Entity, [x, z]: V2): V2 {
    const p = this.god.model.worldPose(e), c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    return [p.x + (x * c + z * s) * p.s, p.z + (-x * s + z * c) * p.s];
  }
  private doors(e: Entity): Door[] {
    const m = this.god.model, def = m.resolvedDef(e.def)!, baked = m.bake(def, e.params ?? {}, e.seed ?? 0, e.shape), wp = m.worldPose(e);
    return (baked.openings ?? []).filter(o => o.kind === 'door' && !baked.rooms?.some(r => r.floor === o.level && inPoly(o.at[0] + Math.sin(o.yaw), o.at[1] + Math.cos(o.yaw), r.polygon as V2[])))
      .map(o => ({id: o.id, at: this.worldPoint(e, o.at as V2), outward: [Math.sin(wp.yaw + o.yaw), Math.cos(wp.yaw + o.yaw)] as V2, level: o.level ?? 0}));
  }
  private start(input: Input, target: Entity, footprint: V2[], doors: Door[], bridge: EngineBridge, engine: Engine): V2 {
    if (input.from) {
      if (Array.isArray(input.from)) return input.from;
      const e = this.god.model.get(input.from), thing = bridge.nav.thing(input.from);
      if (e) { const p = this.god.model.worldPose(e); return [p.x, p.z]; }
      if (thing) return thing.at;
      throw new Failure('verify.no-target', `No such start reference: ${input.from}`);
    }
    const exterior = (p: V2) => !inPoly(p[0], p[1], footprint);
    const groundDoors = doors.filter(d => d.level === 0);
    const main = groundDoors.find(d => /front|main|entr/.test(d.id)) ?? groundDoors[0];
    if (main) for (const distance of [2.5, 3.5, 5]) {
      const p: V2 = [main.at[0] + main.outward[0] * distance, main.at[1] + main.outward[1] * distance], q = engine.standableNearV1(p, 0, undefined, 0.35, 4);
      if (q && exterior(q)) return q;
    }
    const p = this.god.model.worldPose(target), candidates: V2[] = [];
    for (let i = 0; i < footprint.length; i++) {
      const a = footprint[i], b = footprint[(i + 1) % footprint.length];
      const count = Math.max(1, Math.min(128, Math.ceil(dist(a, b))));
      for (let n = 0; n <= count; n++) {
        const at: V2 = [a[0] + (b[0] - a[0]) * n / count, a[1] + (b[1] - a[1]) * n / count];
        const q = engine.standableNearV1(at, 0, undefined, 0.35, 8); if (q && exterior(q)) candidates.push(q);
      }
    }
    candidates.sort((a, b) => dist(a, [p.x, p.z]) - dist(b, [p.x, p.z]) || a[0] - b[0] || a[1] - b[1]);
    if (candidates[0]) return candidates[0];
    throw new Failure('verify.refused', 'No walkable start outside the target footprint.', 'route.no-start');
  }
  private seat(ref: string | undefined, target: Entity, at: V2): Entity {
    const m = this.god.model, ids = new Set([target.id, ...m.subtree(target.id)]);
    const explicit = ref ? m.get(ref) : undefined;
    if (ref && (!explicit || !ids.has(explicit.id))) throw new Failure('verify.no-seat', `Seat ${ref} is not in the target subtree.`);
    const candidates = (explicit ? [explicit] : [...ids].map(id => m.entities.get(id)!)).flatMap(e => {
      const slots = this.describe(e.id).slots.filter(s => s.kind === 'seat' && s.used < s.capacity);
      return slots.length ? [{e, d: Math.min(...slots.map(s => dist(at, [s.p[0], s.p[2]])))}] : [];
    }).sort((a, b) => a.d - b.d || a.e.id.localeCompare(b.e.id));
    if (!candidates[0]) throw new Failure('verify.no-seat', 'No free seat slot in the target subtree.');
    return candidates[0].e;
  }
  private checkTime(deadline: number) { if (performance.now() >= deadline) throw new Failure('verify.timeout', 'Verification reached its real-time deadline.'); }
  private async action(soul: EdgeSoul, capability: string, deadline: number, success?: () => boolean) {
    this.checkTime(deadline);
    let settled = false, outcome: Awaited<ReturnType<EdgeLedger['act']>> | undefined, fault: unknown;
    // The act promise may await a normal sequencer acceptance. Keep the wait
    // bounded even when the world is paused; retirement drains queued inputs.
    void this.edge!.act(soul, {capability, ...(success ? {params: {seconds: 600}} : {})}).then(r => {outcome = r; settled = true;}, e => {fault = e; settled = true;});
    while (!settled) { this.checkTime(deadline); await this.wait(deadline); }
    if (fault) throw fault;
    if (!outcome?.accepted) throw new Failure('verify.refused', outcome?.reason ?? 'The edge action was refused.', outcome?.code);
    for (;;) {
      this.checkTime(deadline);
      const receipt = this.edge!.receipt(soul.soulId, outcome.receipt.id)!;
      if (receipt.phase === 'failed' || receipt.phase === 'replaced') throw new Failure('verify.refused', receipt.reason ?? 'The engine action failed.', receipt.code ?? receipt.phase);
      if (success?.()) return;
      if (receipt.phase === 'completed') {
        if (!success) return;
        throw new Failure('verify.refused', 'Sit finished without engine sit activity, the probe as occupant, and slot distance ≤0.6 m.', 'seat.unconfirmed');
      }
      await this.wait(deadline);
    }
  }
  private wait(deadline: number) { return new Promise<void>(resolve => setTimeout(resolve, Math.max(1, Math.min(20, deadline - performance.now())))); }
}
