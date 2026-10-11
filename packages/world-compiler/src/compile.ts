// The compiler: a batch of ops → either a refusal with precise codes, or a
// committed change with its inverse (spec §5). Two phases: `plan` simulates on
// a scratch copy and never touches the model; `commit` applies a plan. The god
// skill runs `plan` locally (dry runs); the server runs both.
import { footprintOf, padFor, settle, waterLevelAt, SKIRT_MAX_M as SKIRT_MAX, type Landform } from '@sim/ground';
import { prepareFor, queryOf } from '@sim/generators';
import { hashOf } from './hash.ts';
import { offsetPolyline, pointAlong } from '@sim/generators';
import { WorldModel, obbOverlap, type OBB } from './model.ts';
import { batchSchema, trustedBatchSchema, type Batch, type Entity, type Failure, type Field, type Op, type Result, type StoredDef, type Value, worldStateSchema, SKY_PALETTES } from './schemas.ts';
import { layersStateSchema, type LayersState, type Schedule } from './layers.ts';

export type Diff = { upserts: Entity[]; removes: string[]; defs: StoredDef[]; world?: Partial<WorldModel['state']>; constants?: WorldModel['constants']; tiles: string[]; answers: { prayer: string; text: string }[]; /** LAYERS: state.layers changed (wallets, relations, currency; never sent to viewers) */ layers?: true };
/** Body-aware edits (31 §3 rule 8): who uses an entity — a Soul seated on it, holding it, or the entity is a body.
 *  Checked for every entity in the subtree of a remove / move / set-params target; null = free. */
export type UsesHook = (id: string) => { code: 'occupied.by-body' | 'held.by-body'; detail: string } | null;
/** Body-aware edits, the would-be world's side (31 §3 rule 8, R2): called once after a plan succeeds, with the plan's own
 *  scratch (the world as it would be), its diff and the batch's ops; a Failure refuses the whole batch (null = fine). The
 *  engine bridge uses it to refuse burying or unseating a body that cannot step clear, without planning a second time.
 *  With the hook set, `uses` refusals are held back until it has run (it is called even when one was found), so its
 *  refusal wins as when it planned on a fork first; failing that, the earliest held-back one refuses the batch. */
export type RefuseHook = (scratch: WorldModel, diff: Diff, ops: Op[]) => Failure | null;
export type PlanOptions = { trusted?: boolean; uses?: UsesHook; refuse?: RefuseHook };

export type Plan = { ok: true; apply: () => { seq: number; undoId: string; diff: Diff; inverse: Op[] }; ids: Record<string, string>; warnings: string[]; diff: Diff } | { ok: false; failures: Failure[] };

const fail = (op: number, code: string, detail: string, suggest?: Failure['suggest']): Failure => ({ op, code, detail, suggest });

/** Validate values against fields; fills defaults; returns the problem or the normalised record. */
export function checkFields(fields: Record<string, Field>, values: Record<string, Value> | undefined, fillDefaults: boolean): { ok: true; values: Record<string, Value> } | { ok: false; detail: string } {
  const out: Record<string, Value> = {};
  for (const [k, v] of Object.entries(values ?? {})) {
    const f = fields[k];
    if (!f) return { ok: false, detail: `unknown field ${k}` };
    switch (f.type) {
      case 'number': case 'int':
        if (typeof v !== 'number' || (f.type === 'int' && !Number.isInteger(v))) return { ok: false, detail: `${k} must be ${f.type}` };
        if (f.min !== undefined && v < f.min) return { ok: false, detail: `${k} < ${f.min}` };
        if (f.max !== undefined && v > f.max) return { ok: false, detail: `${k} > ${f.max}` };
        break;
      case 'bool': if (typeof v !== 'boolean') return { ok: false, detail: `${k} must be boolean` }; break;
      case 'string': if (typeof v !== 'string' || v.length > f.max) return { ok: false, detail: `${k} must be a string ≤ ${f.max}` }; break;
      case 'enum': if (typeof v !== 'string' || !f.values.includes(v)) return { ok: false, detail: `${k} must be one of ${f.values.join(', ')}` }; break;
      case 'color': if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/.test(v)) return { ok: false, detail: `${k} must be #rrggbb` }; break;
      case 'ref': if (typeof v !== 'string') return { ok: false, detail: `${k} must be an id` }; break;
    }
    out[k] = v;
  }
  if (fillDefaults) for (const [k, f] of Object.entries(fields)) if (out[k] === undefined && f.default !== undefined) out[k] = f.default as Value;
  return { ok: true, values: out };
}

