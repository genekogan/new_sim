// Pure snapshot -> portable genesis. The server supplies explicit export restrictions;
// legacy snapshots without that metadata keep their existing export policy.
const isRef = (v) => typeof v === 'string' && /^(?:sha:[0-9a-f]{64}|(?:(?:core|eden|lm|mars)\/)?[a-z0-9][a-z0-9._-]*@\d+)$/.test(v);
const inputOf = ({ hash, ref, born, budget, by, ...input }) => input;
const pathOf = (byId, entity) => {
  const parts = [];
  for (let e = entity; e; e = byId.get(e.in.parent)) parts.unshift(e.name ?? e.id);
  return parts.join('/');
};

export function exportGenesis(snapshot, { name } = {}) {
  const s = snapshot, byId = new Map(s.entities.map((e) => [e.id, e]));
  const library = new Map();
  for (const d of [...(s.library ?? []), ...(s.defs ?? [])]) {
    library.set(d.ref, d);
    if (d.hash) library.set('sha:' + d.hash, d);
    if (d.ref?.startsWith('core-')) library.set('core/' + d.ref.slice(5), d);
  }
  const defOf = (ref) => library.get(ref) ?? null;
  const blocked = new Set(s.exportBlockedHashes ?? []);
  const checked = new Set(), emitted = new Set(), definitions = [], visiting = new Set();
  const dependencies = (d) => {
    const refs = [];
    if (d.extends) refs.push(d.extends);
    const walk = (value, key) => {
      if (isRef(value) && (value.startsWith('sha:') || key === 'def' || key === 'of' || key === 'extends' || defOf(value))) refs.push(value);
      else if (Array.isArray(value)) value.forEach((v) => walk(v, key));
      else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, k);
    };
    walk(d.make); walk(d.contents); walk(d.components); walk(d.params);
    return [...new Set(refs)];
  };
  const check = (d) => {
    if (checked.has(d.hash ?? d.ref)) return;
    checked.add(d.hash ?? d.ref);
    if (blocked.has(d.hash) || [...JSON.stringify(d.make ?? null).matchAll(/[0-9a-f]{64}/g)].some(([hash]) => blocked.has(hash)))
      throw new Error(`export restricted: ${d.ref} cannot be redistributed`);
    for (const ref of dependencies(d)) { const dep = defOf(ref); if (dep) check(dep); }
  };
  const emit = (ref, required = false) => {
    const d = defOf(ref);
    if (!d) { if (required) throw new Error(`export missing pinned definition: ${ref}`); return; }
    check(d);
    const portable = required || ref.startsWith('sha:') || (d.by !== 'core' && !d.ref.startsWith('core-'));
    if (!portable || emitted.has(d.hash ?? d.ref)) return;
    const key = d.hash ?? d.ref;
    if (visiting.has(key)) throw new Error(`export cyclic definition dependency: ${d.ref}`);
    visiting.add(key);
    for (const dependency of dependencies(d)) emit(dependency, true);
    visiting.delete(key); emitted.add(key); definitions.push(inputOf(d));
  };
  // Check every entity, including generated children, before dropping prefab expansion.
  for (const e of s.entities) {
    emit(e.def, e.def.startsWith('sha:'));
    const params = (value) => {
      if (isRef(value)) emit(value, value.startsWith('sha:'));
      else if (Array.isArray(value)) value.forEach(params);
      else if (value && typeof value === 'object') Object.values(value).forEach(params);
    };
    params(e.params);
  }
  const prefabChild = (e) => {
    for (let p = byId.get(e.in.parent); p; p = byId.get(p.in.parent)) if (defOf(p.def)?.make?.kind === 'parts') return true;
    return false;
  };
  const order = [], seen = new Set(), byPath = new Map(s.entities.map((e) => [pathOf(byId, e), e]));
  const visit = (e, depth = 0) => {
    if (seen.has(e.id) || depth > 64) return;
    seen.add(e.id);
    const parent = byId.get(e.in.parent); if (parent) visit(parent, depth + 1);
    for (const c of e.constraints ?? []) {
      const related = c.ref && (byPath.get(c.ref) ?? byPath.get(c.ref.slice(0, c.ref.lastIndexOf('/'))));
      if (related && related.id !== e.id) visit(related, depth + 1);
    }
    order.push(e);
  };
  s.entities.forEach((e) => visit(e));
  const tmp = new Map(order.map((e, i) => [e.id, `$e${i}`]));
  const ops = order.filter((e) => !prefabChild(e)).map((e) => {
    const op = { op: 'place', tmp: tmp.get(e.id), def: e.def, ...(e.name ? { name: e.name } : {}) };
    if (e.in.parent !== 'world') op.in = { parent: tmp.get(e.in.parent), ...(e.in.slot ? { slot: e.in.slot } : {}) };
    if (e.p) op.p = e.in.parent === 'world' && e.p.length === 3 && e.anchor !== 'float' ? [e.p[0], e.p[2]] : e.p;
    for (const key of ['r', 's', 'shape', 'anchor', 'params', 'state', 'seed', 'constraints']) if (e[key] !== undefined) op[key] = e[key];
    if (op.anchor === 'float' && op.p?.length === 3) op.p = [op.p[0], op.p[2]];
    return op;
  });
  const batches = definitions.length ? [{ note: 'defs', ops: definitions.map((def) => ({ op: 'define', def })) }] : [];
  for (let i = 0; i < ops.length; i += 200) batches.push({ note: `things ${i + 1}–${Math.min(ops.length, i + 200)}`, ops: ops.slice(i, i + 200) });
  for (const batch of batches) {
    const local = new Set(batch.ops.map((op) => op.tmp).filter(Boolean));
    for (const op of batch.ops) if (op.in?.parent?.startsWith('$') && !local.has(op.in.parent)) op.in.parent = pathOf(byId, order[Number(op.in.parent.slice(2))]);
  }
  return { schema: 'genesis/1', name: name ?? s.worldId, description: `exported from ${s.worldId} at seq ${s.seq}`,
    constants: { extent: s.constants.extent, ground: s.constants.ground, ...(s.constants.seaLevel !== undefined ? { seaLevel: s.constants.seaLevel } : {}) },
    state: { sky: s.state.sky, weather: s.state.weather, ...(s.state.constitution ? { constitution: s.state.constitution } : {}) }, batches };
}
