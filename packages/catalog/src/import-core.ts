// catalog import-core (CATALOG-PROGRAM (a) "Migration from def/1"): one item/1 + def/2 per core-kit def, written to a
// registry and published to `stable` (they are already live in worlds) and `candidate`. Grandfathered: their G1–G3
// results are recorded as run now, but a failure does not unpublish anything; it queues a fix (the report lists them).
import { readFileSync, readdirSync } from 'node:fs';
import { coreLibrary, sha256Hex, stableStringify, hashOf, vocab, type StoredDef } from '@sim/world-compiler';
import { def1to2, def2to1, def1Hash, def2Hash, type Upgrade } from './def1to2.ts';
import { idOf, aliasesOf, namespaceOf } from './ids.ts';
import { REDISTRIBUTABLE, item1Schema, type Item1 } from './schema.ts';
import { assetMeta, measure } from './measure.ts';
import { runGates, type GateOutcome } from './gates.ts';
import { loadContract, type Contract } from './contract.ts';
import type { IndexEntry, Registry } from './registry.ts';

/** Which family file (and so which lane) authored each core def. Base-kit defs (core-kit.ts) have family "base". */
const FAMILY_AUTHOR: Record<string, string> = {
  base: 'lane:M0', creatures: 'lane:L4', furniture: 'lane:L4', props: 'lane:L4', structures: 'lane:L4', plants: 'lane:L4', transport: 'lane:L4',
  civic: 'lane:L4', play: 'lane:L4', kitchen: 'lane:L4', work: 'lane:L4', signage: 'lane:L4', mesh: 'lane:L5', terrain: 'lane:L3',
  mars: 'lane:MARS', littlemartians: 'lane:LM', vocab: 'lane:VOCAB-MECH', 'vocab-2': 'lane:VOCAB-MECH', 'vocab-w1': 'lane:VOCAB-W1',
  'vocab-w2': 'lane:VOCAB-W2', 'vocab-w3': 'lane:VOCAB-W3', layers: 'lane:LAYERS',
};
export function familyIndex(): Map<string, { family: string; source: string }> {
  const dir = new URL('../../world-compiler/src/core-kit/', import.meta.url);
  const out = new Map<string, { family: string; source: string }>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) for (const d of JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as { name: string; version?: number }[]) out.set(`${d.name}@${d.version ?? 1}`, { family: f.slice(0, -5), source: stableStringify(d) });
  return out;
}

/** Licence and source from the def and its asset (Gene: our own assets are CC0; restricted third-party is recorded and
 *  never redistributed; nothing blocks Gene's own use). */
export function licenceOf(d: StoredDef, id: string): Item1['licence'] {
  const meta = d.make.kind === 'mesh' ? assetMeta(d.make.asset) : undefined;
  const text = `${d.description} ${meta?.license ?? ''}`;
  const src = /Source:\s*([^.]+(?:\.[a-z0-9]+)?)/i.exec(d.description)?.[1]?.trim() ?? meta?.source;
  if (d.make.kind !== 'mesh') return { spdx: 'CC0-1.0', attribution: 'Eden (authored kit)', redistribute: true };
  if (/CC0/i.test(text)) return { spdx: 'CC0-1.0', ...(src ? { source: src, attribution: src } : {}), redistribute: true };
  if (/CC[- ]BY/i.test(text)) return { spdx: 'CC-BY-4.0', source: src ?? 'unknown', attribution: src ?? 'unknown', redistribute: true };
  if (namespaceOf(id) === 'mars' || /Mars College \(Gene Kogan\)/.test(text)) return { spdx: 'Eden-internal', attribution: 'Mars College (Gene Kogan)', ...(src ? { source: src } : {}), redistribute: false };
  return { spdx: 'third-party-restricted', attribution: /Vanessa Rosa/.test(text) ? 'Vanessa Rosa (Little Martians)' : 'unknown', source: src ?? 'unknown', redistribute: false };
}

export const AFFORDS = (d: StoredDef) => { const i = vocab.interfacesOf(d as never); return [...new Set([...i.verbs, ...i.actions])].sort(); };

export type ImportRow = { id: string; ref: string; rev: string; def1Hash: string; filled: number; actuators: string[]; gates: GateOutcome[]; licence: string; family: string; tris: number; how: string };

