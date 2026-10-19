// Object framework (C7): storage, entitlement-filtered reads, validated and logged
// actions, time-driven advances, capability listing. Kinds register themselves; the
// framework never knows chess or presentations.
import type {EdgeCapability, EdgeSoul} from '../../contract.ts';
import {EdgeError} from '../../contract.ts';
import {bodyCapabilityProblem} from '../../body/actions.ts';
import type {CommsCore} from '../core.ts';
import {tx} from '../store.ts';
import type {ActionCtx, BodyRequest, CarrierView, FieldSpec, ObjectEvent, ObjectKind, ObjectRecord, ParamSpec, Refusal, TimeCtx} from './types.ts';

const OBJECT_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const ACTION = /^[a-z][a-z0-9_-]{0,39}$/;

export type ObjectActResult = {accepted: true; object: {id: string; version: number}; action: string; result?: Record<string, unknown>; bodies?: BodyRequest[]}
  | {accepted: false; code: string; reason: string; object: string; action: string};

export class Objects {
  private kinds = new Map<string, ObjectKind>();
  private core: CommsCore;
  constructor(core: CommsCore) { this.core = core; }

  register(kind: ObjectKind) {
    if (this.kinds.has(kind.kind)) throw new Error(`object kind ${kind.kind} already registered`);
    for (const a of Object.keys(kind.actions)) if (!ACTION.test(a)) throw new Error(`bad action name ${a}`);
    this.kinds.set(kind.kind, kind);
  }
  kindOf(kind: string) { return this.kinds.get(kind); }

  private carrierRead = (id: string): CarrierView | null => { try { return (this.core.deps.ledger.carrierView?.(id) ?? null) as CarrierView | null; } catch { return null; } };
  private timeCtx(): TimeCtx { return {tick: this.core.tick(), now: this.core.now(), nameOf: this.core.nameOf, carrier: this.carrierRead}; }
  private row(id: string): ObjectRecord | undefined {
    const r = this.core.db.prepare('SELECT body FROM edge_comms_objects WHERE world_id = ? AND id = ?').get(this.core.worldId, id) as {body: string} | undefined;
    return r ? JSON.parse(r.body) as ObjectRecord : undefined;
  }
  private save(o: ObjectRecord) {
    this.core.db.prepare('INSERT INTO edge_comms_objects (world_id, id, kind, version, body, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT (world_id, id) DO UPDATE SET version = excluded.version, body = excluded.body, updated_at = excluded.updated_at')
      .run(this.core.worldId, o.id, o.kind, o.version, JSON.stringify(o), this.core.now());
  }
  private log(o: ObjectRecord, soulId: string | null, action: string, params: Record<string, unknown>) {
    this.core.db.prepare('INSERT INTO edge_comms_object_log (world_id, object_id, version, soul_id, action, params, tick, at) VALUES (?,?,?,?,?,?,?,?)')
      .run(this.core.worldId, o.id, o.version, soulId, action, JSON.stringify(params), this.core.tick(), this.core.now());
  }
  all(): ObjectRecord[] {
    return (this.core.db.prepare('SELECT body FROM edge_comms_objects WHERE world_id = ? ORDER BY id').all(this.core.worldId) as {body: string}[]).map(r => JSON.parse(r.body) as ObjectRecord);
  }
  /** Whether an object with this id exists (one indexed row, no body parsed). */
  has(id: string): boolean {
    return !!this.core.db.prepare('SELECT 1 FROM edge_comms_objects WHERE world_id = ? AND id = ?').get(this.core.worldId, id);
  }
  /** Every object id (`all()`'s ids, same order), no bodies parsed. */
  ids(): string[] {
    return (this.core.db.prepare('SELECT id FROM edge_comms_objects WHERE world_id = ? ORDER BY id').all(this.core.worldId) as {id: string}[]).map(r => r.id);
  }
  /** `all()` of one kind (same order): only that kind's bodies are parsed (S1 V7d: the layers' calendar every 2 s). */
  ofKind(kind: string): ObjectRecord[] {
    return (this.core.db.prepare('SELECT body FROM edge_comms_objects WHERE world_id = ? AND kind = ? ORDER BY id').all(this.core.worldId, kind) as {body: string}[]).map(r => JSON.parse(r.body) as ObjectRecord);
  }

