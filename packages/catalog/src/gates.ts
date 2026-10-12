// Gates G1–G3: automatic, cheap, in order (CATALOG-PROGRAM (c) "Gates"). An item reaches `candidate` only when every
// gate passes. Each gate returns numbers so a regression shows up as a number that moved. G4 (headless render) lives in
// tools/catalog/g4/ (Modal or the laptop's leased Chrome); G5–G7 are P1/P2.
//
//   G1 schema and lint     def/2 + item/1 parse; category known; ranges/defaults; actions use declared state; licence
//                          allowed and sourced; the contract knows every capability (else capability.unknown);
//                          ≥ 3 synonyms for new items (grandfathered imports queue a text pass instead)
//   G2 budgets             tris per class; draws ≤ 4 and materials ≤ 4 below building class; def ≤ 16 KB; GLB ≤ 2 MB
//                          or carries lod1; GLB > 5k tris must carry lod1 — all measured, never typed
//   G3 physics + compile   placed in a fresh world at the defaults, at min and max of every ranged param and at every
//                          enum value: compiles; built bounds inside the declared box; nothing > 2 cm below y = 0;
//                          not floating unless anchored float/center; an enterable thing has wall segments, not one
//                          solid block; every seat/bed/stand slot has a standable approach point outside its colliders
import { WorldModel, applyBatch, coreLibrary, hashOf, stableStringify, vocab, type StoredDef, type DefInput } from '@sim/world-compiler';
import { def2Schema, item1Schema, REDISTRIBUTABLE, type Def2, type Item1 } from './schema.ts';
import { def2to1 } from './def1to2.ts';
import { bigClass, type Contract } from './contract.ts';
import { assetLookup, measure, shapeFor, type Measured } from './measure.ts';

export type GateId = 'G1' | 'G2' | 'G3';
export type GateOutcome = { gate: GateId; ok: boolean; errors: string[]; warnings: string[]; numbers: Record<string, number> };
export type Subject = { item: Item1; def2: Def2; grandfathered?: boolean };

// ------------------------------------------------------------------ G1

export function g1(s: Subject, contract: Contract): GateOutcome {
  const errors: string[] = [], warnings: string[] = [];
  const it = item1Schema.safeParse(s.item); if (!it.success) errors.push(...it.error.issues.map((i) => `item.${i.path.join('.')}: ${i.message}`));
  const d2 = def2Schema.safeParse(s.def2); if (!d2.success) errors.push(...d2.error.issues.map((i) => `def.${i.path.join('.')}: ${i.message}`));
  if (!it.success || !d2.success) return { gate: 'G1', ok: false, errors, warnings, numbers: { issues: errors.length } };
  const item = it.data, d = d2.data;
  if (hashOf(d) !== item.rev) errors.push(`rev ${item.rev.slice(0, 12)} is not the def/2 hash ${hashOf(d).slice(0, 12)}`);
  if (!vocab.CATEGORIES.has(item.text.category)) errors.push(`category ${item.text.category} is not in the taxonomy`);
  // capabilities the engine contract knows
  if (d.make.kind === 'gen' && !contract.generators.includes(d.make.gen)) errors.push(`capability.unknown: generator ${d.make.gen}`);
  for (const c of Object.keys(d.components)) if (!contract.components.includes(c)) errors.push(`capability.unknown: component ${c}`);
  for (const sl of d.slots) if (!contract.slotKinds.includes(sl.kind)) errors.push(`capability.unknown: slot kind ${sl.kind}`);
  for (const [a] of d.actuators) if (!contract.actuators.includes(a)) errors.push(`capability.unknown: actuator ${a}`);
  // the induction lint, on the engine view (ranges, defaults, declared state, interfaces for the category, tri budget)
  const view = def2to1(d, { description: item.text.description, category: item.text.category, synonyms: item.text.synonyms });
  const lint = vocab.lintDef(view as never, { tris: item.budgets.tris.lod0 });
  errors.push(...lint.errors.filter((e) => !/triangles over/.test(e)));   // tris are G2's
  warnings.push(...lint.warnings.filter((w) => !/no synonyms/.test(w)));
  // words
  if (item.text.synonyms.length < 3) (s.grandfathered ? warnings : errors).push(`text: ${item.text.synonyms.length} synonyms (need ≥ 3)${s.grandfathered ? '; queued for a text pass' : ''}`);
  if (item.text.description.length < 12) errors.push('text: description missing or too short');
  // licence: a gate, not a note
  const L = item.licence;
  if (L.redistribute !== REDISTRIBUTABLE[L.spdx]) errors.push(`licence: ${L.spdx} must have redistribute=${REDISTRIBUTABLE[L.spdx]}`);
  if ((L.spdx === 'CC-BY-4.0' || L.spdx === 'third-party-restricted') && !L.source) errors.push(`licence: ${L.spdx} needs a source`);
  if (L.spdx === 'CC-BY-4.0' && !L.attribution) errors.push('licence: CC-BY needs an attribution');
  if (item.id.startsWith('eden/') && !L.redistribute) warnings.push(`licence: ${L.spdx} in the public eden namespace (kept from other owners' worlds)`);
  return { gate: 'G1', ok: errors.length === 0, errors, warnings, numbers: { errors: errors.length, warnings: warnings.length } };
}

