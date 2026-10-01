// The Mars engine behind Sim's engine contract.
//
// The shell speaks a small BODY LANGUAGE (walk_to, sit, stand, rest, wave,
// converse, gather, perform, ambient_wander): what one actor's body does. This
// adapter lowers each of those to Mars verbs, runs an actor's steps one after
// another, and reports progress. Raw Mars verbs are also reachable, as
// `mars:<verb>`, for vocabulary that belongs to a Mars world (serve, eat, carry…).
//
// Three rules it enforces, which the Mars runtime leaves to its caller:
//  1. One actor, one program. Starting a program releases whatever held that actor.
//  2. Joint staging is borrowed. A Mars verb that takes several actors (converse)
//     borrows the others' bodies only while they are free; their own program takes
//     them back at any time, and the borrower treats that as the scene ending.
//  3. Feasibility is asked first (verb.plan), because in Mars even a refused
//     instruction pulls a person out of what they were doing.
import { hashOf, physicalView, type ActionRecord, type ActivityOption, type Anchor, type ChangeEvent, type Engine, type EngineFactory, type EngineSnapshot, type PathCommit, type PoseSample, type Program, type ProgramEvent, type RuntimeEvent, type RuntimeView, type Vec3, type VerbInfo, type WorldState } from '@sim/engine-contract';
import { loadMars, type Mars } from './load.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TPS = 20;
const KEY_EVERY = 5;                       // ticks between broadcast keyframes for a moving body (4 per second)
const SETTLED = new Set(['gathered', 'occupied', 'talking']); // phases in which a Mars hold has arrived and simply continues
const RELEASE_TIMEOUT = 15 * TPS;          // how long a program waits for its actor to be let go
const KEEP_RECORDS = 120 * TPS;            // finished Mars action records are kept this long, then forgotten
const SNAPSHOT_FORMAT = 'sim-mars-snapshot/1';

type Diag = { code: string; message: string };
type Op = { verb: string; params: Record<string, unknown>; settle: 'done' | 'held'; soft?: boolean; raw?: boolean } | { wait: number };
type Prog = {
  id: string; actor: string; label: string; steps: Program['steps'];
  index: number; started: boolean; since: number;
  ops: Op[]; action?: string; settle?: 'done' | 'held'; soft?: boolean; until?: number;
};
export type MarsWorldConfig = { scene: 'proving-ground'; arrival: [number, number]; arrivalPlace: string; reference: [number, number]; grounds: { id: string; name: string } };
const PROVING_GROUND: MarsWorldConfig = { scene: 'proving-ground', arrival: [-24, -10.5], arrivalPlace: 'lawn', reference: [-24, -8], grounds: { id: 'grounds', name: 'the grounds' } };

const secs = (v: unknown, d: number) => Math.round(Math.min(3600, Math.max(0.5, typeof v === 'number' ? v : d)) * TPS);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const num = { type: 'number' }, str = { type: 'string' };
const ref = { anyOf: [str, { type: 'array', items: num, minItems: 2, maxItems: 2 }] };
/** The body language, as the card grammar and agents see it. The actor is always implied. */
export const BODY_VERBS: VerbInfo[] = [
  { verb: 'walk_to', description: 'Walk to a thing or a point, stopping `standoff` metres short of it.', inputSchema: { type: 'object', properties: { to: ref, standoff: num }, required: ['to'] } },
  { verb: 'sit', description: 'Go to a free seat of a fixture (a bench, a chair) and sit there for a number of seconds; stays seated afterwards.', inputSchema: { type: 'object', properties: { on: str, seconds: num }, required: ['on'] } },
  { verb: 'stand', description: 'Stand up, leaving a seat or a place in a gathering.', inputSchema: { type: 'object', properties: {} } },
  { verb: 'rest', description: 'Stay as you are (seated if sitting) for a number of seconds.', inputSchema: { type: 'object', properties: { seconds: num } } },
  { verb: 'wave', description: 'Turn to face someone or something for a moment.', inputSchema: { type: 'object', properties: { at: str, seconds: num } } },
  { verb: 'converse', description: 'Stand in conversation with a nearby person for a number of seconds.', inputSchema: { type: 'object', properties: { with: str, seconds: num }, required: ['with'] } },
  { verb: 'gather', description: 'Take a place at a fixture (a campfire, a bench) or in a place with an audience layout, and stay for a number of seconds.', inputSchema: { type: 'object', properties: { at: str, seconds: num }, required: ['at'] } },
  { verb: 'perform', description: 'Perform where you stand for a number of seconds.', inputSchema: { type: 'object', properties: { what: str, seconds: num } } },
  { verb: 'ambient_wander', description: 'Stroll between nearby points, pausing, for a number of seconds within a radius in metres.', inputSchema: { type: 'object', properties: { seconds: num, radius: num } } },
];
const BODY = new Set(BODY_VERBS.map((v) => v.verb));