export function plan(world: WorldModel, input: unknown, by: string, tick: number, opts: PlanOptions = {}): Plan {
  const parsed = (opts.trusted ? trustedBatchSchema : batchSchema).safeParse(input);
  if (!parsed.success) return { ok: false, failures: [fail(-1, 'schema', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))] };
  const batch: Batch = parsed.data as Batch;
  const ops = parsed.data.ops as unknown as Op[];
  // Scratch copy: structural maps are cloned; the terrain is shared but every landform change is recorded and
  // undone if the plan fails, so a failed dry run leaves the model untouched.
  const scratch = world.fork();
  const failures: Failure[] = [], warnings: string[] = [], ids: Record<string, string> = {};
  const diff: Diff = { upserts: [], removes: [], defs: [], tiles: [], answers: [] };
  const inverse: Op[] = [];
  const touched = new Set<string>();
  let layersTouched = false;
  const upsert = (e: Entity) => { touched.add(e.id); };
  const resolveId = (ref: string, opIndex: number): string | null => {
    if (ref === 'world') return 'world';
    if (ref.startsWith('$')) { const id = ids[ref]; if (!id) failures.push(fail(opIndex, 'entity.unknown', `${ref} is not placed in this batch`)); return id ?? null; }
    const e = scratch.get(ref);
    if (!e) { failures.push(fail(opIndex, 'entity.unknown', `${ref}`)); return null; }
    return e.id;
  };
  /** With a `refuse` hook, uses refusals are held back while the batch is simulated to the end, so the hook sees the
   *  would-be world first (its refusal wins); then the earliest held-back one is the batch's refusal. */
  const heldBack: Failure[] = [];
  /** A Soul uses something in this subtree: refuse naming them. */
  const inUse = (id: string, i: number): boolean => {
    if (!opts.uses) return false;
    for (const sid of scratch.subtree(id)) {
      const u = opts.uses(sid);
      if (!u) continue;
      const f = fail(i, u.code, `${sid !== id ? `${scratch.pathOf(id)}: ` : ''}${u.detail}`);
      if (opts.refuse) { heldBack.push(f); return false; }
      failures.push(f); return true;
    }
    return false;
  };

  // sky palettes are a closed list (replayed inverses may restore an older free-form one)
  if (!opts.trusted) ops.forEach((op, i) => {
    const pal = op.op === 'world' ? op.state.sky?.palette : undefined;
    if (pal !== undefined && !(SKY_PALETTES as readonly string[]).includes(pal)) failures.push(fail(i, 'state.invalid', `sky palette ${pal} is not one of ${SKY_PALETTES.join(', ')}`));
  });
  ops.forEach((op, i) => {
    if (failures.length) return;
    switch (op.op) {
      case 'define': {
        const refuse = checkDef(scratch, op.def as never, i);
        if (refuse) { failures.push(refuse); return; }
        const stored = scratch.defineDef(op.def as never, by, tick);
        diff.defs.push(stored);
        return;
      }
      case 'place': {
        const def = scratch.resolvedDef(op.def);
        if (!def) { failures.push(fail(i, 'def.unknown', op.def)); return; }
        const parentId = resolveId(op.in.parent, i); if (!parentId) return;
        if (op.name && scratch.names.has(`${parentId}/${op.name}`)) { failures.push(fail(i, 'name.taken', op.name)); return; }
        const fieldsOk = checkFields(def.params, op.params, true);
        if (!fieldsOk.ok) { failures.push(fail(i, 'params.invalid', fieldsOk.detail)); return; }
        const stateOk = checkFields(def.state, op.state, true);
        if (!stateOk.ok) { failures.push(fail(i, 'state.invalid', stateOk.detail)); return; }
        if (def.form !== 'point' && !op.shape) { failures.push(fail(i, 'params.invalid', `${def.form} form needs a shape`)); return; }
        if (scratch.entities.size >= scratch.constants.limits.entities) { failures.push(fail(i, 'entity.limit', `${scratch.constants.limits.entities} entities`)); return; }
        const id = scratch.nextId();
        const e: Entity = { id, def: def.ref, in: { parent: parentId, ...(op.in.slot ? { slot: op.in.slot } : {}) }, by, born: tick, v: 1, ...(op.name ? { name: op.name } : {}), ...(op.p ? { p: op.p } : {}), ...(op.r !== undefined ? { r: op.r } : {}), ...(op.s !== undefined ? { s: op.s } : {}), ...(op.shape ? { shape: op.shape } : {}), ...(op.anchor ? { anchor: op.anchor } : {}), ...(Object.keys(fieldsOk.values).length ? { params: fieldsOk.values } : {}), ...(Object.keys(stateOk.values).length ? { state: stateOk.values } : {}), ...(op.seed !== undefined ? { seed: op.seed } : {}), ...(op.constraints?.length ? { constraints: op.constraints } : {}) };
        { const bad = followProblem(def, op.schedule); if (bad) { failures.push(fail(i, 'state.invalid', bad)); return; } }
        if (op.owner !== undefined) e.owner = op.owner;
        if (op.access !== undefined) e.access = op.access;
        if (op.schedule !== undefined) e.schedule = op.schedule;
        if (op.price !== undefined) e.price = op.price;
        prepareEntity(scratch, def, e, op.params);
        const problem = admit(scratch, e, def, i, op.mode, true);
        if (problem) { failures.push(problem); return; }
        scratch.insert(e); indexAndGround(scratch, e, def, diff);
        if (op.tmp) ids[op.tmp] = id;
        ids[id] = id;
        upsert(e);
        inverse.unshift({ op: 'remove', id, cascade: true });
        if (def.make.kind === 'parts') expandParts(scratch, e, def, by, tick, diff, inverse, upsert);
        return;
      }
      case 'remove': {
        const id = resolveId(op.id, i); if (!id || id === 'world') return;
        const sub = scratch.subtree(id);
        if (!op.cascade && sub.length > 1) { failures.push(fail(i, 'params.invalid', `${op.id} has ${sub.length - 1} children; set cascade`)); return; }
        if (inUse(id, i)) return;
        for (const sid of sub) {
          const e = scratch.entities.get(sid)!;
          if (isBody(scratch, e) && sid !== id) { failures.push(fail(i, 'occupied.by-body', `${scratch.pathOf(sid)} is a body inside ${op.id}`)); return; }
        }
        // children first for the forward diff; parents first for the inverse (restore in dependency order)
        const before = sub.map((sid) => scratch.entities.get(sid)!);
        for (const sid of [...sub].reverse()) {
          const e = scratch.entities.get(sid)!;
          scratch.delete(sid); clearGround(scratch, e, diff);
          diff.removes.push(sid); touched.delete(sid);
        }
        for (const e of [...before].reverse()) inverse.unshift({ op: 'restore', entity: world.entities.get(e.id) ?? e });
        return;
      }
      case 'move': {
        const id = resolveId(op.id, i); if (!id || id === 'world') return;
        if (inUse(id, i)) return;
        const prev = scratch.entities.get(id)!;
        const def = scratch.resolvedDef(prev.def)!;
        const next: Entity = { ...prev, v: prev.v + 1 };
        if (op.in) { const pid = resolveId(op.in.parent, i); if (!pid) return; if (scratch.subtree(id).includes(pid)) { failures.push(fail(i, 'parent.unknown', 'cannot move a thing into itself')); return; } next.in = { parent: pid, ...(op.in.slot ? { slot: op.in.slot } : {}) }; }
        if (op.p) next.p = op.p; if (op.r !== undefined) next.r = op.r; if (op.s !== undefined) next.s = op.s; if (op.shape) next.shape = op.shape;
        if (op.constraints) next.constraints = op.constraints;
        scratch.delete(id); clearGround(scratch, prev, diff);
        if (op.shape) prepareEntity(scratch, def, next, undefined);
        const problem = admit(scratch, next, def, i, op.mode, false);
        if (problem) { failures.push(problem); return; }
        scratch.insert(next); indexAndGround(scratch, next, def, diff);
        upsert(next);
        inverse.unshift({ op: 'move', id, in: prev.in, p: prev.p ?? [0, 0], r: prev.r ?? 0, s: prev.s ?? 1, ...(prev.shape ? { shape: prev.shape } : {}), mode: 'strict' });
        return;
      }
      case 'set': {
        const id = resolveId(op.id, i); if (!id || id === 'world') return;
        const prev = scratch.entities.get(id)!;
        const def = scratch.resolvedDef(prev.def)!;
        const next: Entity = { ...prev, v: prev.v + 1 };
        const inv: Extract<Op, { op: 'set' }> = { op: 'set', id };
        if (op.params && inUse(id, i)) return;
        if (op.state) {
          const ok = checkFields(def.state, op.state, false); if (!ok.ok) { failures.push(fail(i, 'state.invalid', ok.detail)); return; }
          inv.state = Object.fromEntries(Object.keys(op.state).map((k) => [k, prev.state?.[k] ?? (def.state[k]?.default as Value) ?? null]));
          next.state = { ...prev.state, ...ok.values };
        }
        if (op.params) {
          const ok = checkFields(def.params, op.params, false); if (!ok.ok) { failures.push(fail(i, 'params.invalid', ok.detail)); return; }
          inv.params = Object.fromEntries(Object.keys(op.params).map((k) => [k, prev.params?.[k] ?? (def.params[k]?.default as Value) ?? null]));
          next.params = { ...prev.params, ...ok.values };
        }
        if (op.constraints !== undefined) { inv.constraints = prev.constraints ?? []; next.constraints = op.constraints; }
        // LAYERS: owner, access, schedule, price (null clears; the inverse puts back what was there, or clears)
        if (op.schedule) { const bad = followProblem(def, op.schedule); if (bad) { failures.push(fail(i, 'state.invalid', bad)); return; } }
        for (const k of ['owner', 'access', 'schedule', 'price'] as const) {
          const v = op[k]; if (v === undefined) continue;
          (inv as Record<string, unknown>)[k] = prev[k] ?? null;
          if (v === null) delete next[k]; else (next as Record<string, unknown>)[k] = v;
        }
        if (op.name !== undefined) {
          if (scratch.names.has(`${prev.in.parent}/${op.name}`)) { failures.push(fail(i, 'name.taken', op.name)); return; }
          inv.name = prev.name; next.name = op.name;
        }
        scratch.delete(id); clearGround(scratch, prev, diff);
        if (op.params) prepareEntity(scratch, def, next, op.params);
        if (op.params || op.constraints) { const problem = admit(scratch, next, def, i, 'strict', false); if (problem) { failures.push(problem); return; } }
        scratch.insert(next); indexAndGround(scratch, next, def, diff);
        upsert(next);
        // children in slots the new params no longer have (a room that went away) move to the ground floor
        const orphans: Op[] = [];
        if (op.params) {
          const oldSlots = scratch.bake(def, prev.params ?? {}, prev.seed ?? 0, prev.shape).slots, newSlots = scratch.slotsOf(next);
          for (const cid of [...(scratch.children.get(id) ?? [])]) {
            const c = scratch.entities.get(cid); if (!c?.in.slot || newSlots.some((x) => x.id === c.in.slot)) continue;
            const from = oldSlots.find((x) => x.id === c.in.slot), ground = newSlots.some((x) => x.id === 'ground');
            const lp = c.p ?? [0, 0], lx = lp[0], lz = lp[lp.length - 1];
            const moved: Entity = { ...c, v: c.v + 1, in: ground ? { parent: id, slot: 'ground' } : { parent: id }, p: [(from?.p[0] ?? 0) + lx, 0, (from?.p[2] ?? 0) + lz] };
            scratch.delete(cid); scratch.insert(moved); indexAndGround(scratch, moved, scratch.resolvedDef(moved.def)!, diff); upsert(moved);
            orphans.push({ op: 'move', id: cid, in: c.in, p: c.p ?? [0, 0], r: c.r ?? 0, s: c.s ?? 1, mode: 'strict' } as Op);
            warnings.push(`${scratch.pathOf(cid)}: ${c.in.slot} is gone; moved to the ground floor`);
          }
        }
        for (const o of orphans) inverse.unshift(o);
        inverse.unshift(inv);
        return;
      }
      case 'clone': {
        const srcId = resolveId(op.id, i); if (!srcId || srcId === 'world') return;
        const src = scratch.entities.get(srcId)!;
        const parentId = op.in ? resolveId(op.in.parent, i) : src.in.parent; if (!parentId) return;
        const base = op.p ?? (src.p ? [src.p[0], src.p[src.p.length - 1]] as [number, number] : [0, 0] as [number, number]);
        const step = op.step ?? (op.count > 1 ? [Math.max(2, scratch.bake(scratch.resolvedDef(src.def)!, src.params ?? {}, src.seed ?? 0, src.shape).box[0] * 1.5), 0] as [number, number] : [0, 0] as [number, number]);
        const subtree = scratch.subtree(srcId).map((id) => scratch.entities.get(id)!);
        for (let k = 0; k < op.count; k++) {
          const map = new Map<string, string>();
          for (const orig of subtree) map.set(orig.id, scratch.nextId());
          let rootName = op.name ? (op.count > 1 ? `${op.name}-${k + 1}` : op.name) : src.name ? uniqueName(scratch, parentId, src.name) : undefined;
          if (rootName && scratch.names.has(`${parentId}/${rootName}`)) rootName = uniqueName(scratch, parentId, rootName);
          for (const orig of subtree) {
            const isRoot = orig.id === srcId;
            const copy: Entity = { ...structuredClone(orig), id: map.get(orig.id)!, by, born: tick, v: 1, in: isRoot ? { parent: parentId, ...(op.in?.slot ? { slot: op.in.slot } : {}) } : { ...orig.in, parent: map.get(orig.in.parent) ?? orig.in.parent } };
            if (isRoot) {
              if (rootName) copy.name = rootName; else delete copy.name;
              const x = base[0] + step[0] * (op.p || op.count > 1 ? k : k + 1), z = base[base.length - 1] + step[1] * (op.p || op.count > 1 ? k : k + 1);
              copy.p = base.length === 3 && op.p ? [x, base[1], z] : [x, z];
              if (op.r !== undefined) copy.r = op.r;
              if (copy.shape) copy.shape = shiftShape(copy.shape, x - (src.p?.[0] ?? 0), z - (src.p?.[src.p.length - 1] ?? 0));
              if (copy.seed !== undefined) copy.seed = (copy.seed + k + 1) | 0;
              const cdef = scratch.resolvedDef(copy.def)!;
              if (copy.shape) prepareEntity(scratch, cdef, copy, undefined);
              const problem = admit(scratch, copy, cdef, i, op.mode, true);
              if (problem) { failures.push(problem); return; }
            }
            scratch.insert(copy); indexAndGround(scratch, copy, scratch.resolvedDef(copy.def)!, diff); upsert(copy);
          }
          const rootCopy = map.get(srcId)!;
          if (op.tmp) ids[op.count > 1 ? `${op.tmp}${k + 1}` : op.tmp] = rootCopy;
          ids[rootCopy] = rootCopy;
          inverse.unshift({ op: 'remove', id: rootCopy, cascade: true });
        }
        return;
      }
      case 'world': {
        // a patch: each key merges into what is there (sky, time, weather, ground field by field); keys it does not name keep their values
        const cur = scratch.state as Record<string, unknown>, next: Record<string, unknown> = { ...cur };
        for (const [k, v] of Object.entries(op.state)) if (v !== undefined) next[k] = v !== null && typeof v === 'object' ? { ...(cur[k] as object | undefined), ...v } : v;
        const merged = worldStateSchema.parse(next);
        const prevPatch: Record<string, unknown> = {}, changed: Record<string, unknown> = {};
        for (const k of Object.keys(op.state)) {
          prevPatch[k] = cur[k]; changed[k] = (merged as Record<string, unknown>)[k];
          // a field the patch sets that was absent before (an optional, nullable one: time.set, weather.strike) undoes to null
          const pv = (op.state as Record<string, unknown>)[k], was = cur[k];
          if (pv && typeof pv === 'object' && was && typeof was === 'object') { const back = { ...(was as object) } as Record<string, unknown>; let added = false; for (const f of Object.keys(pv)) if (!(f in back)) { back[f] = null; added = true; } if (added) prevPatch[k] = back; }
        }
        scratch.state = merged; diff.world = { ...(diff.world ?? {}), ...changed };
        inverse.unshift({ op: 'world', state: prevPatch as never });
        return;
      }
      case 'expand': {
        // GOD-ENV: the world's bounds are the ground recipe's extent [x0, z0, x1, z1] (a rectangle); `extent` grows the
        // centred square (the original op), `bounds` any side. Forward: grow only. The inverse (trusted) shrinks back,
        // refused when anything now stands in the land it would take away.
        const old = boundsOf(scratch), oldExtent = scratch.constants.extent;
        if (op.extent === undefined && !op.bounds) { failures.push(fail(i, 'schema', 'expand needs extent (a centred square, m) or bounds [x0, z0, x1, z1]')); return; }
        let nb: [number, number, number, number] = op.bounds ? [...op.bounds] : [...old];
        if (op.extent !== undefined && !op.bounds) { const h = op.extent / 2; nb = [Math.min(old[0], -h), Math.min(old[1], -h), Math.max(old[2], h), Math.max(old[3], h)]; }
        if (!(nb[2] > nb[0] && nb[3] > nb[1]) || nb[2] - nb[0] > 16000 || nb[3] - nb[1] > 16000) { failures.push(fail(i, 'size.range', `bounds [${nb.join(', ')}]: each side 0 < … ≤ 16000 m`)); return; }
        const shrinks = nb[0] > old[0] + 1e-9 || nb[1] > old[1] + 1e-9 || nb[2] < old[2] - 1e-9 || nb[3] < old[3] - 1e-9;
        if (shrinks && !opts.trusted) { failures.push(fail(i, 'constant.immutable', 'the world only grows (undo an extension to take it back)')); return; }
        if (op.extent !== undefined && op.extent < oldExtent && !opts.trusted) { failures.push(fail(i, 'constant.immutable', 'extent only grows')); return; }
        if (shrinks) {
          const out = [...scratch.entities.values()].find((e) => { if (e.in.parent !== 'world') return false; const b = rootBox(scratch, e); return b[0] < nb[0] - 1e-6 || b[1] < nb[1] - 1e-6 || b[2] > nb[2] + 1e-6 || b[3] > nb[3] + 1e-6; });
          if (out) { failures.push(fail(i, 'undo.conflict', `${scratch.pathOf(out.id)} stands on the land this would take away`)); return; }
        }
        const extent = op.extent ?? oldExtent;   // the centred square's side; directional growth lives in the bounds
        scratch.constants = { ...scratch.constants, extent };
        scratch.terrain.update({ ...scratch.ground(), extent: nb }, []);
        diff.constants = scratch.constants;
        inverse.unshift({ op: 'expand', bounds: old, extent: oldExtent });
        return;
      }
      case 'answer': { diff.answers.push({ prayer: op.prayer, text: op.text }); return; }
      // LAYERS: currency, wallets and relationships live in state.layers (made on first use; viewers never get wallets)
      case 'economy': {
        const L = layersOf(scratch), prev = L.currency ?? null;
        const next = { ...L }; if (op.currency === null) delete next.currency; else next.currency = op.currency;
        scratch.state = { ...scratch.state, layers: next }; layersTouched = true;
        inverse.unshift({ op: 'economy', currency: prev });
        return;
      }
      case 'mint': case 'pay': {
        const L = layersOf(scratch), w = { ...L.wallets };
        const from = op.op === 'pay' ? op.from : null, to = op.to, amount = op.amount;
        if (from !== null && from === to) { failures.push(fail(i, 'schema', 'pay: from and to are the same wallet')); return; }
        const after = (ref: string, d: number) => Math.round(((w[ref] ?? 0) + d) * 100) / 100;
        if (from !== null) { const left = after(from, -amount); if (left < 0) { failures.push(fail(i, 'wallet.insufficient', `${from} has ${w[from] ?? 0}${L.currency ? ' ' + L.currency : ''}; ${amount} is more`)); return; } w[from] = left; }
        const got = after(to, amount); if (got < 0) { failures.push(fail(i, 'wallet.insufficient', `${to} has ${w[to] ?? 0}${L.currency ? ' ' + L.currency : ''}; cannot take ${-amount}`)); return; }
        w[to] = got;
        for (const k of Object.keys(w)) if (w[k] === 0) delete w[k];
        scratch.state = { ...scratch.state, layers: { ...L, wallets: w } }; layersTouched = true;
        inverse.unshift(op.op === 'pay' ? { op: 'pay', from: to, to: from!, amount, ...(op.for ? { for: `undo: ${op.for}`.slice(0, 120) } : {}) } : { op: 'mint', to, amount: -amount });
        return;
      }
      case 'relate': {
        const end = (r: string): string | null => {
          if (!r.startsWith('thing:')) return r;
          const e = scratch.get(r.slice(6)); if (!e) { failures.push(fail(i, 'relation.invalid', `${r}: no such thing`)); return null; }
          return `thing:${e.id}`;
        };
        const a = end(op.a), b = end(op.b); if (!a || !b) return;
        if (a === b) { failures.push(fail(i, 'relation.invalid', 'a relation needs two different ends')); return; }
        const L = layersOf(scratch), has = L.relations.some((x) => x.a === a && x.rel === op.rel && x.b === b);
        if (has === op.on) return;   // already so: nothing to do, nothing to undo
        const relations = op.on ? [...L.relations, { a, rel: op.rel, b }] : L.relations.filter((x) => !(x.a === a && x.rel === op.rel && x.b === b));
        scratch.state = { ...scratch.state, layers: { ...L, relations } }; layersTouched = true;
        inverse.unshift({ op: 'relate', a, rel: op.rel, b, on: !op.on });
        return;
      }
      case 'restore': {
        if (!opts.trusted) { failures.push(fail(i, 'schema', 'restore is internal')); return; }
        const e = op.entity; const def = scratch.resolvedDef(e.def);
        if (!def) { failures.push(fail(i, 'def.unknown', e.def)); return; }
        if (e.in.parent !== 'world' && !scratch.entities.has(e.in.parent)) { failures.push(fail(i, 'parent.unknown', e.in.parent)); return; }
        const problem = admit(scratch, e, def, i, 'strict', false);
        if (problem) { failures.push({ ...problem, code: 'undo.conflict' }); return; }
        scratch.insert(e); indexAndGround(scratch, e, def, diff); upsert(e);
        inverse.unshift({ op: 'remove', id: e.id, cascade: true });
        return;
      }
    }
  });

  if (failures.length) return { ok: false, failures: heldBack.length && heldBack[0].op <= failures[0].op ? [heldBack[0]] : failures };
  // Persistent relationships: re-solve server-maintained constraints whose refs moved or whose ground changed (33 §3.3).
  const resolved = resolveDependents(scratch, touched, new Set(diff.removes), new Set(diff.tiles), warnings, diff.tiles);
  for (const id of resolved) touched.add(id);
  for (const id of touched) { const e = scratch.entities.get(id); if (e) diff.upserts.push(e); }
  diff.tiles = [...new Set(diff.tiles)];
  if (layersTouched) diff.layers = true;
  const refused = opts.refuse?.(scratch, diff, ops);
  if (refused) return { ok: false, failures: [refused] };
  if (heldBack.length) return { ok: false, failures: [heldBack[0]] };
  const seq = world.editSeq + 1;
  const undoId = 'u_' + hashOf([world.seed, seq]).slice(0, 10);
  return {
    ok: true, ids, warnings, diff,
    apply() {
      // Commit = replace the live model's structure with the scratch's. Cheap enough for now (maps copy), and
      // guarantees the live model equals the simulated one. Tile caches carry over via the ground record.
      world.seq = scratch.seq; world.editSeq = seq; world.state = scratch.state; world.constants = scratch.constants;
      world.defs = scratch.defs; world.entities = scratch.entities; world.children = scratch.children; world.names = scratch.names;
      (world as unknown as { footprints: unknown; cells: unknown; bakes: unknown }).footprints = (scratch as unknown as { footprints: unknown }).footprints;
      (world as unknown as { cells: unknown }).cells = (scratch as unknown as { cells: unknown }).cells;
      (world as unknown as { bakes: unknown }).bakes = (scratch as unknown as { bakes: unknown }).bakes;
      world.terrain = scratch.terrain;
      return { seq, undoId, diff, inverse };
    },
  };
}