/** An item/1 (+ its def/2 upgrade and measurements) for one def/1, as a worker or import-core would write it. */
export async function makeItem(d: StoredDef, o: { at: string; run: string; contract: Contract; family?: string; source?: string; author: string; status?: Item1['status']; synonyms?: string[] }): Promise<{ item: Item1; up: Upgrade; measured: Awaited<ReturnType<typeof measure>> }> {
  const up = def1to2(d), id = idOf(d.name), rev = def2Hash(up.def2);
  const m = await measure(d);
  const route = d.extends ? 'preset' : d.make.kind === 'mesh' ? 'glb' : d.make.kind === 'parts' || d.contents?.length ? 'set' : d.make.kind === 'gen' && d.make.gen === 'kit/2' ? 'kit' : d.make.kind === 'gen' ? 'generator' : 'kit';
  const cat = up.text.category;
  const item: Item1 = item1Schema.parse({
    schema: 'item/1', id, major: d.version, rev, status: o.status ?? 'stable', aliases: aliasesOf(d.name, d.version), def1Hash: d.hash,
    text: { title: up.text.title, first: up.text.first, description: up.text.description, category: cat, synonyms: o.synonyms ?? up.text.synonyms },
    affords: AFFORDS(d),
    ...(d.components.sound ? { sound: { kinds: [String((d.components.sound as { kind?: string }).kind ?? 'sound')] } } : {}),
    ...(d.components.behavior ? { behaviour: { kind: String((d.components.behavior as { kind?: string }).kind ?? 'behavior') } } : {}),
    budgets: { tris: { lod0: m.tris }, draws: m.draws, materials: m.materials, bytes: { def: Buffer.byteLength(stableStringify(up.def2)), assets: m.assetBytes, textures: m.textures }, texturePx: m.texturePx, limit: `${cat}: ${vocab.triBudget(cat)} t`, measured: m.how },
    licence: licenceOf(d, id),
    provenance: { route, author: o.author, run: o.run, at: o.at, parents: d.extends ? [d.extends] : [], tool: 'catalog import-core', sourceHash: sha256Hex(o.source ?? stableStringify(d)), ...(o.family ? { family: o.family } : {}) },
    media: {},
    tests: { contract: `catalog-contract/1 gens=${o.contract.generators.length} comps=${o.contract.components.length}`, gates: {} },
  });
  return { item, up, measured: m };
}

export async function buildCoreItems(opts: { at?: string; run?: string; contract?: Contract; gates?: boolean } = {}): Promise<{ items: { item: Item1; up: Upgrade; def: StoredDef }[]; rows: ImportRow[] }> {
  const at = opts.at ?? new Date().toISOString(), run = opts.run ?? `import-core-${at.slice(0, 10)}`;
  const contract = opts.contract ?? loadContract();
  const fam = familyIndex();
  const items: { item: Item1; up: Upgrade; def: StoredDef }[] = []; const rows: ImportRow[] = [];
  for (const d of coreLibrary().all()) {
    const f = fam.get(d.ref) ?? { family: 'base', source: stableStringify(d) };
    const { item, up, measured: m } = await makeItem(d, { at, run, contract, family: f.family, source: f.source, author: FAMILY_AUTHOR[f.family] ?? `family:${f.family}` });
    const id = item.id, rev = item.rev;
    let gates: GateOutcome[] = [];
    if (opts.gates !== false) {
      gates = (await runGates({ item, def2: up.def2, grandfathered: true }, contract, { all: true })).outcomes;
      for (const g of gates) item.tests.gates[g.gate] = { ok: g.ok, at, report: [...g.errors, ...g.warnings.map((w) => `warn: ${w}`)].join('; ').slice(0, 4000) || 'ok', numbers: g.numbers, grandfathered: true };
    }
    items.push({ item, up, def: d });
    rows.push({ id, ref: d.ref, rev, def1Hash: d.hash, filled: up.filled.length, actuators: up.actuators, gates, licence: item.licence.spdx, family: f.family, tris: m.tris, how: m.how });
  }
  return { items, rows };
}

export const lineOf = (item: Item1) => `${item.id}@${item.major} [${item.text.category}] ${item.text.title}${item.affords.length ? ` {${item.affords.slice(0, 6).join(' ')}}` : ''}${item.text.synonyms.length ? ` aka ${item.text.synonyms.slice(0, 6).join(',')}` : ''} — ${item.text.first.slice(0, 90)}`;

/** Write items + defs (def/2 and the def/1 engine view) to the registry and publish them to both channels. */
export function writeCore(reg: Registry, items: { item: Item1; up: Upgrade; def: StoredDef }[], run: string, tierOf: (it: Item1) => Item1['tier'] = () => 'cold') {
  const entries: IndexEntry[] = [];
  for (const { item, up, def } of items) {
    const it = { ...item, tier: tierOf(item) };
    reg.putDef(up.def2);
    const view = def2to1(up.def2, up.def1Text, { omit: up.filled });
    if (def1Hash(view) !== def.hash) throw new Error(`import-core: ${def.ref} does not round-trip (def/1 ${def1Hash(view).slice(0, 12)} ≠ ${def.hash.slice(0, 12)})`);
    reg.putDef1(def.hash, view);
    reg.putItem(it);
    const row = vocab.manifestRow(def as never, { bytes: it.budgets.bytes.assets, publicRef: `${it.id}@${it.major}` });
    row.tris = it.budgets.tris.lod0;
    entries.push({ id: it.id, major: it.major, rev: it.rev, itemHash: hashOf(it), status: it.status, tier: it.tier, aliases: it.aliases, def1Hash: def.hash, line: lineOf(it), redistribute: it.licence.redistribute, row });
  }
  const s = reg.publish('stable', entries, run), c = reg.publish('candidate', entries, run);
  reg.log({ op: 'import-core', run, items: entries.length, stable: s, candidate: c });
  return { stable: s, candidate: c, entries };
}

export { REDISTRIBUTABLE };
