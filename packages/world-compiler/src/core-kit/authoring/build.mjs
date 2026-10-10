#!/usr/bin/env node
// Writes core-kit/<family>.json from the authoring modules and reports triangle counts
// (kit estimate and the real three.js geometry) against the Eden budgets
// (creature ≤ 600, prop ≤ 400, structures ≤ 6000).
//   node packages/world-compiler/src/core-kit/authoring/build.mjs [--check]
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defSchema } from '../../schemas.ts';

const here = dirname(fileURLToPath(import.meta.url));
const FAMILIES = ['creatures', 'furniture', 'props', 'plants', 'transport', 'civic', 'play', 'kitchen', 'work', 'signage'];
const check = process.argv.includes('--check');

// real triangle counts from the viewer's own kit builder
const { buildKit } = await import('../../../../../apps/web/src/gen-mesh/kit.mesh.ts');
const { MaterialLib } = await import('../../../../../apps/web/src/gen-mesh/materials.ts');
const { kitArgs } = await import('../../../../generators/src/kit.ts');
const lib = new MaterialLib();
function realTris(def) {
  const g = buildKit(kitArgs.parse(def.make.args), { materials: lib, tint: (k, f) => (k && def.palette?.[k]) || f });
  let tris = 0; g.traverse((o) => { if (o.isMesh) tris += o.geometry.attributes.position.count / 3; });
  return Math.round(tris);
}
const budgetOf = (d) => (d.tags.includes('creature') ? 600 : d.tags.includes('structure') || d.tags.includes('ride') || d.tags.includes('large') ? 6000 : d.tags.includes('vehicle') || d.tags.includes('tree') ? 1200 : 400);

let total = 0, over = 0, stale = 0;
const rows = [];
for (const fam of FAMILIES) {
  const file = resolve(here, `${fam}.mjs`);
  if (!existsSync(file)) continue;
  const defs = (await import(file)).default;
  for (const d of defs) {
    const p = defSchema.safeParse(d); if (!p.success) throw new Error(`${d.name}: ${p.error.message}`);
    const real = realTris(d), est = d.__tris, budget = budgetOf(d);
    if (real > budget) over++;
    rows.push({ fam, name: d.name, real, est, budget, shapes: d.make.args.shapes.length, roles: [...new Set(d.make.args.shapes.map((s) => s.role).filter(Boolean))].length });
  }
  const out = resolve(here, `../${fam}.json`), json = JSON.stringify(defs) + '\n';
  if (check) { if (!existsSync(out) || readFileSync(out, 'utf8') !== json) { stale++; console.error(`stale: ${fam}.json`); } }
  else writeFileSync(out, json);
  total += defs.length;
}
for (const r of rows) console.log(`${r.real > r.budget ? '✖' : ' '} ${r.fam.padEnd(9)} ${r.name.padEnd(26)} tris ${String(r.real).padStart(5)} (est ${String(r.est).padStart(5)}) / ${r.budget}  shapes ${r.shapes} roles ${r.roles}`);
console.log(`${total} defs, ${over} over budget${check ? `, ${stale} stale json` : ''}`);
process.exit(over || stale ? 1 : 0);