  /** Original creation input; private provenance survives actions and process restarts. */
  creationParams(id: string): Record<string, unknown> | undefined {
    const row = this.core.db.prepare("SELECT params FROM edge_comms_object_log WHERE world_id=? AND object_id=? AND action='create' ORDER BY version DESC LIMIT 1").get(this.core.worldId, id) as {params: string} | undefined;
    return row ? JSON.parse(row.params) : undefined;
  }

  /** Create (or keep, if it exists) an object instance. Seeded by Ledger/World/steward. */
  create(input: {id: string; kind: string; name: string; description?: string; placeId: string; params?: Record<string, unknown>}): ObjectRecord {
    if (!OBJECT_ID.test(input.id)) throw new Error('object id must match ^[a-z0-9][a-z0-9._-]{0,99}$');
    const kind = this.kinds.get(input.kind);
    if (!kind) throw new Error(`unknown object kind ${input.kind}`);
    return tx(this.core.db, () => {
      const existing = this.row(input.id);
      if (existing) return existing;
      const state = kind.initial(input.params ?? {}, this.timeCtx());
      checkState(kind, state);
      // Removing a projection retains its audit log; restoring it must continue that version sequence.
      const prior = this.core.db.prepare('SELECT MAX(version) AS version FROM edge_comms_object_log WHERE world_id=? AND object_id=?').get(this.core.worldId, input.id) as {version: number | null};
      const o: ObjectRecord = {id: input.id, kind: input.kind, name: input.name.slice(0, 100), description: (input.description ?? kind.description).slice(0, 4000), placeId: input.placeId, version: (prior.version ?? 0) + 1, state, createdAt: this.core.now()};
      this.save(o); this.log(o, null, 'create', input.params ?? {});
      return o;
    });
  }
  remove(id: string) { this.core.db.prepare('DELETE FROM edge_comms_objects WHERE world_id = ? AND id = ?').run(this.core.worldId, id); }

  private inPlace(soulId: string, placeId: string): boolean {
    try { return this.core.deps.ledger.placePathOf(soulId).some(p => p.id === placeId); } catch { return false; }
  }
  /** `inPlace` for one Soul over one listing. Its place path is the same for every object, and computing it (every place
   *  polygon, sorted) costs far more than the object around it: a listing over a built-up world asked for it twice per object. */
  private inPlaceFor(soulId: string): (placeId: string) => boolean {
    let ids: Set<string> | undefined;
    return (placeId) => {
      if (!ids) { try { ids = new Set(this.core.deps.ledger.placePathOf(soulId).map(p => p.id)); } catch { ids = new Set(); } }
      return ids.has(placeId);
    };
  }
  private ctx(o: ObjectRecord, kind: ObjectKind, soul: EdgeSoul, inPlace: (placeId: string) => boolean = id => this.inPlace(soul.soulId, id)): ActionCtx {
    return {soul, roles: kind.rolesOf(o.state, soul.soulId), tick: this.core.tick(), now: this.core.now(), nameOf: this.core.nameOf, inPlace: inPlace(o.placeId), carrier: this.carrierRead};
  }
  /** Apply time-driven transitions and persist them (with their events). */
  private advanced(o: ObjectRecord,persist=true): ObjectRecord {
    const kind = this.kinds.get(o.kind);
    const step = kind?.advance?.(structuredClone(o.state), this.timeCtx());
    if (!kind || !step) return o;
    checkState(kind, step.state);
    const next = {...o, state: step.state, version: o.version + 1};
    if(persist){this.save(next); this.log(next, null, 'advance', {});this.emit(next, step.events ?? []);}
    return next;
  }
  /** Every object with its time-driven transitions applied (also the sweep timer). */
  fresh(): ObjectRecord[] { return this.all().map(o => tx(this.core.db, () => { const cur = this.row(o.id); return cur ? this.advanced(cur) : o; })); }
  /** fresh() for just these objects (their kind's wanted state changed): no read of every object. */
  refresh(ids: Iterable<string>): void { for (const id of ids) tx(this.core.db, () => { const cur = this.row(id); if (cur) this.advanced(cur); }); }
  sweep() { this.fresh(); }

  private emit(o: ObjectRecord, events: ObjectEvent[]) {
    const tick = this.core.tick();
    for (const e of events) {
      const body = {object: o.id, objectKind: o.kind, text: e.text, ...(e.data ? {data: e.data} : {}), ...(e.untrusted ? {untrusted: true} : {})};
      for (const to of new Set(e.to)) if (this.core.isLive(to)) this.core.streams.deliver(to, e.kind ?? 'object', tick, body);
      this.core.spectate({kind: e.kind ?? 'object', tick, ...body});
    }
  }