// ------------------------------------------------------------------ G2

export function g2(s: Subject, m: Measured, contract: Contract): GateOutcome {
  const errors: string[] = [], warnings: string[] = [];
  const L = contract.classLimits, cat = s.item.text.category, triCap = vocab.triBudget(cat);
  const defBytes = Buffer.byteLength(stableStringify(def2Schema.parse(s.def2)));
  if (m.tris > triCap) errors.push(`${m.tris} triangles over the ${cat} budget ${triCap}`);
  if (!bigClass(cat) && m.how === 'kit' && m.draws > L.drawsBelowBuilding) errors.push(`${m.draws} draws > ${L.drawsBelowBuilding} below building class`);
  if (!bigClass(cat) && m.how === 'kit' && m.materials > L.materials) errors.push(`${m.materials} materials > ${L.materials}`);
  if (defBytes > L.defBytes) errors.push(`def ${defBytes} B > ${L.defBytes} B`);
  const lod1 = s.def2.make.kind === 'mesh' && !!s.def2.make.lod1;
  if (m.assetBytes > L.glbBytes && !lod1) errors.push(`GLB ${(m.assetBytes / 1e6).toFixed(1)} MB > ${(L.glbBytes / 1e6).toFixed(0)} MB without lod1`);
  if (s.def2.make.kind === 'mesh' && m.tris > L.lod1AboveTris && !lod1) errors.push(`GLB ${m.tris} tris > ${L.lod1AboveTris} without lod1`);
  if (m.how === 'estimate') warnings.push('triangles are the bake estimate (no measured mesh)');
  return { gate: 'G2', ok: errors.length === 0, errors, warnings, numbers: { tris: m.tris, triCap, draws: m.draws, materials: m.materials, defBytes, assetBytes: m.assetBytes } };
}

// ------------------------------------------------------------------ G3

/** The parameter points G3 places: defaults, then min and max of each ranged param, then each enum value. */
export function sweep(d: Def2): { label: string; params: Record<string, unknown> }[] {
  const out: { label: string; params: Record<string, unknown> }[] = [{ label: 'default', params: {} }];
  for (const [k, p] of Object.entries(d.params)) {
    if (p.type === 'number' || p.type === 'int') { if (p.min !== p.default) out.push({ label: `${k}=min`, params: { [k]: p.min } }); if (p.max !== p.default) out.push({ label: `${k}=max`, params: { [k]: p.max } }); }
    if (p.type === 'enum') for (const v of p.values) if (v !== p.default) out.push({ label: `${k}=${v}`, params: { [k]: v } });
  }
  return out.slice(0, 48);
}

const lib = coreLibrary();
function world(): WorldModel { const w = new WorldModel({ constants: { ground: 'land', extent: 1000 }, seed: 'g3', assets: assetLookup }); w.library = lib; return w; }