/** Plan + apply in one step (the server's path). */
export function applyBatch(world: WorldModel, input: unknown, by: string, tick: number, opts?: PlanOptions): { result: Result; diff?: Diff; inverse?: Op[] } {
  const p = plan(world, input, by, tick, opts);
  if (!p.ok) return { result: { accepted: false, failures: p.failures } };
  const { seq, undoId, diff, inverse } = p.apply();
  return { result: { accepted: true, seq, undoId, ids: p.ids, warnings: p.warnings }, diff, inverse };
}

// ---------- helpers ----------

/** state.layers with its defaults (a world that has none gets one on the first layers op). */
function layersOf(w: WorldModel): LayersState { return layersStateSchema.parse(w.state.layers ?? {}); }
/** A schedule's `follow` fields must be state fields of the def, and their values valid. */
function followProblem(def: StoredDef, s: Schedule | null | undefined): string | null {
  for (const f of s?.follow ?? []) {
    if (!def.state[f.field]) return `schedule.follow: ${def.name} has no state field ${f.field} (it has ${Object.keys(def.state).join(', ') || 'none'})`;
    for (const v of [f.is, ...(f.else !== undefined ? [f.else] : [])]) { const ok = checkFields(def.state, { [f.field]: v }, false); if (!ok.ok) return `schedule.follow: ${ok.detail}`; }
  }
  return null;
}