  private visible(o: ObjectRecord, soulId: string, kind: ObjectKind, inPlace: (placeId: string) => boolean = id => this.inPlace(soulId, id)): boolean {
    return kind.listed || inPlace(o.placeId) || kind.rolesOf(o.state, soulId).length > 0;
  }
  /** What a Soul may read: public fields, fields its roles entitle, its own derived fields, actions. */
  view(o: ObjectRecord, soul: EdgeSoul, inPlace?: (placeId: string) => boolean) {
    const kind = this.kinds.get(o.kind)!;
    const ctx = this.ctx(o, kind, soul, inPlace);
    const state: Record<string, unknown> = {};
    for (const [field, spec] of Object.entries(kind.schema)) if (entitled(spec, ctx.roles)) state[field] = (o.state as Record<string, unknown>)[field];
    return {id: o.id, kind: o.kind, name: o.name, description: o.description, placeId: o.placeId, version: o.version,
      roles: ctx.roles, state, ...(kind.personal ? {mine: kind.personal(o.state, soul.soulId, ctx.roles)} : {}),
      actions: this.actionsFor(o, kind, ctx), untrusted: true};
  }
  private actionsFor(o: ObjectRecord, kind: ObjectKind, ctx: ActionCtx) {
    return Object.entries(kind.actions).flatMap(([name, a]) => {
      if (a.roles !== 'anyone' && !a.roles.some(r => ctx.roles.includes(r))) return [];
      const blocked: Refusal | null = a.reach === 'place' && !ctx.inPlace ? {code: 'object.out-of-reach', reason: `Go to ${o.placeId} first.`} : a.available?.(o.state, ctx) ?? null;
      return [{action: name, label: a.label, params: a.params, available: !blocked, ...(blocked ? {blocked} : {})}];
    });
  }

  get(id: string, soul: EdgeSoul) {
    if (!OBJECT_ID.test(id)) throw new EdgeError(404, 'not-found', 'no such object');
    return tx(this.core.db, () => {
      const raw = this.row(id);
      const kind = raw && this.kinds.get(raw.kind);
      if (!raw || !kind || !this.visible(raw, soul.soulId, kind)) throw new EdgeError(404, 'not-found', 'no such object here');
      return {object: this.view(this.advanced(raw), soul)};
    });
  }
  /** Objects this Soul can see (for observe `here.objects` and GET /v1/edge/objects). */
  visibleTo(soul: EdgeSoul) {
    const inPlace = this.inPlaceFor(soul.soulId);
    return this.fresh().flatMap(o => {
      const kind = this.kinds.get(o.kind);
      if (!kind || !this.visible(o, soul.soulId, kind, inPlace)) return [];
      const v = this.view(o, soul, inPlace);
      return [{id: v.id, kind: v.kind, name: v.name, placeId: v.placeId, here: inPlace(o.placeId), public: publicState(kind, o.state), untrusted: true}];
    });
  }

