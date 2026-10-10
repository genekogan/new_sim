// The compiler: a batch of ops → either a refusal with precise codes, or a
// committed change with its inverse (spec §5). Two phases: `plan` simulates on
// a scratch copy and never touches the model; `commit` applies a plan. The god
// skill runs `plan` locally (dry runs); the server runs both.
import { footprintOf, padFor, settle, SKIRT_MAX_M as SKIRT_MAX, type Landform } from '@sim/ground';
import { hashOf } from './hash.ts';
import { WorldModel, obbOverlap, type OBB } from './model.ts';
import { batchSchema, trustedBatchSchema, type Batch, type Entity, type Failure, type Field, type Op, type Result, type StoredDef, type Value, worldStateSchema } from './schemas.ts';

export type Diff = { upserts: Entity[]; removes: string[]; defs: StoredDef[]; world?: Partial<WorldModel['state']>; constants?: WorldModel['constants']; tiles: string[]; answers: { prayer: string; text: string }[] };
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

export function plan(world: WorldModel, input: unknown, by: string, tick: number, opts: { trusted?: boolean } = {}): Plan {
  const parsed = (opts.trusted ? trustedBatchSchema : batchSchema).safeParse(input);
  if (!parsed.success) return { ok: false, failures: [fail(-1, 'schema', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))] };
  const batch: Batch = parsed.data as Batch;
  const ops = parsed.data.ops as unknown as Op[];
  // Scratch copy: structural maps are cloned; the terrain is shared but every landform change is recorded and
  // undone if the plan fails, so a failed dry run leaves the model untouched.
  const scratch = WorldModel.fromSnapshot(world.snapshot(), world.assets);
  const failures: Failure[] = [], warnings: string[] = [], ids: Record<string, string> = {};
  const diff: Diff = { upserts: [], removes: [], defs: [], tiles: [], answers: [] };
  const inverse: Op[] = [];
  const touched = new Set<string>();
  const upsert = (e: Entity) => { touched.add(e.id); };
  const resolveId = (ref: string, opIndex: number): string | null => {
    if (ref === 'world') return 'world';
    if (ref.startsWith('$')) { const id = ids[ref]; if (!id) failures.push(fail(opIndex, 'entity.unknown', `${ref} is not placed in this batch`)); return id ?? null; }
    const e = scratch.get(ref);
    if (!e) { failures.push(fail(opIndex, 'entity.unknown', `${ref}`)); return null; }
    return e.id;
  };

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
        const fieldsOk = checkFields(def.params, op.params, true);
        if (!fieldsOk.ok) { failures.push(fail(i, 'params.invalid', fieldsOk.detail)); return; }
        const stateOk = checkFields(def.state, op.state, true);
        if (!stateOk.ok) { failures.push(fail(i, 'state.invalid', stateOk.detail)); return; }
        if (def.form !== 'point' && !op.shape) { failures.push(fail(i, 'params.invalid', `${def.form} form needs a shape`)); return; }
        if (scratch.entities.size >= scratch.constants.limits.entities) { failures.push(fail(i, 'entity.limit', `${scratch.constants.limits.entities} entities`)); return; }
        const id = scratch.nextId();
        const e: Entity = { id, def: def.ref, in: { parent: parentId, ...(op.in.slot ? { slot: op.in.slot } : {}) }, by, born: tick, v: 1, ...(op.name ? { name: op.name } : {}), ...(op.p ? { p: op.p } : {}), ...(op.r !== undefined ? { r: op.r } : {}), ...(op.s !== undefined ? { s: op.s } : {}), ...(op.shape ? { shape: op.shape } : {}), ...(op.anchor ? { anchor: op.anchor } : {}), ...(Object.keys(fieldsOk.values).length ? { params: fieldsOk.values } : {}), ...(Object.keys(stateOk.values).length ? { state: stateOk.values } : {}), ...(op.seed !== undefined ? { seed: op.seed } : {}) };
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
        const prev = scratch.entities.get(id)!;
        const def = scratch.resolvedDef(prev.def)!;
        const next: Entity = { ...prev, v: prev.v + 1 };
        if (op.in) { const pid = resolveId(op.in.parent, i); if (!pid) return; if (scratch.subtree(id).includes(pid)) { failures.push(fail(i, 'parent.unknown', 'cannot move a thing into itself')); return; } next.in = { parent: pid, ...(op.in.slot ? { slot: op.in.slot } : {}) }; }
        if (op.p) next.p = op.p; if (op.r !== undefined) next.r = op.r; if (op.s !== undefined) next.s = op.s; if (op.shape) next.shape = op.shape;
        scratch.delete(id); clearGround(scratch, prev, diff);
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
        if (op.name !== undefined) {
          if (scratch.names.has(`${prev.in.parent}/${op.name}`)) { failures.push(fail(i, 'name.taken', op.name)); return; }
          inv.name = prev.name; next.name = op.name;
        }
        scratch.delete(id); clearGround(scratch, prev, diff);
        if (op.params) { const problem = admit(scratch, next, def, i, 'strict', false); if (problem) { failures.push(problem); return; } }
        scratch.insert(next); indexAndGround(scratch, next, def, diff);
        upsert(next);
        inverse.unshift(inv);
        return;
      }
      case 'world': {
        const merged = worldStateSchema.parse({ ...scratch.state, ...op.state });
        const prevPatch: Record<string, unknown> = {};
        for (const k of Object.keys(op.state)) prevPatch[k] = (scratch.state as Record<string, unknown>)[k];
        scratch.state = merged; diff.world = { ...(diff.world ?? {}), ...op.state };
        inverse.unshift({ op: 'world', state: prevPatch as never });
        return;
      }
      case 'expand': {
        if (op.extent < scratch.constants.extent) { failures.push(fail(i, 'constant.immutable', 'extent only grows')); return; }
        scratch.constants = { ...scratch.constants, extent: op.extent };
        const h = op.extent / 2; scratch.terrain.update({ ...scratch.ground(), extent: [-h, -h, h, h] }, []);
        diff.constants = scratch.constants;
        warnings.push('expand has no inverse');
        return;
      }
      case 'answer': { diff.answers.push({ prayer: op.prayer, text: op.text }); return; }
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

  if (failures.length) return { ok: false, failures };
  for (const id of touched) { const e = scratch.entities.get(id); if (e) diff.upserts.push(e); }
  diff.tiles = [...new Set(diff.tiles)];
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
export function applyBatch(world: WorldModel, input: unknown, by: string, tick: number, opts?: { trusted?: boolean }): { result: Result; diff?: Diff; inverse?: Op[] } {
  const p = plan(world, input, by, tick, opts);
  if (!p.ok) return { result: { accepted: false, failures: p.failures } };
  const { seq, undoId, diff, inverse } = p.apply();
  return { result: { accepted: true, seq, undoId, ids: p.ids, warnings: p.warnings }, diff, inverse };
}