export async function g3(s: Subject, opts: { measureBounds?: boolean } = {}): Promise<GateOutcome> {
  const errors: string[] = [], warnings: string[] = [];
  const view = def2to1(s.def2, { description: s.item.text.description, category: s.item.text.category, synonyms: s.item.text.synonyms }) as DefInput;
  const w = world();
  const def = w.defineDef(view, 'catalog', 0);
  const ref = def.ref, r = w.resolvedDef(ref)!;
  // things that float (boats, buoys) are tested on water: a pond under the origin first
  if (r.anchor === 'float') { const span = Math.max(15, Math.max(r.size.box[0], r.size.box[2]) * 2); const p = applyBatch(w, { ops: [{ op: 'place', def: 'core/pond@1', name: 'g3-water', p: [0, 0, 0], params: { depth: 3 }, shape: { area: [[-span, -span], [span, -span], [span, span], [-span, span]] } }] }, 'catalog', 0); if (!p.result.accepted) warnings.push(`test water refused: ${p.result.failures?.[0]?.code}`); }
  let placed = 0, tried = 0;
  const shape = r.form === 'point' ? undefined : shapeFor(r);
  for (const pt of sweep(s.def2)) {
    tried++;
    const res = applyBatch(w.fork(), { ops: [{ op: 'place', def: ref, name: 'it', p: [0, 0, 0], ...(Object.keys(pt.params).length ? { params: pt.params } : {}), ...(shape ? { shape } : {}) }] }, 'catalog', 1);
    if (res.result.accepted) placed++;
    else errors.push(`place ${pt.label}: ${res.result.failures?.[0]?.code} ${String(res.result.failures?.[0]?.detail ?? '').slice(0, 120)}`);
  }
  // physics of the default bake
  let baked; try { baked = w.bake(r, Object.fromEntries(Object.entries(r.params).filter(([, f]) => f.default !== undefined).map(([k, f]) => [k, f.default!])) as never, 0, shape as never); } catch (e) { errors.push(`bake: ${String(e).slice(0, 160)}`); }
  const box = r.size.box;
  if (baked && r.form === 'point') {
    const slotKinds = new Set(r.slots.map((x) => x.kind));
    const enterable = slotKinds.has('room') || slotKinds.has('door') || (baked.rooms?.length ?? 0) > 0;
    const solid = baked.colliders.filter((c) => !c.tag || !/^(floor|roof|deck)/.test(c.tag));
    if (enterable && solid.length === 1) { const c = solid[0], a = 4 * c.half[0] * c.half[1]; if (a >= 0.8 * box[0] * box[2] && c.y1 - c.y0 >= 0.8 * box[1]) errors.push('enterable but one solid block (walls expected)'); }
    // approach points: 0.6 m in front of each seat/bed/stand slot, outside every collider of the thing itself
    for (const sl of r.slots.filter((x) => x.kind === 'seat' || x.kind === 'bed' || x.kind === 'stand')) {
      const fx = sl.p[0] + Math.sin(sl.yaw) * 0.6, fz = sl.p[2] + Math.cos(sl.yaw) * 0.6;
      const inside = baked.colliders.some((c) => { const dx = fx - c.c[0], dz = fz - c.c[1], co = Math.cos(c.yaw), si = Math.sin(c.yaw); const lx = dx * co - dz * si, lz = dx * si + dz * co; return Math.abs(lx) < c.half[0] && Math.abs(lz) < c.half[1] && c.y0 < 1.0 && c.y1 > 0.1; });
      if (inside) warnings.push(`approach: slot ${sl.id} (${sl.kind}) has no free standing point in front`);
    }
  }
  // drawn bounds (kit: the viewer's own geometry; mesh: the measured GLB) against the declared box and the floor
  let m: Measured | undefined;
  if (opts.measureBounds !== false && r.form === 'point') m = await measure(def);
  if (m?.box && r.form === 'point') {
    const [x0, y0, z0] = m.box.min, [x1, y1, z1] = m.box.max, tol = 0.12;
    const w0 = x1 - x0, h0 = y1 - y0, d0 = z1 - z0;
    if (m.how === 'kit') {
      if (w0 > box[0] * (1 + tol) + 0.05 || h0 > box[1] * (1 + tol) + 0.05 || d0 > box[2] * (1 + tol) + 0.05) warnings.push(`bounds ${[w0, h0, d0].map((v) => v.toFixed(2)).join('×')} exceed the declared box ${box.join('×')}`);
      // the floor rules apply to free-standing things on a base anchor; mounted parts (component.*: roofs, awnings),
      // ground-hugging anchors (conform, drape) and ground works (terrain, water, pitches, layers) set into the ground
      const cat = s.item.text.category, freeStanding = r.anchor === 'base' && !/^(component|terrain|water|layer|public\.(pitch|park))/.test(cat);
      if (freeStanding && y0 < -0.02) errors.push(`${(-y0).toFixed(2)} m below the floor`);
      if (freeStanding && y0 > 0.05 && !r.slots.some((x) => x.kind === 'hang')) errors.push(`floating ${y0.toFixed(2)} m above the floor (anchor base)`);
    } else if (r.make.kind === 'mesh' && h0 > 0) {
      const scale = box[1] / h0;
      if (y0 * scale < -0.02 && r.anchor === 'base') warnings.push(`GLB origin ${(y0 * scale).toFixed(2)} m below its base`);
    }
  }
  return { gate: 'G3', ok: errors.length === 0, errors, warnings, numbers: { placements: tried, placed, colliders: baked?.colliders.length ?? 0 } };
}

/** Run G1–G3 in order; stops at the first failing gate unless `all`. */
export async function runGates(s: Subject, contract: Contract, opts: { all?: boolean } = {}): Promise<{ ok: boolean; outcomes: GateOutcome[]; measured: Measured }> {
  const view = def2to1(s.def2, { description: s.item.text.description, category: s.item.text.category, synonyms: s.item.text.synonyms });
  const probe = world(); const sd: StoredDef = probe.defineDef(view, 'catalog', 0);
  const m = await measure(sd);
  const outcomes: GateOutcome[] = [];
  const o1 = g1(s, contract); outcomes.push(o1); if (!o1.ok && !opts.all) return { ok: false, outcomes, measured: m };
  const o2 = g2(s, m, contract); outcomes.push(o2); if (!o2.ok && !opts.all) return { ok: false, outcomes, measured: m };
  const o3 = await g3(s); outcomes.push(o3);
  return { ok: outcomes.every((o) => o.ok), outcomes, measured: m };
}