  act(id: string, soul: EdgeSoul, input: Record<string, unknown>): ObjectActResult {
    const action = input.action;
    if (typeof action !== 'string' || !ACTION.test(action)) throw new EdgeError(400, 'invalid', 'action must be an action name');
    const params = input.params ?? {};
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw new EdgeError(400, 'invalid', 'params must be an object');
    const clientRef = input.clientRef;
    if (clientRef !== undefined && (typeof clientRef !== 'string' || clientRef.length < 1 || clientRef.length > 100)) throw new EdgeError(400, 'invalid', 'clientRef must be 1..100 characters');
    return tx(this.core.db, () => {
      if (clientRef) {
        const prior = this.core.db.prepare('SELECT response FROM edge_comms_object_refs WHERE world_id = ? AND soul_id = ? AND client_ref = ?').get(this.core.worldId, soul.soulId, clientRef) as {response: string} | undefined;
        if (prior) return JSON.parse(prior.response) as ObjectActResult;
      }
      const out = this.actOnce(id, soul, action, params as Record<string, unknown>);
      if (clientRef) this.core.db.prepare('INSERT INTO edge_comms_object_refs (world_id, soul_id, client_ref, response, at) VALUES (?,?,?,?,?)').run(this.core.worldId, soul.soulId, clientRef, JSON.stringify(out), this.core.now());
      return out;
    });
  }
  private actOnce(id: string, soul: EdgeSoul, action: string, params: Record<string, unknown>,persist=true,preview?:{after?:unknown}): ObjectActResult {
    const refuse = (r: Refusal): ObjectActResult => ({accepted: false, code: r.code, reason: r.reason, object: id, action});
    const raw = OBJECT_ID.test(id) ? this.row(id) : undefined;
    const kind = raw && this.kinds.get(raw.kind);
    if (!raw || !kind || !this.visible(raw, soul.soulId, kind)) throw new EdgeError(404, 'not-found', 'no such object here');
    const actor=this.core.deps.host.engine.world.entities?.[soul.entityId];
    if(!actor?.human||actor.kind!=='human')return refuse({code:'body.unavailable',reason:'Your body is unavailable; this object action cannot be accepted.'});
    if(actor.body&&!['humanoid','floater'].includes(actor.body.family))return refuse({code:'body.unsupported',reason:'This body family is unsupported; this object action cannot be accepted.'});
    const bodyIssue=bodyCapabilityProblem(actor,{id:`object:${id}:${action}`,verb:'object',action,label:action,available:true});
    if(bodyIssue)return refuse(bodyIssue);
    const o = this.advanced(raw,persist);
    const a = kind.actions[action];
    if (!a) return refuse({code: 'object.action-unknown', reason: `${o.name} has no action ${action}.`});
    const ctx = this.ctx(o, kind, soul);
    if (a.roles !== 'anyone' && !a.roles.some(r => ctx.roles.includes(r))) return refuse({code: 'object.role', reason: `Only ${a.roles.join(' or ')} may ${action}.`});
    if (a.reach === 'place' && !ctx.inPlace) return refuse({code: 'object.out-of-reach', reason: `You must be at ${o.name} to ${action}.`});
    const bad = checkParams(a.params, params);
    if (bad) return refuse(bad);
    const illegal = a.validate(o.state, params, ctx);
    if (illegal) return refuse(illegal);
    const outcome = a.apply(structuredClone(o.state), params, ctx);
    checkState(kind, outcome.state);
    const next = {...o, state: outcome.state, version: o.version + 1};
    if(persist){this.save(next); this.log(next, soul.soulId, action, params);this.emit(next, outcome.events ?? []);}
    if(preview)preview.after={object:this.view(next,soul)};
    return {accepted: true, object: {id: o.id, version: next.version}, action, ...(outcome.result ? {result: outcome.result} : {}), ...(outcome.bodies?.length ? {bodies: outcome.bodies} : {})};
  }

  /** Prepare using the same production validators, but no writes, events or
   * in-memory commits. Body admission can then fence this exact object version. */
  prepareAct(id:string,soul:EdgeSoul,input:Record<string,unknown>){
    const action=input.action,params=input.params??{};
    if(typeof action!=='string'||!ACTION.test(action))throw new EdgeError(400,'invalid','action must be an action name');
    if(!params||typeof params!=='object'||Array.isArray(params))throw new EdgeError(400,'invalid','params must be an object');
    const clientRef=input.clientRef;if(clientRef!==undefined&&(typeof clientRef!=='string'||clientRef.length<1||clientRef.length>100))throw new EdgeError(400,'invalid','clientRef must be 1..100 characters');
    const baseline=JSON.stringify(this.row(id)),preview:{after?:unknown}={};
    const prior=clientRef?this.core.db.prepare('SELECT response FROM edge_comms_object_refs WHERE world_id=? AND soul_id=? AND client_ref=?').get(this.core.worldId,soul.soulId,clientRef) as {response:string}|undefined:undefined;
    const result=prior?JSON.parse(prior.response) as ObjectActResult:this.actOnce(id,soul,action,params as Record<string,unknown>,false,preview);
    const guard=():true=>{
      if(prior)return true;
      if(JSON.stringify(this.row(id))!==baseline)throw new EdgeError(409,'object.changed','The object changed before body admission; observe it and retry.');
      const fresh=this.actOnce(id,soul,action,params as Record<string,unknown>,false);
      if(!fresh.accepted)throw new EdgeError(409,fresh.code,fresh.reason);
      if(result.accepted&&JSON.stringify(fresh.bodies)!==JSON.stringify(result.bodies))throw new EdgeError(409,'object.changed','The object body request changed before admission.');
      return true;
    };
    return {result,movesBody:this.kinds.get(this.row(id)?.kind??'')?.actions[action]?.movesBody===true,before:this.row(id)?{object:this.view(this.row(id)!,soul)}:undefined,after:preview.after,guard,commit:()=>{guard();const out=this.act(id,soul,input);if(!out.accepted)throw new EdgeError(409,out.code,out.reason);return out;}};
  }