/** The world's bounds [x0, z0, x1, z1] (m): the ground recipe's extent (GOD-ENV; ±extent/2 on worlds never extended). */
export function boundsOf(w: WorldModel): [number, number, number, number] { const e = w.ground().extent; return [e[0], e[1], e[2], e[3]]; }
/** A root entity's ground-plan box [x0, z0, x1, z1]: its shape's points, or its position. */
function rootBox(w: WorldModel, e: Entity): [number, number, number, number] {
  const sh = e.shape as { area?: [number, number][]; path?: [number, number][] } | undefined, pts = sh?.area ?? sh?.path;
  if (pts?.length) { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of pts) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); } return [x0, z0, x1, z1]; }
  const p = w.worldPose(e); return [p.x, p.z, p.x, p.z];
}

function isBody(w: WorldModel, e: Entity): boolean { return !!w.resolvedDef(e.def)?.components.body; }

function checkDef(w: WorldModel, def: Parameters<WorldModel['defineDef']>[0], i: number): Failure | null {
  const lim = w.constants.limits;
  const box = def.size?.box;
  if (!box) return fail(i, 'def.invalid', 'size.box required');
  if (box[0] > lim.sizeMax[0] || box[1] > lim.sizeMax[1] || box[2] > lim.sizeMax[2]) return fail(i, 'size.range', `box ${box.join('×')} exceeds world limit ${lim.sizeMax.join('×')}`);
  if (Math.min(...box) < lim.sizeMin) return fail(i, 'size.range', `box below ${lim.sizeMin} m`);
  if (def.make.kind === 'mesh') {
    const info = w.assets(def.make.asset);
    if (!info) return fail(i, 'def.invalid', `asset ${def.make.asset.slice(0, 12)}… not uploaded`);
    if (info.tris > lim.budget.tris) return fail(i, 'def.budget', `${info.tris} tris > ${lim.budget.tris}`);
    if (info.bytes > lim.budget.bytes) return fail(i, 'def.budget', `${info.bytes} bytes > ${lim.budget.bytes}`);
    (def as { budget?: unknown }).budget = { tris: info.tris, bytes: info.bytes, textures: info.textures };
  }
  if (def.make.kind === 'gen' && !(def.make.gen in (globalThis as never as { __gens?: never }) ) ) { /* generator existence is checked at bake */ }
  if (def.make.kind === 'parts') {
    let total = 0;
    const walk = (parts: typeof def.make.parts, depth: number): string | null => {
      if (depth > 4) return 'prefab nesting deeper than 4';
      for (const p of parts) {
        total++; if (total > 256) return 'prefab expands to more than 256 parts';
        const d = w.resolvedDef(p.def); if (!d) return `part ${p.id}: def ${p.def} unknown`;
        if (d.make.kind === 'parts') { const r = walk(d.make.parts, depth + 1); if (r) return r; }
      }
      return null;
    };
    const r = walk(def.make.parts, 1);
    if (r) return fail(i, 'def.expansion', r);
  }
  if (def.extends && !w.def(def.extends)) return fail(i, 'def.unknown', `extends ${def.extends}`);
  return null;
}

