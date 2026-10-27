// Meaning is authored data, never inferred physical affordances. The server owns full schema/reference validation.
export function aboutValue(raw, { clear = false } = {}) {
  if (typeof raw !== 'string') throw Error('about takes one JSON object');
  let value;
  try { value = JSON.parse(raw); } catch { throw Error('about must be valid JSON'); }
  if (clear && value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('about must be a JSON object (set --about null clears it)');
  return value;
}
export function exactAboutTarget(m, ref) {
  const exact = m.rows.find(r => r.id === ref || r.path === ref);
  const matches = exact ? [exact] : m.rows.filter(r => r.name === ref);
  if (matches.length !== 1) throw Error(matches.length ? `ambiguous about target ${ref}; use a full path or id` : `unknown about target ${ref}`);
  return m.snapshot.entities.find(e => e.id === matches[0].id) ?? {};
}
export function missingAbout(m, { kind, limit = 30 } = {}) {
  limit = Number(limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw Error('--limit must be an integer from 1 to 200');
  const entities = new Map(m.snapshot.entities.map(e => [e.id, e]));
  const defs = new Map([...(m.snapshot.defs ?? []), ...(m.snapshot.library ?? [])].flatMap(d => [[d.ref, d], ['sha:' + d.hash, d]]));
  const rows = m.rows.flatMap(r => {
    const e = entities.get(r.id); if (!e) return [];
    const d = defs.get(r.def) ?? defs.get(e.def);
    const comps = d?.components ?? d?.body?.components ?? {};
    const tags = new Set(d?.tags ?? []);
    const water = d?.layer === 'volume' && (tags.has('water') || /^(?:lake|river|ocean)\//.test(d?.make?.gen ?? ''));
    const inferred = e.about?.kind ?? (water ? 'water' : comps.place?.kind) ?? (tags.has('building') ? 'building' : tags.has('zone') ? 'zone' : tags.has('landmark') ? 'landmark' : comps.seat ? 'seat' : comps.bed ? 'bed' : null);
    if (!inferred) return []; // Decorations do not become landmarks merely by lacking prose.
    const missing = ['title', 'what'].filter(k => !e.about?.[k]?.trim());
    return missing.length && (!kind || inferred === kind) ? [{ id: e.id, path: r.path, kind: inferred, missing }] : [];
  });
  rows.sort((a, b) => a.path.localeCompare(b.path));
  return { total: rows.length, rows: rows.slice(0, limit), remaining: Math.max(0, rows.length - limit) };
}