  /** Object actions as capabilities (`object:<id>:<action>`), merged by Ledger. */
  capabilities(soul: EdgeSoul): EdgeCapability[] {
    const inPlace = this.inPlaceFor(soul.soulId);
    return this.fresh().flatMap(o => {
      const kind = this.kinds.get(o.kind);
      if (!kind || !this.visible(o, soul.soulId, kind, inPlace)) return [];
      const ctx = this.ctx(o, kind, soul, inPlace);
      return this.actionsFor(o, kind, ctx).map(a => ({id: `object:${o.id}:${a.action}`, verb: 'object', label: `${a.label} (${o.name})`, object: o.id, action: a.action,
        target: {id: o.id, kind: o.kind}, available: a.available, ...(a.blocked ? {blocked: a.blocked} : {}), ...(Object.keys(a.params).length ? {params: a.params as Record<string, unknown>} : {})}));
    });
  }
  /** Extra hearers for `say` from Role relations (`addresses`). */
  addressees(soulId: string): {objectId: string; souls: string[]}[] {
    return this.fresh().flatMap(o => {
      const kind = this.kinds.get(o.kind);
      const souls = kind?.addressees?.(o.state, soulId) ?? [];
      return souls.length ? [{objectId: o.id, souls}] : [];
    });
  }
}

function entitled(spec: FieldSpec, roles: string[]) { return spec.visibility === 'public' || spec.visibility.some(r => roles.includes(r)); }
function publicState(kind: ObjectKind, state: unknown) {
  const out: Record<string, unknown> = {};
  for (const [f, spec] of Object.entries(kind.schema)) if (spec.visibility === 'public') out[f] = (state as Record<string, unknown>)[f];
  return out;
}

export function checkParams(specs: Record<string, ParamSpec>, params: Record<string, unknown>): Refusal | null {
  for (const key of Object.keys(params)) if (!(key in specs)) return {code: 'capability.params', reason: `Unknown parameter ${key}.`};
  for (const [key, spec] of Object.entries(specs)) {
    const v = params[key];
    if (v === undefined) { if (spec.optional) continue; return {code: 'capability.params', reason: `${key} is required.`}; }
    if (spec.type === 'string') {
      if (typeof v !== 'string' || v.length > (spec.maxLength ?? 500)) return {code: 'capability.params', reason: `${key} must be a string.`};
      if (spec.enum && !spec.enum.includes(v)) return {code: 'capability.params', reason: `${key} must be one of ${spec.enum.join(', ')}.`};
      if (spec.pattern && !new RegExp(spec.pattern).test(v)) return {code: 'capability.params', reason: `${key} is not in the expected form.`};
    } else if (spec.type === 'integer') {
      if (!Number.isInteger(v) || (spec.min !== undefined && (v as number) < spec.min) || (spec.max !== undefined && (v as number) > spec.max)) return {code: 'capability.params', reason: `${key} must be an integer in range.`};
    } else if (typeof v !== 'boolean') return {code: 'capability.params', reason: `${key} must be true or false.`};
  }
  return null;
}

const isRef = (v: unknown) => !!v && typeof v === 'object' && typeof (v as {soulId?: unknown}).soulId === 'string' && typeof (v as {name?: unknown}).name === 'string';
/** Guards a kind's own bugs: state must match its declared schema after every change. */
export function checkState(kind: ObjectKind, state: unknown) {
  if (!state || typeof state !== 'object') throw new Error(`${kind.kind}: state must be an object`);
  for (const [field, spec] of Object.entries(kind.schema)) {
    const v = (state as Record<string, unknown>)[field];
    const ok = spec.type === 'string' ? typeof v === 'string'
      : spec.type === 'integer' ? Number.isInteger(v)
      : spec.type === 'boolean' ? typeof v === 'boolean'
      : spec.type === 'string[]' ? Array.isArray(v) && v.every(x => typeof x === 'string')
      : spec.type === 'soul' ? isRef(v)
      : spec.type === 'soul?' ? v === null || isRef(v)
      : spec.type === 'soul[]' ? Array.isArray(v) && v.every(isRef)
      : v !== undefined;
    if (!ok) throw new Error(`${kind.kind}: state.${field} is not ${spec.type}`);
  }
}