/** L3: freeze what a path/area generator needs from the ground (road grade + bridges, river flow + snapped ends, deck heights) into the entity's params, before admission. Explicitly given params win. */
function prepareEntity(w: WorldModel, def: StoredDef, e: Entity, explicit: Record<string, unknown> | undefined) {
  if (def.make.kind !== 'gen' || def.form === 'point' || !e.shape) return;
  const prep = prepareFor(def.make.gen, queryOf(w), e.shape as never, e.params ?? {});
  if (!prep) return;
  let took = false;
  for (const [k, v] of Object.entries(prep.params)) if (def.params[k] && explicit?.[k] === undefined) { e.params = { ...(e.params ?? {}), [k]: v }; took = true; }
  if (took && prep.path && 'path' in e.shape) e.shape = { ...e.shape, path: prep.path };
}

/** Physical admission of an entity at its (new) pose: size, extent, support/settle, slot, overlap. May adjust `e.p` (settle y, nudge). */
function admit(w: WorldModel, e: Entity, def: StoredDef, i: number, mode: 'strict' | 'nudge', creating: boolean): Failure | null {
  const s = e.s ?? 1;
  if (s < def.size.scale[0] || s > def.size.scale[1]) return fail(i, 'size.range', `scale ${s} outside [${def.size.scale.join(', ')}]`);
  const baked = w.bake(def, e.params ?? {}, e.seed ?? 0, e.shape);
  // generators report design faults as `violation:` notes (building/1: sealed rooms, blocked stairs, headroom)
  const violations = (baked.notes ?? []).filter((n) => n.startsWith('violation: '));
  if (violations.length) return fail(i, 'architecture', violations.map((n) => n.slice(11)).join('; '));
  const lim = w.constants.limits.sizeMax;
  if (def.layer === 'solid' && (baked.box[0] * s > lim[0] || baked.box[1] * s > lim[1] || baked.box[2] * s > lim[2])) return fail(i, 'size.range', `${baked.box.map((v) => (v * s).toFixed(1)).join('×')} exceeds ${lim.join('×')}`);
  // slot compatibility
  if (e.in.parent !== 'world') {
    const parent = w.entities.get(e.in.parent);
    if (!parent) return fail(i, 'parent.unknown', e.in.parent);
    if (e.in.slot) {
      const slot = w.slotsOf(parent).find((x) => x.id === e.in.slot);
      if (!slot) return fail(i, 'slot.unknown', `${w.pathOf(parent.id)} has no slot ${e.in.slot}`);
      if (slot.accepts.kinds && !slot.accepts.kinds.includes(def.name) && !def.tags.some((t) => slot.accepts.kinds!.includes(t))) return fail(i, 'slot.incompatible', `${e.in.slot} accepts ${slot.accepts.kinds.join(', ')}`);
      if (slot.accepts.tags && !def.tags.some((t) => slot.accepts.tags!.includes(t))) return fail(i, 'slot.incompatible', `${e.in.slot} accepts tags ${slot.accepts.tags.join(', ')}`);
      if (slot.accepts.maxSize && (baked.box[0] * s > slot.accepts.maxSize[0] || baked.box[1] * s > slot.accepts.maxSize[1] || baked.box[2] * s > slot.accepts.maxSize[2])) return fail(i, 'slot.incompatible', 'too big for the slot');
      const occupants = [...(w.children.get(parent.id) ?? [])].filter((c) => c !== e.id && w.entities.get(c)?.in.slot === e.in.slot).length;
      if (occupants >= slot.capacity) return fail(i, 'slot.full', `${e.in.slot} holds ${slot.capacity}`);
      // a slot with a polygon (rooms, floors): the child's centre lies on it; p in a slot is relative to the slot's origin, in the parent's frame
      if (slot.polygon && slot.polygon.length >= 3) {
        const lp = e.p ?? [0, 0], x = lp[0], z = lp[lp.length - 1], out = outsideBy(x, z, slot.polygon);
        if (out > 0.05) return fail(i, 'slot.outside', `(${x.toFixed(2)}, ${z.toFixed(2)}) is ${out.toFixed(2)} m outside ${e.in.slot}; p in a slot is relative to the slot's origin`);
      }
    }
  }
  // along: position (and turn to face) a point on a path entity before settling
  const along = e.constraints?.find((c) => c.kind === 'along') as { kind: 'along'; ref: string; t: number; side: 'center' | 'left' | 'right'; offset: number } | undefined;
  if (along && e.in.parent === 'world') {
    const ref = w.get(along.ref);
    if (!ref || !ref.shape || !('path' in ref.shape)) return fail(i, 'constraint.unsatisfied', `along: ${along.ref} is not a path entity`);
    const sideK = along.side === 'left' ? -1 : along.side === 'right' ? 1 : 0;   // offsetPolyline(+d) is the walker's right (+z is south)
    const path = sideK ? offsetPolyline(ref.shape.path, sideK * ((ref.shape.width ?? 0) / 2 + along.offset)) : ref.shape.path;
    const { p: at, dir } = pointAlong(path, along.t);
    e.p = [at[0], at[1]];
    // front faces the path: rotate toward the centre line (for side placements), else along the travel direction
    e.r = sideK ? Math.atan2(sideK * dir[1], -sideK * dir[0]) : Math.atan2(dir[0], dir[1]);
  }
  // settle on the ground when at the root with a 2-D position
  if (e.in.parent === 'world') {
    const p = e.p ?? [0, 0];
    const bb = boundsOf(w);
    if (p[0] < bb[0] || p[0] > bb[2] || p[p.length - 1] < bb[1] || p[p.length - 1] > bb[3]) return fail(i, 'extent.outside', `(${p[0]}, ${p[p.length - 1]}) is outside the world [${bb.join(', ')}] (x0, z0, x1, z1)`);
    const floatC = e.constraints?.find((c) => c.kind === 'float') as { kind: 'float'; sink: number } | undefined;
    const anchorKind = floatC ? 'float' : (e.anchor ?? def.anchor);
    if (anchorKind === 'float') {
      const x = p[0], z = p[p.length - 1];
      const level = waterLevelAt(w.ground(), x, z);
      if (level === null) return fail(i, 'float.no-water', `no water at (${x.toFixed(1)}, ${z.toFixed(1)}); place it on a lake, pond, river or the sea`);
      e.p = [x, level - (floatC?.sink ?? 0), z];
    } else if (def.form !== 'point') {
      // world-frame shapes (roads, walls, lawns…): heights are ground-relative per point (or absolute with `abs`); no settle
      e.p = [0, 0, 0];
    } else if (p.length === 2 && def.layer !== 'volume' && !baked.landform) {
      const yaw = typeof e.r === 'number' ? e.r : Array.isArray(e.r) ? e.r[0] : 0;
      const fp = footprintOf(p[0], p[1], (baked.box[0] * s) / 2, (baked.box[2] * s) / 2, yaw);
      const anchor = anchorKind as Exclude<typeof anchorKind, 'float'>;
      const st = settle(w.terrain, fp, anchor, { maxTiltRad: def.tilt ? (def.tilt.maxDeg * Math.PI) / 180 : 0 });
      e.p = [p[0], st.y, p[1]];
      if (anchor === 'conform' && st.pitch !== undefined) e.r = [yaw, st.pitch, st.roll ?? 0];
      if (anchor === 'base' && st.needsPad && (def.components.foundation?.kind ?? 'pad') === 'pad') {
        (e as Entity & { _pad?: Landform })._pad = padFor(`${e.id}:pad`, fp, st.y);
      }
    } else if (p.length === 3 && (e.anchor ?? def.anchor) === 'base' && def.layer !== 'volume' && !baked.landform && (def.components.foundation?.kind ?? 'pad') === 'pad') {
      // a pre-settled pose (restore after undo, or an explicit y): keep y, but a building on a slope still needs its terrace
      const yaw = typeof e.r === 'number' ? e.r : Array.isArray(e.r) ? e.r[0] : 0;
      const fp = footprintOf(p[0], p[2], (baked.box[0] * s) / 2, (baked.box[2] * s) / 2, yaw);
      const st = settle(w.terrain, fp, 'base');
      if (st.needsPad || Math.abs(st.y - p[1]) > SKIRT_MAX) (e as Entity & { _pad?: Landform })._pad = padFor(`${e.id}:pad`, fp, p[1]);
    }
  }
  // facing: turn the entity's front (+z) toward the ref
  const facing = e.constraints?.find((c) => c.kind === 'facing') as { kind: 'facing'; ref: string; offset: number } | undefined;
  if (facing) {
    const ref = w.get(facing.ref);
    if (!ref) return fail(i, 'constraint.unsatisfied', `facing: no such ref ${facing.ref}`);
    const me = w.worldPose(e), them = aimOf(w, ref);
    const parentYaw = e.in.parent === 'world' ? 0 : w.worldPose(w.entities.get(e.in.parent)!).yaw;
    const yaw = Math.atan2(them.x - me.x, them.z - me.z) - parentYaw + facing.offset;
    e.r = Array.isArray(e.r) ? [yaw, e.r[1], e.r[2]] : yaw;
  }
  // overlap (solids only; ancestors, descendants and declared overlaps are exempt)
  if (def.layer === 'solid' && baked.colliders.length) {
    const boxes = w.footprint(e, def);
    // inside an enterable thing (rooms: building/1): never through its walls, stairs, rails or posts
    for (let pid = e.in.parent; pid !== 'world';) {
      const pe = w.entities.get(pid); if (!pe) break;
      const pd = w.resolvedDef(pe.def);
      if (pd) {
        const pb = w.bake(pd, pe.params ?? {}, pe.seed ?? 0, pe.shape);
        if (pb.rooms?.length) {
          const fp = w.footprint(pe, pd);
          for (const a of boxes) for (let k = 0; k < fp.length; k++) if (obbOverlap(a, fp[k])) {
            if (mode === 'nudge') { const nudged = nudge(w, e, def, boxes, fp[k]); if (nudged) { e.p = nudged; return admit(w, e, def, i, 'strict', creating); } }
            return fail(i, 'overlap.solid', `crosses ${w.pathOf(pe.id)} ${pb.colliders[k]?.tag ?? 'wall'}`, localSuggest(w, e, envelope(boxes), suggestFrom(envelope(boxes), fp[k])));
          }
        }
      }
      pid = pe.in.parent;
    }
    const exempt = new Set([e.id, ...w.subtree(e.id)]);
    for (let pid: string | undefined = e.in.parent === 'world' ? undefined : e.in.parent; pid; pid = w.entities.get(pid)?.in.parent === 'world' ? undefined : w.entities.get(pid)?.in.parent) exempt.add(pid);
    for (const other of w.near(boxes)) {
      if (exempt.has(other)) continue;
      const oe = w.entities.get(other); if (!oe) continue;
      const od = w.resolvedDef(oe.def); if (!od) continue;
      if (def.overlaps.some((t) => od.tags.includes(t) || od.name === t) || od.overlaps.some((t) => def.tags.includes(t) || def.name === t)) continue;
      if (w.ancestors(other).has(e.id)) continue;
      for (const a of boxes) for (const b of w.footprintsOf(other)) if (obbOverlap(a, b)) {
        if (mode === 'nudge') {
          const nudged = nudge(w, e, def, boxes, b);
          if (nudged) { e.p = nudged; return admit(w, e, def, i, 'strict', creating); }
        }
        const label = oe.name ? w.pathOf(other) : `${od.name} ${other}`;
        return fail(i, 'overlap.solid', `overlaps ${label}`, localSuggest(w, e, envelope(boxes), suggestFrom(envelope(boxes), b)));
      }
    }
  }
  return null;
}

