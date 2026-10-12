// Selection over the mirror: by def, tag, name glob, parent subtree, area, distance; roots only unless --all.
import { refPoint, isFlagDef } from './solver.mjs';

const glob = (g) => new RegExp('^' + String(g).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
export function selectRows(v, f = {}) {
  let rows = v.rows;
  if (f.in) {
    const host = v.get(f.in); if (!host) throw new Error(`no such thing: ${f.in}`);
    const ids = new Set([host.id]); for (let grew = true; grew;) { grew = false; for (const r of v.rows) if (ids.has(r.parent) && !ids.has(r.id)) { ids.add(r.id); grew = true; } }
    ids.delete(host.id); rows = rows.filter((r) => ids.has(r.id));
  } else if (!f.all) rows = rows.filter((r) => r.parent === 'world');
  if (f.def) { const d = String(f.def); rows = rows.filter((r) => r.def.includes(d) || (v.def?.(r.def)?.ref ?? r.def).replace(/^core-/, 'core/').includes(d)); }
  if (f.tag) rows = rows.filter((r) => (r.tags ?? []).includes(String(f.tag)));
  if (f.name) { const re = glob(f.name); rows = rows.filter((r) => re.test(r.name ?? '') || re.test(r.path)); }
  if (f.area) { const [x0, z0, x1, z1] = String(f.area).split(',').map(Number); rows = rows.filter((r) => r.pose[0] >= Math.min(x0, x1) && r.pose[0] <= Math.max(x0, x1) && r.pose[2] >= Math.min(z0, z1) && r.pose[2] <= Math.max(z0, z1)); }
  if (f.near) { const c = refPoint(v, f.near); const rad = Number(f.radius ?? 20); rows = rows.filter((r) => r.id !== c.row?.id && Math.hypot(r.pose[0] - c.x, r.pose[2] - c.z) <= rad); }
  if (!f.flags) rows = rows.filter((r) => !isFlagDef(v.def?.(r.def)?.ref ?? r.def) || f.def === 'flag');
  return rows;
}