// ---------- helpers ----------

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

/** Physical admission of an entity at its (new) pose: size, extent, support/settle, slot, overlap. May adjust `e.p` (settle y, nudge). */
function admit(w: WorldModel, e: Entity, def: StoredDef, i: number, mode: 'strict' | 'nudge', creating: boolean): Failure | null {
  const s = e.s ?? 1;
  if (s < def.size.scale[0] || s > def.size.scale[1]) return fail(i, 'size.range', `scale ${s} outside [${def.size.scale.join(', ')}]`);
  const baked = w.bake(def, e.params ?? {}, e.seed ?? 0, e.shape);
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
    }
  }
  // settle on the ground when at the root with a 2-D position
  if (e.in.parent === 'world') {
    const p = e.p ?? [0, 0];
    const half = w.constants.extent / 2;
    if (Math.abs(p[0]) > half || Math.abs(p[p.length - 1]) > half) return fail(i, 'extent.outside', `(${p[0]}, ${p[p.length - 1]}) is outside ±${half} m`);
    if (p.length === 2 && def.layer !== 'volume' && !baked.landform) {
      const yaw = typeof e.r === 'number' ? e.r : Array.isArray(e.r) ? e.r[0] : 0;
      const fp = footprintOf(p[0], p[1], (baked.box[0] * s) / 2, (baked.box[2] * s) / 2, yaw);
      const anchor = e.anchor ?? def.anchor;
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
  // overlap (solids only; ancestors, descendants and declared overlaps are exempt)
  if (def.layer === 'solid' && baked.colliders.length) {
    const boxes = w.footprint(e, def);
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
        return fail(i, 'overlap.solid', `overlaps ${label}`, suggestFrom(a, b));
      }
    }
  }
  return null;
}