/** How far a point lies outside a polygon (0 inside). */
function outsideBy(x: number, z: number, poly: [number, number][]): number {
  let inside = false, best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    const dx = xj - xi, dz = zj - zi, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - xi) * dx + (z - zi) * dz) / l2));
    best = Math.min(best, Math.hypot(x - xi - t * dx, z - zi - t * dz));
  }
  return inside ? 0 : best;
}

/** One round box around all of a thing's boxes (a suggestion must clear the whole thing, not the box that touched). */
function envelope(boxes: OBB[]): OBB {
  if (boxes.length === 1) return boxes[0];
  let x = 0, z = 0; for (const b of boxes) { x += b.c[0]; z += b.c[1]; } x /= boxes.length; z /= boxes.length;
  let r = 0; for (const b of boxes) r = Math.max(r, Math.hypot(b.c[0] - x, b.c[1] - z) + Math.hypot(b.half[0], b.half[1]));
  const h = r / Math.SQRT2;
  return { c: [x, z], half: [h, h], yaw: 0, y0: Math.min(...boxes.map((b) => b.y0)), y1: Math.max(...boxes.map((b) => b.y1)) };
}
function suggestFrom(a: OBB, b: OBB): Failure['suggest'] {
  let dx = a.c[0] - b.c[0], dz = a.c[1] - b.c[1], len = Math.sqrt(dx * dx + dz * dz);
  const apart = len;
  if (len < 1e-6) { dx = 1; dz = 0; len = 1; } // coincident centres: push east (the whole way: they are 0 apart, not 1)
  const push = Math.sqrt(a.half[0] ** 2 + a.half[1] ** 2) + Math.sqrt(b.half[0] ** 2 + b.half[1] ** 2) - apart + 0.2;
  return { p: [Math.round((a.c[0] + (dx / len) * push) * 100) / 100, Math.round((a.c[1] + (dz / len) * push) * 100) / 100] };
}
/** suggestFrom works on world boxes; a child's `p` is in its parent's (slot) frame — move the suggestion there. */
function localSuggest(w: WorldModel, e: Entity, a: OBB, s: Failure['suggest']): Failure['suggest'] {
  if (!s?.p || e.in.parent === 'world') return s;
  const me = w.worldPose(e), lp = w.localPose(e), yaw = me.yaw - lp.yaw, k = lp.s / (me.s || 1);
  const dx = s.p[0] - a.c[0], dz = s.p[1] - a.c[1], c = Math.cos(yaw), sn = Math.sin(yaw);
  const lx = (dx * c - dz * sn) * k, lz = (dx * sn + dz * c) * k, p = e.p ?? [0, 0];
  return { ...s, p: [Math.round((p[0] + lx) * 100) / 100, Math.round((p[p.length - 1] + lz) * 100) / 100] };
}
function nudge(w: WorldModel, e: Entity, _def: StoredDef, mine: OBB[], other: OBB): [number, number] | null {
  const env = envelope(mine), s = localSuggest(w, e, env, suggestFrom(env, other));
  if (!s?.p) return null;
  const p = e.p ?? [0, 0];
  const moved = Math.hypot(s.p[0] - p[0], s.p[1] - p[p.length - 1]);
  return moved <= 6 ? [s.p[0], s.p[1]] : null;
}

