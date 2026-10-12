// Pure G4 planning: every ref has either a bounded render job or an explicit qualification gap.
export const toRef = (r) => r.replace(/^eden\//, 'core/').replace(/^lm\//, 'core/lm-').replace(/^mars\//, 'core/mars-').replace(/^core-/, 'core/');
export const ACT = { power: ['on', true], door: ['open', true], ignite: ['lit', true], play: ['playing', true], fill: ['level', 1] };
export function fixturePort(port) {
  if (!Number.isInteger(port) || port < 6100 || port > 6299) throw new Error('G4 fixture port must be in 6100..6299');
  return port;
}
export function shotsOf(d) {
  const list = [{ label: 'default', params: {}, state: {} }];
  const enums = Object.entries(d.params ?? {}).filter(([, f]) => f.type === 'enum').sort(([a], [b]) => a.localeCompare(b));
  for (const [k, f] of enums) for (const v of f.values) if (v !== (f.default ?? f.values[0])) list.push({ label: `${k}=${v}`, params: { [k]: v }, state: {} });
  for (const [field, val] of Object.values(ACT)) if (d.state?.[field] && d.state[field].default !== val) list.push({ label: `${field}=${val}`, params: {}, state: { [field]: val } });
  return list;
}
export function unsupported(d) {
  if (d.components?.body) return 'body requires a rig/Soul fixture; ordinary entity placement cannot qualify it';
  if (d.make.kind === 'none') return 'invisible semantic item: no mesh; needs a non-picture contract gate';
  if (d.make.kind === 'gen' && /^(landform|lake|scatter|cliff|terrace|channel|brush)\/1$/.test(d.make.gen)) return 'terrain mutation is drawn in shared ground: entity-hide coverage cannot isolate it';
  return null;
}
export function planBatches(defs, maxJobs = 72) {
  if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 81) throw new Error('maxJobs must be an integer in 1..81');
  const batches = [], gaps = [], seen = new Set(); let current = [], cost = 0;
  for (const d of defs) {
    const ref = toRef(d.publicRef ?? d.ref);
    if (seen.has(ref)) throw new Error(`duplicate catalogue ref: ${ref}`); seen.add(ref);
    const reason = unsupported(d);
    if (reason) { gaps.push({ id: ref, defHash: d.hash, ok: false, status: 'unqualified', errors: [reason], warnings: [], views: [], variants: [] }); continue; }
    const n = shotsOf(d).length;
    // Never truncate variants or overflow grid cells to force a pass.
    if (n > maxJobs) { gaps.push({ id: ref, ok: false, status: 'unqualified', errors: [`${n} jobs exceeds batch capacity ${maxJobs}; a dedicated fixture is required`], warnings: [], views: [], variants: [] }); continue; }
    if (cost + n > maxJobs) { batches.push(current); current = []; cost = 0; }
    current.push(ref); cost += n;
  }
  if (current.length) batches.push(current);
  return { requested: [...seen], batches, gaps };
}
export function allocateGrid(jobs) {
  const CELLS = 9, GRID = 100, used = new Set();
  if (jobs.length > CELLS * CELLS) throw new Error(`G4 has ${jobs.length} jobs for ${CELLS * CELLS} cells; use g4-batch.mjs`);
  const hash = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
  jobs.forEach((j, i) => {
    j.name = `g${i}`; let c = hash(`${j.d.publicRef}|${j.label}`) % (CELLS * CELLS);
    while (used.has(c)) c = (c + 1) % (CELLS * CELLS);
    used.add(c); j.p = [((c % CELLS) - 4) * GRID, 0, (Math.floor(c / CELLS) - 4) * GRID];
  });
}
export function coverageOf(requested, items) {
  const want = new Set(requested), counts = new Map();
  for (const item of items) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  return { requested: requested.length, accounted: [...want].filter((id) => counts.has(id)).length,
    missing: [...want].filter((id) => !counts.has(id)), duplicate: [...counts].filter(([, n]) => n > 1).map(([id]) => id),
    unexpected: [...counts.keys()].filter((id) => !want.has(id)),
    rendered: items.filter((i) => i.views?.length).length, passing: items.filter((i) => i.ok).length,
    failing: items.filter((i) => !i.ok && i.status !== 'unqualified').length,
    unqualified: items.filter((i) => i.status === 'unqualified').length };
}