const inPoly = (x: number, z: number, poly: [number, number][]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const bucket = (m: number): 'here' | 'close' | 'near' | 'far' => (m < 2.5 ? 'here' : m < 9 ? 'close' : m < 28 ? 'near' : 'far');

export class MarsEngine implements Engine {
  readonly dt = 1 / TPS;
  readonly schema: string;
  readonly rulesVersion: string;
  readonly runtime: RuntimeView;
  private m: Mars; private rt: any; private cfg: MarsWorldConfig;
  private registry: Map<string, any>;
  private programs = new Map<string, Prog>();
  private byActor = new Map<string, string>();
  private nextProg = 1;
  private cursor = 0;
  private keys = new Map<string, PoseSample>();      // last broadcast keyframe per body
  private acts = new Map<string, string>();          // last broadcast activity per body
  private ons = new Map<string, string | null>();
  private leaving: string[] = [];                    // bodies to remove once nothing holds them
  private out: { paths: PathCommit[]; changes: ChangeEvent[]; programs: ProgramEvent[] } = { paths: [], changes: [], programs: [] };

  constructor(m: Mars, rt: any, cfg: MarsWorldConfig, saved?: { programs: Prog[]; nextProg: number; leaving: string[] }) {
    this.m = m; this.rt = rt; this.cfg = cfg; this.registry = rt.registry;
    this.schema = rt.world.schema; this.rulesVersion = `sim-mars/1+${m.rulesVersion}`;
    if (saved) { for (const p of saved.programs) { this.programs.set(p.id, p); this.byActor.set(p.actor, p.id); } this.nextProg = saved.nextProg; this.leaving = saved.leaving; }
    this.cursor = rt.events.length;
    const self = this;
    this.runtime = {
      get tick() { return rt.tick as number; },
      get records() { return rt.records as Map<string, ActionRecord>; },
      get violations() { return rt.violations as { tick: number; code: string; message: string }[]; },
      liveIds: () => [...(rt.records as Map<string, any>).values()].filter((r) => self.rt.isActive(r.id)).map((r) => r.id as string).sort(),
    };
  }

  get world(): WorldState { return this.rt.world as WorldState; }
  private get ents(): Record<string, any> { return this.rt.world.entities; }
  describeVerbs(): VerbInfo[] {
    return [...BODY_VERBS, ...this.m.describeVerbs(this.registry).map((v) => ({ ...v, verb: `mars:${v.verb}`, description: `[Mars verb] ${v.description}`, scope: 'world' as const }))];
  }
  /** The world plus the adapter's own state (which program each actor is in), since both decide what happens next. */
  stateHash(): string { return hashOf({ w: this.rt.stateHash(), p: [...this.programs.values()], l: this.leaving }); }
  physicalHash(): string { return hashOf(physicalView(this.world)); }

  // ------------------------------------------------------------------ tick
  step() {
    this.rt.step();
    const tick: number = this.rt.tick;
    for (const p of [...this.programs.values()]) this.advance(p);
    if (this.leaving.length) this.leaving = this.leaving.filter((id) => !this.tryRemove(id));
    // What changed, for broadcast: an activity change is an event; movement is a keyframe every KEY_EVERY ticks.
    for (const id of Object.keys(this.ents)) {
      const e = this.ents[id]; if (e.kind !== 'human') continue;
      const act: string = e.human.activity;
      if (this.acts.get(id) !== act) { this.acts.set(id, act); this.out.changes.push([tick, id, 'activity', act]); }
      const on: string | null = e.human.on ?? null;
      if ((this.ons.get(id) ?? null) !== on) { this.ons.set(id, on); this.out.changes.push([tick, id, 'on', on]); }
      if (tick % KEY_EVERY !== 0 && this.keys.has(id)) continue;
      const now = this.poseSampleOf(id), last = this.keys.get(id);
      if (last && (last[1] !== now[1] || last[3] !== now[3] || last[4] !== now[4])) this.out.paths.push({ entity: id, startTick: last[0], speed: 0, waypoints: [last, now], activity: act, actionId: e.human.task ?? '' });
      this.keys.set(id, now);
    }
    const events = this.rt.events.slice(this.cursor) as RuntimeEvent[];
    const out = { ...this.out, events };
    this.out = { paths: [], changes: [], programs: [] };
    // Bound memory. Mars keeps every event and record for ever, which suits a bounded rehearsal and not a world that never stops.
    if (this.rt.events.length > 20000) this.rt.events.splice(0, this.rt.events.length - 1000);
    this.cursor = this.rt.events.length;
    if (tick % 600 === 0) {
      const parents = new Set<string>(); for (const r of this.rt.records.values()) if (r.parent && this.rt.isActive(r.id)) parents.add(r.parent);
      for (const [id, r] of this.rt.records) if (r.endedTick !== undefined && r.endedTick < tick - KEEP_RECORDS && !parents.has(id)) this.rt.records.delete(id);
    }
    return out;
  }

  private emit(p: Prog, kind: ProgramEvent['kind'], d?: Diag) {
    this.out.programs.push({ tick: this.rt.tick, id: p.id, actor: p.actor, kind, step: kind === 'step' ? p.index : -1, ...(d ? { code: d.code, message: d.message } : {}) });
  }
  private end(p: Prog, kind: 'completed' | 'failed' | 'cancelled', d?: Diag) {
    this.programs.delete(p.id); if (this.byActor.get(p.actor) === p.id) this.byActor.delete(p.actor);
    this.emit(p, kind, d);
  }
  private holders(actor: string): string[] { return this.rt.holder(`actor:${actor}`) as string[]; }
  /** Ask whatever holds this actor to let go. Returns true once nothing does (a seated person takes a moment to stand). */
  private release(actor: string, why: Diag): boolean {
    for (const h of this.holders(actor)) this.rt.cancel(h, { code: why.code, message: why.message });
    return this.holders(actor).length === 0;
  }

  /** Move a program forward as far as it can go this tick. */
  private advance(p: Prog) {
    const tick: number = this.rt.tick;
    for (let guard = 0; guard < 12; guard++) {
      if (!this.ents[p.actor]) return this.end(p, 'cancelled', { code: 'actor.removed', message: 'the actor is gone' });
      if (!p.started) {
        if (!this.release(p.actor, { code: 'program.replaced', message: `replaced by ${p.label}` })) {
          if (tick - p.since > RELEASE_TIMEOUT) return this.end(p, 'failed', { code: 'actor.busy', message: 'the actor was not released in time' });
          return;
        }
        p.started = true; this.emit(p, 'step');
        const ops = this.lower(p, p.steps[0]); if (!Array.isArray(ops)) return this.end(p, 'failed', ops);
        p.ops = ops;
      }
      if (p.until !== undefined) { if (tick < p.until) return; p.until = undefined; }
      if (p.action) {
        const rec = this.rt.records.get(p.action);
        if (rec) {
          if (rec.status === 'failed') { if (!p.soft) return this.end(p, 'failed', { code: rec.diagnostic?.code ?? 'action.failed', message: rec.diagnostic?.message ?? 'failed' }); }
          else if (rec.status === 'cancelled') { if (!p.soft) return this.end(p, 'failed', { code: rec.diagnostic?.code ?? 'action.interrupted', message: rec.diagnostic?.message ?? 'interrupted' }); }
          else if (rec.status !== 'completed' && !(p.settle === 'held' && SETTLED.has(rec.phase))) return; // still under way
        }
        p.action = undefined; p.settle = undefined; p.soft = undefined;
      }
      const op = p.ops.shift();
      if (!op) {
        p.index++;
        if (p.index >= p.steps.length) return this.end(p, 'completed');
        this.emit(p, 'step');
        const ops = this.lower(p, p.steps[p.index]); if (!Array.isArray(ops)) return this.end(p, 'failed', ops);
        p.ops = ops; continue;
      }
      if ('wait' in op) { p.until = tick + op.wait; continue; }
      // Anything that needs the body free (all but standing up and raw Mars verbs, which know what they need) first leaves its seat or circle.
      if (op.verb !== 'stand' && !op.raw && this.holders(p.actor).length) {
        if (op.verb === 'face') continue;                                        // not worth standing up for
        if (!this.release(p.actor, { code: 'program.next-step', message: 'moving on' })) { p.ops.unshift(op); return; }
      }
      const rec = this.rt.submit(op.verb, op.params);
      if (rec.status === 'failed') { if (op.soft) continue; return this.end(p, 'failed', { code: rec.diagnostic?.code ?? 'action.failed', message: rec.diagnostic?.message ?? 'refused' }); }
      p.action = rec.id; p.settle = op.settle; p.soft = op.soft;
    }
  }

  // ------------------------------------------------------------------ lowering
  private pos(id: string): [number, number] | null { const e = this.ents[id]; return e ? [e.pose.p[0], e.pose.p[2]] : null; }
  private pointOf(to: unknown): [number, number] | null {
    if (Array.isArray(to) && typeof to[0] === 'number' && typeof to[1] === 'number') return [to[0], to[1]];
    if (typeof to !== 'string') return null;
    const p = this.pos(to); if (p) return p;
    const r = this.rt.world.regions[to]; if (r) return centroid(r.polygon);
    return null;
  }
  private plan(verb: string, params: unknown): Diag | null {
    const def = this.registry.get(verb); if (!def) return { code: 'action.unknown-verb', message: `no action verb "${verb}"` };
    const parsed = def.schema.safeParse(params); if (!parsed.success) return { code: 'action.invalid-params', message: parsed.error.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; ') };
    const r = def.plan(this.rt, parsed.data);
    return r.ok ? null : { code: r.diagnostic.code, message: r.diagnostic.message };
  }
  /** A reachable standing point `standoff` metres from a target, on the side the actor comes from if possible. 'here' if already there. */
  private goalNear(actor: string, to: unknown, standoff: number): { x: number; z: number } | 'here' | Diag {
    const me = this.pos(actor)!, t = this.pointOf(to);
    if (!t) return { code: 'target.unknown', message: `nothing to walk to: ${JSON.stringify(to)}` };
    const dx = me[0] - t[0], dz = me[1] - t[1], d = Math.hypot(dx, dz);
    const isBody = typeof to === 'string' && !!this.ents[to];
    const off = Math.max(standoff, isBody ? 0.9 : 0);
    if (d <= off + 0.4) return 'here';
    const base = Math.atan2(dz, dx);
    let last: Diag = { code: 'route.unreachable', message: 'no reachable standing point near the target' };
    for (const turn of off === 0 ? [0] : [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI]) {
      const x = r3(t[0] + Math.cos(base + turn) * off), z = r3(t[1] + Math.sin(base + turn) * off);
      const no = this.plan('walk_to', { actor, x, z });
      if (!no) return { x, z };
      last = no;
    }
    return last;
  }
  private free(id: string): boolean { return !!this.ents[id] && this.holders(id).length === 0 && !this.byActor.has(id); }

  /** One body-language step → the Mars actions and waits that depict it, decided when the step begins. */
  private lower(p: Prog, step: { verb: string; params: Record<string, unknown> }): Op[] | Diag {
    const me = p.actor, a = step.params ?? {};
    if (step.verb.startsWith('mars:')) {
      const verb = step.verb.slice(5), def = this.registry.get(verb);
      if (!def) return { code: 'action.unknown-verb', message: `no action verb "${verb}"` };
      const shape = (this.m.describeVerbs(new Map([[verb, def]]))[0].inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
      return [{ verb, params: 'actor' in shape && !('actor' in a) ? { ...a, actor: me } : a, settle: 'held', raw: true }];
    }
    switch (step.verb) {
      case 'walk_to': {
        const g = this.goalNear(me, a.to, typeof a.standoff === 'number' ? a.standoff : 0);
        if (g === 'here') return [];
        if ('code' in g) return g;
        const ops: Op[] = [{ verb: 'walk_to', params: { actor: me, x: g.x, z: g.z }, settle: 'done' }];
        if (typeof a.to === 'string' && this.ents[a.to]) ops.push({ verb: 'face', params: { actor: me, target: { entity: a.to } }, settle: 'done', soft: true });
        return ops;
      }
      case 'rest': return [{ wait: secs(a.seconds, 60) }];
      case 'perform': return [{ wait: secs(a.seconds, 30) }];
      case 'wave': return [...(typeof a.at === 'string' && this.ents[a.at] ? [{ verb: 'face', params: { actor: me, target: { entity: a.at } }, settle: 'done', soft: true } as Op] : []), { wait: secs(a.seconds, 2) }];
      case 'converse': {
        const other = String(a.with ?? ''), n = secs(a.seconds, 30);
        if (!this.ents[other]) return { code: 'target.unknown', message: `nobody to talk with: ${other}` };
        // A conversation circle borrows the other body only if it is free; otherwise this actor turns to them and talks from where it stands.
        if (this.free(other) && !this.plan('converse', { actors: [me, other], duration: n / TPS })) return [{ verb: 'converse', params: { actors: [me, other], duration: n / TPS }, settle: 'done', soft: true }];
        return [{ verb: 'face', params: { actor: me, target: { entity: other } }, settle: 'done', soft: true }, { wait: n }];
      }
      case 'gather': {
        // `at` may be a fixture, a Mars region, or a point (then the region with an audience layout around that point, if any).
        const n = secs(a.seconds, 120), pt = this.pointOf(a.at);
        const e = typeof a.at === 'string' ? this.ents[a.at] : undefined;
        const region = typeof a.at === 'string' && this.rt.world.regions[a.at] ? a.at : !e && pt ? Object.keys(this.rt.world.regions).sort().find((id) => inPoly(pt[0], pt[1], this.rt.world.regions[id].polygon)) : undefined;
        const tries: Op[] = e ? [...(e.def === 'campfire' ? [{ verb: 'campfire_circle', params: { actors: [me], fire: e.id }, settle: 'held' } as Op] : []), { verb: 'gather', params: { actors: [me], fixture: e.id }, settle: 'held' }]
          : region ? [{ verb: 'gather', params: { actors: [me], region }, settle: 'held' }] : [];
        for (const op of tries) if ('verb' in op && !this.plan(op.verb, op.params)) return [op, { wait: n }];
        // No place to take (a full bench, a spot with no layout): stand near it instead.
        const g = this.goalNear(me, a.at, 2);
        if (g !== 'here' && 'code' in g) return g;
        return [...(g === 'here' ? [] : [{ verb: 'walk_to', params: { actor: me, x: g.x, z: g.z }, settle: 'done' } as Op]), { wait: n }];
      }
      case 'sit': return [{ verb: 'sit', params: { actor: me, fixture: String(a.on ?? '') }, settle: 'held' }, { wait: secs(a.seconds, 60) }];
      case 'stand': return this.holders(me).length ? [{ verb: 'stand', params: { actor: me }, settle: 'done', soft: true }] : [];
      case 'ambient_wander': {
        // Mars's own ambient_wander is not resumable from a snapshot, so strolling is built from walks and pauses, which are.
        const total = secs(a.seconds, 60), radius = Math.min(40, Math.max(2, typeof a.radius === 'number' ? a.radius : 12));
        const home = this.pos(me)!, ops: Op[] = []; let spent = 0;
        for (let leg = 0; leg < 6 && spent < total; leg++) {
          for (let tries = 0; tries < 4; tries++) {
            const ang = this.m.nextRandom(this.rt.world.rng) * Math.PI * 2, dist = (0.3 + 0.7 * this.m.nextRandom(this.rt.world.rng)) * radius;
            const x = r3(home[0] + Math.cos(ang) * dist), z = r3(home[1] + Math.sin(ang) * dist);
            if (leg > 0 || !this.plan('walk_to', { actor: me, x, z })) { ops.push({ verb: 'walk_to', params: { actor: me, x, z, speed: 0.9 }, settle: 'done', soft: true }); break; }
          }
          const pause = Math.round((2 + 6 * this.m.nextRandom(this.rt.world.rng)) * TPS); ops.push({ wait: pause });
          spent += pause + Math.round((radius / 0.9) * TPS * 0.6);
        }
        return ops;
      }
      default: return { code: 'action.unknown-verb', message: `no body verb "${step.verb}"` };
    }
  }

  // ------------------------------------------------------------------ programs
  canPerform(program: Program): Diag | null {
    if (!this.ents[program.actor]) return { code: 'actor.unknown', message: `no such actor ${program.actor}` };
    const first = program.steps[0]; if (!first) return null;
    if (!first.verb.startsWith('mars:') && !BODY.has(first.verb)) return { code: 'action.unknown-verb', message: `no body verb "${first.verb}"` };
    if (first.verb === 'walk_to') { const g = this.goalNear(program.actor, first.params.to, typeof first.params.standoff === 'number' ? first.params.standoff : 0); return g !== 'here' && 'code' in g ? g : null; }
    if (first.verb === 'sit') return this.plan('sit', { actor: program.actor, fixture: String(first.params.on ?? '') });
    return null;
  }
  perform(program: Program) {
    const no = this.canPerform(program);
    const id = `p${this.nextProg++}`;
    if (no) return { id, ok: false, diagnostic: no };
    const old = this.byActor.get(program.actor);
    if (old) { const o = this.programs.get(old)!; if (o.action && this.rt.isActive(o.action)) this.rt.cancel(o.action, { code: 'program.replaced', message: 'replaced' }); this.end(o, 'cancelled', { code: 'program.replaced', message: 'replaced by a new program' }); }
    const p: Prog = { id, actor: program.actor, label: program.label.slice(0, 200), steps: program.steps, index: 0, started: false, since: this.rt.tick, ops: [] };
    this.programs.set(id, p); this.byActor.set(p.actor, id);
    return { id, ok: true };
  }
  stop(programId: string) {
    const p = this.programs.get(programId); if (!p) return;
    if (p.action && this.rt.isActive(p.action)) this.rt.cancel(p.action, { code: 'program.stopped', message: 'stopped' });
    this.end(p, 'cancelled', { code: 'program.stopped', message: 'stopped' });
  }
  programOf(actor: string) { return this.byActor.get(actor) ?? null; }
  submit(verb: string, params: unknown, opts?: { id?: string; parent?: string; preempt?: boolean }): ActionRecord { return this.rt.submit(verb, params, opts) as ActionRecord; }
  cancel(id: string, reason?: Diag): ActionRecord { return this.rt.cancel(id, reason) as ActionRecord; }

  // ------------------------------------------------------------------ bodies
  /** Mars has no way to add a person to a running world; the adapter does what its world editor does, then restores canonical order. */
  spawnHuman({ id, label, soul }: { id: string; label: string; soul: string }): string {
    if (this.ents[id]) return id;
    const [ax, az] = this.cfg.arrival;
    const people = Object.values(this.ents).filter((e: any) => e.kind === 'human').map((e: any) => [e.pose.p[0], e.pose.p[2]] as [number, number]);
    let spot: [number, number] | null = null;
    search: for (let ring = 0; ring < 6; ring++) for (let k = 0; k < Math.max(1, ring * 6); k++) {
      const ang = (k / Math.max(1, ring * 6)) * Math.PI * 2 + ring * 0.5, x = r3(ax + Math.cos(ang) * ring * 0.9), z = r3(az + Math.sin(ang) * ring * 0.9);
      if (people.some(([px, pz]) => Math.hypot(px - x, pz - z) < 0.8)) continue;
      this.ents[id] = this.m.human(id, x, z, { label });
      const ok = !this.plan('walk_to', { actor: id, x: this.cfg.reference[0], z: this.cfg.reference[1] }) || !this.plan('walk_to', { actor: id, x: ax, z: az });
      delete this.ents[id];
      if (ok) { spot = [x, z]; break search; }
    }
    if (!spot) throw new Error('no free standing room at the arrival point');
    const e = this.m.human(id, spot[0], spot[1], { label, provenance: { origin: 'simulation', confidence: 'hypothetical' } });
    e.human.soul = soul;
    this.ents[id] = e; this.m.canonicalEntityOrder(this.rt.world);
    this.out.changes.push([this.rt.tick, id, 'present', e]);
    return id;
  }
  private tryRemove(id: string): boolean {
    if (!this.ents[id]) return true;
    if (!this.release(id, { code: 'actor.removed', message: 'actor removed' })) return false;
    delete this.ents[id]; this.keys.delete(id); this.acts.delete(id);
    this.out.changes.push([this.rt.tick, id, 'present', null]);
    return true;
  }
  removeEntity(id: string) {
    const pid = this.byActor.get(id); if (pid) this.stop(pid);
    if (!this.tryRemove(id)) this.leaving.push(id);        // a seated person stands up first; then they go
  }

  // ------------------------------------------------------------------ what the shell reads
  anchors(): Anchor[] {
    const w = this.rt.world, out: Anchor[] = [{ id: this.cfg.grounds.id, kind: 'region', name: this.cfg.grounds.name, point: this.cfg.arrival }];
    for (const id of Object.keys(w.regions).sort()) { const r = w.regions[id]; if (r.kind === 'no-go') continue; out.push({ id, kind: 'place', name: r.label, in: this.cfg.grounds.id, point: centroid(r.polygon), tags: [r.kind, ...(id === this.cfg.arrivalPlace ? ['arrival'] : [])] }); }
    for (const id of Object.keys(w.entities).sort()) { const e = w.entities[id]; if (e.kind !== 'fixture') continue; out.push({ id, kind: 'place', name: e.label ?? id, in: this.cfg.grounds.id, entity: id, tags: [e.def] }); }
    return out;
  }
  regionAt(_p: Vec3): string { return this.cfg.grounds.id; }
  poseSampleOf(id: string): PoseSample {
    const e = this.ents[id];
    return [this.rt.tick, Math.round(e.pose.p[0] * 1000), Math.round(e.pose.p[1] * 1000), Math.round(e.pose.p[2] * 1000), Math.round(e.pose.yaw * 1000)];
  }
  currentPath(_id: string): PathCommit | undefined { return undefined; }   // movement is broadcast as keyframes, not as paths decided in advance
  enumerateActivities(): ActivityOption[] { return []; }                    // superseded by cards
  describeSurroundings(actorId: string) {
    const me = this.pos(actorId) ?? [0, 0];
    const items = Object.keys(this.ents).filter((id) => id !== actorId && (this.ents[id].kind === 'human' || this.ents[id].kind === 'fixture')).map((id) => {
      const e = this.ents[id], d = Math.hypot(e.pose.p[0] - me[0], e.pose.p[2] - me[1]);
      return { id, d, who: (e.label ?? id) as string, what: e.kind === 'human' ? 'a soul' : (e.def as string), doing: e.kind === 'human' ? (e.human.activity as string) : '' };
    }).sort((x, y) => x.d - y.d || (x.id < y.id ? -1 : 1));
    const place = Object.keys(this.rt.world.regions).sort().find((id) => inPoly(me[0], me[1], this.rt.world.regions[id].polygon));
    return { nearby: items.slice(0, 8).map(({ id, who, what, doing, d }) => ({ id, who, what, distance: bucket(d), doing })), region: place ?? this.cfg.grounds.id, happening: 'nothing in particular' };
  }

  // ------------------------------------------------------------------ checkpoints
  /** Mars's own resumable snapshot, plus which program each actor is in. Body-language steps lower only to verbs Mars can resume exactly. */
  snapshot(): EngineSnapshot {
    const mars = this.rt.snapshot({ allowDrop: true });
    return structuredClone({ format: SNAPSHOT_FORMAT, tick: this.rt.tick as number, stateHash: this.stateHash(), mars, dropped: mars.dropped?.length ?? 0, programs: [...this.programs.values()], nextProg: this.nextProg, leaving: this.leaving, cfg: this.cfg });
  }
}

function centroid(poly: [number, number][]): [number, number] { let x = 0, z = 0; for (const p of poly) { x += p[0]; z += p[1]; } return [r3(x / poly.length), r3(z / poly.length)]; }

/** The factory is made once the Mars engine has been loaded (an async import); after that everything is synchronous. */
export async function marsFactory(cfg: MarsWorldConfig = PROVING_GROUND): Promise<EngineFactory> {
  const m = await loadMars();
  const registry = m.createRegistry(), services = m.servicesFor(m.scenes);
  return {
    rulesVersion: `sim-mars/1+${m.rulesVersion}`,
    /** The synthetic proving ground (a campfire, two benches, a lawn), emptied of its test people: Souls arrive by being born. */
    genesis(seed: string): WorldState {
      const w = m.provingGroundWorld();
      for (const id of Object.keys(w.entities)) if (w.entities[id].kind === 'human') delete w.entities[id];
      w.rng = m.seedRng(seed);
      return w as WorldState;
    },
    create: (world) => new MarsEngine(m, new m.Runtime(world, registry, services(world), m.invariants), cfg),
    restore(snap: EngineSnapshot) {
      const s = structuredClone(snap) as EngineSnapshot & { mars: any; programs: Prog[]; nextProg: number; leaving: string[]; cfg: MarsWorldConfig };
      if (s.format !== SNAPSHOT_FORMAT) throw new Error(`bad snapshot format ${s.format}`);
      // Spatial services are rebuilt for the same base scene; the snapshot carries the rest.
      const base = m.provingGroundWorld();
      const rt = m.Runtime.restore(s.mars, registry, services(base), m.invariants);
      return new MarsEngine(m, rt, s.cfg ?? cfg, { programs: s.programs, nextProg: s.nextProg, leaving: s.leaving });
    },
  };
}