/** After admission: index solids, and install any landform / water / foundation pad the entity brings. */
function indexAndGround(w: WorldModel, e: Entity, def: StoredDef, diff: Diff) {
  const baked = w.bake(def, e.params ?? {}, e.seed ?? 0, e.shape);
  if (def.layer === 'solid' && baked.colliders.length) w.index(e.id, w.footprint(e, def));
  if (baked.landform) {
    const wp = w.worldPose(e);
    const lf = placeLandform(baked.landform, wp, e.id);
    for (const t of w.terrain.update(w.ground(), [])) diff.tiles.push(t);
    const changed = w.setLandform(lf, e.id);
    for (const c of changed) for (const t of w.terrain.invalidate(c)) diff.tiles.push(t);
  }
  if (baked.water && e.shape && 'area' in e.shape) w.setWater({ id: e.id, area: e.shape.area, level: baked.water.level }, e.id);
  else if (baked.water && e.shape && 'path' in e.shape) {
    const bw = baked.water as typeof baked.water & { levels?: number[] };
    const path = bw.path ?? e.shape.path;
    w.setWater({ id: e.id, path, w: bw.width ?? e.shape.width ?? 4, level: bw.level, ...(bw.levels && bw.levels.length === path.length ? { levels: bw.levels } : {}) }, e.id);
  }
  const pad = (e as Entity & { _pad?: Landform })._pad;
  if (pad) { delete (e as Entity & { _pad?: Landform })._pad; for (const c of w.setLandform(pad, pad.id)) for (const t of w.terrain.invalidate(c)) diff.tiles.push(t); }
}
function clearGround(w: WorldModel, e: Entity, diff: Diff) {
  for (const c of w.setLandform(null, e.id)) for (const t of w.terrain.invalidate(c)) diff.tiles.push(t);
  for (const c of w.setLandform(null, `${e.id}:pad`)) for (const t of w.terrain.invalidate(c)) diff.tiles.push(t);
  w.setWater(null, e.id);
}
/** A def's landform is authored in the def frame; bumps move to the entity's world position, shapes are already in world metres. */
function placeLandform(lf: NonNullable<ReturnType<WorldModel['bake']>['landform']>, wp: { x: number; z: number; s: number }, id: string): Landform {
  if (lf.kind === 'bump') return { ...lf, id, c: [wp.x + lf.c[0] * wp.s, wp.z + lf.c[1] * wp.s], r: lf.r * wp.s, h: lf.h * wp.s };
  if (lf.kind === 'brush') return { ...lf, id, c: [wp.x + lf.c[0] * wp.s, wp.z + lf.c[1] * wp.s], r: lf.r * wp.s };
  return { ...lf, id } as Landform;
}