function suggestFrom(a: OBB, b: OBB): Failure['suggest'] {
  let dx = a.c[0] - b.c[0], dz = a.c[1] - b.c[1], len = Math.sqrt(dx * dx + dz * dz);
  if (len < 1e-6) { dx = 1; dz = 0; len = 1; } // coincident centres: push east
  const push = Math.sqrt(a.half[0] ** 2 + a.half[1] ** 2) + Math.sqrt(b.half[0] ** 2 + b.half[1] ** 2) - len + 0.2;
  return { p: [Math.round((a.c[0] + (dx / len) * push) * 100) / 100, Math.round((a.c[1] + (dz / len) * push) * 100) / 100] };
}
function nudge(_w: WorldModel, e: Entity, _def: StoredDef, mine: OBB[], other: OBB): [number, number] | null {
  const s = suggestFrom(mine[0], other);
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
  return { ...lf, id } as Landform;
}

function expandParts(w: WorldModel, root: Entity, def: StoredDef, by: string, tick: number, diff: Diff, inverse: Op[], upsert: (e: Entity) => void, depth = 1) {
  if (def.make.kind !== 'parts') return;
  const local: Record<string, string> = {};
  for (const part of def.make.parts) {
    const pdef = w.resolvedDef(part.def); if (!pdef) continue;
    const params = Object.fromEntries(Object.entries(part.params ?? {}).map(([k, v]) => [k, substitute(v, root.params ?? {})]));
    const state = Object.fromEntries(Object.entries(part.state ?? {}).map(([k, v]) => [k, substitute(v, root.params ?? {})]));
    const parentId = part.in ? local[part.in] ?? root.id : root.id;
    const e: Entity = { id: w.nextId(), name: part.id, def: pdef.ref, in: { parent: parentId, ...(part.slot ? { slot: part.slot } : {}) }, by, born: tick, v: 1, ...(part.p ? { p: part.p } : {}), ...(part.r !== undefined ? { r: part.r } : {}), ...(part.s !== undefined ? { s: part.s } : {}), ...(Object.keys(params).length ? { params } : {}), ...(Object.keys(state).length ? { state } : {}) };
    w.insert(e); indexAndGround(w, e, pdef, diff); upsert(e); local[part.id] = e.id;
    if (pdef.make.kind === 'parts' && depth < 4) expandParts(w, e, pdef, by, tick, diff, inverse, upsert, depth + 1);
  }
}
/** `$param` substitution and `+ - * /` with one operator: "$floors * 3", "$w / 2 + 1" is not supported (one op). */
function substitute(v: number | string | boolean, params: Record<string, Value>): Value {
  if (typeof v !== 'string' || !v.includes('$')) return v;
  const m = v.trim().match(/^\$([a-z][a-z0-9_]*)(?:\s*([+\-*/])\s*(-?\d+(?:\.\d+)?))?$/);
  if (!m) return v;
  const base = params[m[1]];
  if (typeof base !== 'number' || !m[2]) return base ?? v;
  const n = Number(m[3]);
  return m[2] === '+' ? base + n : m[2] === '-' ? base - n : m[2] === '*' ? base * n : base / n;
}