function expandParts(w: WorldModel, root: Entity, def: StoredDef, by: string, tick: number, diff: Diff, inverse: Op[], upsert: (e: Entity) => void, depth = 1) {
  if (def.make.kind !== 'parts') return;
  const local: Record<string, string> = {};
  const rp = root.params ?? {};
  for (const part of def.make.parts) {
    if (part.when !== undefined && !truthy(evaluate(part.when, rp))) continue;
    const pdef = w.resolvedDef(part.def); if (!pdef) continue;
    const count = part.repeat ? Math.max(0, Math.min(64, Math.round(Number(typeof part.repeat.count === 'number' ? part.repeat.count : evaluate(part.repeat.count, rp)) || 0))) : 1;
    for (let k = 0; k < count; k++) {
      const params = Object.fromEntries(Object.entries(part.params ?? {}).map(([key, v]) => [key, substitute(v, rp)]));
      const state = Object.fromEntries(Object.entries(part.state ?? {}).map(([key, v]) => [key, substitute(v, rp)]));
      const parentId = part.in ? local[part.in] ?? root.id : root.id;
      const p0 = part.p?.map((v) => (typeof v === 'number' ? v : Number(substitute(v as never, rp)))) as Entity['p'] | undefined;
      const step = part.repeat?.step ?? [0, 0];
      const p = p0 ? (p0.length === 3 ? [p0[0] + step[0] * k, p0[1], p0[2] + step[1] * k] : [p0[0] + step[0] * k, p0[1] + step[1] * k]) as Entity['p'] : (k ? [step[0] * k, step[1] * k] as Entity['p'] : undefined);
      const yaw = (typeof part.r === 'number' ? part.r : 0) + (part.repeat?.yaw ?? 0) * k;
      const name = count > 1 ? `${part.id}-${k + 1}` : part.id;
      const e: Entity = { id: w.nextId(), name, def: pdef.ref, in: { parent: parentId, ...(part.slot ? { slot: part.slot } : {}) }, by, born: tick, v: 1, ...(p ? { p } : {}), ...(part.r !== undefined || part.repeat?.yaw ? { r: Array.isArray(part.r) ? part.r : yaw } : {}), ...(part.s !== undefined ? { s: part.s } : {}), ...(Object.keys(params).length ? { params } : {}), ...(Object.keys(state).length ? { state } : {}) };
      w.insert(e); indexAndGround(w, e, pdef, diff); upsert(e);
      if (k === 0) local[part.id] = e.id;
      if (pdef.make.kind === 'parts' && depth < 4) expandParts(w, e, pdef, by, tick, diff, inverse, upsert, depth + 1);
    }
  }
}
/** Tiny expression evaluator for prefab `when`/`repeat`: "$x", "!$x", "$x > 2", "$x * 2", "$x == cottage". */
function evaluate(expr: string, params: Record<string, Value>): Value {
  const t = expr.trim();
  if (t.startsWith('!')) return !truthy(evaluate(t.slice(1), params));
  const m = t.match(/^\$([a-zA-Z][a-zA-Z0-9_]*)(?:\s*(==|!=|>=|<=|>|<|[+\-*/])\s*(.+))?$/);
  if (!m) return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
  const a = params[m[1]];
  if (!m[2]) return a ?? null;
  const rhsRaw = m[3].trim(); const rhs: Value = /^-?\d+(\.\d+)?$/.test(rhsRaw) ? Number(rhsRaw) : rhsRaw === 'true' ? true : rhsRaw === 'false' ? false : rhsRaw.replace(/^['"]|['"]$/g, '');
  switch (m[2]) {
    case '==': return a === rhs; case '!=': return a !== rhs;
    case '>': return Number(a) > Number(rhs); case '<': return Number(a) < Number(rhs); case '>=': return Number(a) >= Number(rhs); case '<=': return Number(a) <= Number(rhs);
    case '+': return Number(a) + Number(rhs); case '-': return Number(a) - Number(rhs); case '*': return Number(a) * Number(rhs); case '/': return Number(a) / Number(rhs);
  }
  return null;
}
const truthy = (v: Value) => !(v === false || v === null || v === 0 || v === '' || v === undefined);
function uniqueName(w: WorldModel, parent: string, base: string): string {
  const stem = base.replace(/-\d+$/, '');
  for (let k = 2; k < 1000; k++) { const n = `${stem}-${k}`; if (!w.names.has(`${parent}/${n}`)) return n; }
  return `${stem}-${Date.now() % 100000}`;
}
function shiftShape(shape: NonNullable<Entity['shape']>, dx: number, dz: number): NonNullable<Entity['shape']> {
  if ('area' in shape) return { area: shape.area.map(([x, z]) => [x + dx, z + dz] as [number, number]) };
  return { ...shape, path: shape.path.map(([x, z]) => [x + dx, z + dz] as [number, number]) };
}
/** `$param` substitution and `+ - * /` with one operator: "$floors * 3", "$w / 2 + 1" is not supported (one op). */
function substitute(v: number | string | boolean, params: Record<string, Value>): Value {
  if (typeof v !== 'string' || !v.includes('$')) return v;
  if (/(==|!=|>=|<=|>|<)/.test(v) || v.trim().startsWith('!')) return evaluate(v, params);
  const m = v.trim().match(/^\$([a-z][a-z0-9_]*)(?:\s*([+\-*/])\s*(-?\d+(?:\.\d+)?))?$/);
  if (!m) return v;
  const base = params[m[1]];
  if (typeof base !== 'number' || !m[2]) return base ?? v;
  const n = Number(m[3]);
  return m[2] === '+' ? base + n : m[2] === '-' ? base - n : m[2] === '*' ? base * n : base / n;
}

const MAX_DEPENDENTS = 500;
const ROADS = new Set(['road/1', 'path/1']);
/** Does a polyline pass through any of these 64 m tiles (sampled every 8 m)? */
function crossesTiles(path: [number, number][], tiles: Set<string>, tileOf: (x: number, z: number) => string): boolean {
  for (let i = 0; i < path.length; i++) {
    const a = path[i], b = path[i + 1] ?? a, n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 8));
    for (let k = 0; k <= n; k++) if (tiles.has(tileOf(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n))) return true;
  }
  return false;
}
/** Re-solve `float`, `facing`, `along` and ground settling for entities affected by this batch. Returns ids changed. */
function resolveDependents(w: WorldModel, touched: Set<string>, removed: Set<string>, tiles: Set<string>, warnings: string[], outTiles: string[] = []): string[] {
  const changed: string[] = [];
  if (!touched.size && !tiles.size && !removed.size) return changed;
  const tileOfXZ = (x: number, z: number) => `${Math.floor(x / 64)},${Math.floor(z / 64)}`;
  for (const e of [...w.entities.values()]) {  // snapshot: re-inserting during iteration would revisit keys
    if (changed.length >= MAX_DEPENDENTS) { warnings.push(`more than ${MAX_DEPENDENTS} dependents; run resolve to finish`); break; }
    if (touched.has(e.id) && !e.constraints?.length) continue;
    const def = w.resolvedDef(e.def); if (!def) continue;
    let next: Entity | null = null;
    const cons = e.constraints ?? [];
    for (const c of cons) {
      if (c.kind === 'facing') {
        if (removed.has(w.get(c.ref)?.id ?? c.ref)) { warnings.push(`${w.pathOf(e.id)}: facing ref ${c.ref} was removed`); continue; }
        const ref = w.get(c.ref); if (!ref || !touched.has(ref.id)) continue;
        const me = w.worldPose(next ?? e), them = aimOf(w, ref);
        const parentYaw = e.in.parent === 'world' ? 0 : w.worldPose(w.entities.get(e.in.parent)!).yaw;
        const yaw = Math.atan2(them.x - me.x, them.z - me.z) - parentYaw + c.offset;
        next = { ...(next ?? e), r: Array.isArray(e.r) ? [yaw, e.r[1], e.r[2]] : yaw };
      } else if (c.kind === 'along') {
        const ref = w.get(c.ref); if (!ref || !touched.has(ref.id)) continue;
        next = { ...(next ?? e) };  // admit() recomputes the point on the path
      }
    }
    // roads and paths on changed tiles: a stream, river or lake added (or removed) across them since they were laid
    // gets (or loses) its bridge — the same prepare step that froze their grade, kept only when the crossings change
    if (e.in.parent === 'world' && tiles.size && !touched.has(e.id) && def.make.kind === 'gen' && ROADS.has(def.make.gen) && e.shape && 'path' in e.shape && crossesTiles(e.shape.path as [number, number][], tiles, tileOfXZ)) {
      const prep = prepareFor(def.make.gen, queryOf(w), e.shape as never, e.params ?? {});
      const spansOf = (g: unknown) => JSON.stringify(((g as { spans?: unknown[] } | undefined)?.spans ?? []).map((s) => { const x = s as { from: number; to: number }; return [Math.round(x.from), Math.round(x.to)]; }));
      if (prep?.params.grade && spansOf(prep.params.grade) !== spansOf(e.params?.grade)) {
        const n = ((prep.params.grade as { spans?: unknown[] }).spans ?? []).length;
        next = { ...(next ?? e), params: { ...(e.params ?? {}), grade: prep.params.grade } };
        warnings.push(`${w.pathOf(e.id)}: ${n ? `now bridges the water it crosses (${n} span${n > 1 ? 's' : ''})` : 'no longer crosses water (bridge removed)'}`);
      }
    }
    // ground: root things on changed tiles settle again (float re-reads the water level)
    if (e.in.parent === 'world' && e.p && tiles.size && !def.components.landform && def.layer !== 'volume') {
      const x = e.p[0], z = e.p[e.p.length - 1];
      if (tiles.has(tileOfXZ(x, z))) next = { ...(next ?? e), p: [x, z] };
    }
    if (!next) continue;
    // keep a pre-existing pad-free settle: re-admit (settles y, re-applies float/facing); skip if it no longer fits
    const prevP = e.p, prevR = e.r;
    const trial: Entity = { ...next, v: e.v + 1 };
    w.delete(e.id);
    // GOD-ENV: a building re-settles on the ground as it is now, so its old foundation pad comes up first (and goes
    // back if it cannot re-settle); a new pad is installed when the new ground needs one (as on a fresh placement)
    const padId = `${e.id}:pad`, oldPad = w.ground().landforms.find((l) => l.id === padId) ?? null;
    if (oldPad && trial.p) { trial.p = [trial.p[0], trial.p[trial.p.length - 1]]; for (const c of w.setLandform(null, padId)) for (const t of w.terrain.invalidate(c)) outTiles.push(t); }
    const problem = admitForResolve(w, trial, def);
    if (problem) { if (oldPad) for (const c of w.setLandform(oldPad, padId)) for (const t of w.terrain.invalidate(c)) outTiles.push(t); w.insert(e); w.index(e.id, w.footprint(e, def)); warnings.push(`${w.pathOf(e.id)}: ${problem}`); continue; }
    const pad = (trial as Entity & { _pad?: Landform })._pad;
    if (pad) { delete (trial as Entity & { _pad?: Landform })._pad; for (const c of w.setLandform(pad, pad.id)) for (const t of w.terrain.invalidate(c)) outTiles.push(t); }
    w.insert(trial); if (def.layer === 'solid') w.index(trial.id, w.footprint(trial, def));
    if (JSON.stringify(prevP) !== JSON.stringify(trial.p) || JSON.stringify(prevR) !== JSON.stringify(trial.r) || trial.params !== e.params) changed.push(e.id); else { w.delete(trial.id); w.insert(e); if (def.layer === 'solid') w.index(e.id, w.footprint(e, def)); }
  }
  return changed;
}
/** Settle-and-orient only (no overlap refusal: a dependent follows its ref even into a tight spot; warnings report it). */
function admitForResolve(w: WorldModel, e: Entity, def: StoredDef): string | null {
  const f = admit(w, e, def, -1, 'strict', false);
  if (!f) return null;
  return f.code === 'overlap.solid' ? null : `${f.code}: ${f.detail}`;
}

/** Where `facing` aims: an area's centroid or a path's midpoint (in the ref's frame), else the ref's origin. */
export function aimOf(w: WorldModel, ref: Entity): { x: number; z: number } {
  const pose = w.worldPose(ref), sh = ref.shape as { area?: [number, number][]; path?: [number, number][] } | undefined;
  let local: [number, number] | undefined;
  if (sh?.area?.length) { let x = 0, z = 0; for (const q of sh.area) { x += q[0]; z += q[1]; } local = [x / sh.area.length, z / sh.area.length]; }
  else if (sh?.path?.length) { const m = pointAlong(sh.path, 0.5).p; local = [m[0], m[1]]; }
  if (!local) return pose;
  const c = Math.cos(pose.yaw), sn = Math.sin(pose.yaw);
  return { x: pose.x + local[0] * c + local[1] * sn, z: pose.z - local[0] * sn + local[1] * c };
}
