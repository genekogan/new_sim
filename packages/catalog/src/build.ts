// Per-item authoring: source and words live together; every output is immutable and published by a pointer move.
// src.mjs exports one def/1 or def/2. item.json owns words/licence, not measured budgets or gate verdicts.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WorldModel, hashOf, sha256Hex, vocab, type DefInput, type StoredDef } from '@sim/world-compiler';
import { def2Schema, item1Schema, type Def2, type Item1 } from './schema.ts';
import { def1to2, def2to1, def2Hash, def1Hash } from './def1to2.ts';
import { makeItem, lineOf, facetsOf } from './import-core.ts';
import { loadContract } from './contract.ts';
import { runGates, type GateOutcome } from './gates.ts';
import { g5, type Intent } from './findability.ts';
import { compatibility } from './compat.ts';
import { Registry, RegistryError, type IndexEntry } from './registry.ts';

export type RenderReceipt = { gpu: string; items: { id: string; defHash: string; ok: boolean; views: { label: string; view: string; file: string }[]; errors?: string[] }[] };
export type BuiltItem = { item: Item1; def2: Def2; engine: DefInput; entry: IndexEntry; gates: (GateOutcome | { gate: 'G4'; ok: boolean; errors: string[]; warnings: string[]; numbers: Record<string, number> })[]; ok: boolean };

export async function buildItem(directory: string, registry: Registry, options: { run: string; at?: string; receipt?: RenderReceipt; intents?: Intent[] } ): Promise<BuiltItem> {
  const dir = resolve(directory), sourceFile = join(dir, 'src.mjs'), source = readFileSync(sourceFile, 'utf8');
  const metadata = JSON.parse(readFileSync(join(dir, 'item.json'), 'utf8'));
  const exported = (await import(`${pathToFileURL(sourceFile).href}?source=${sha256Hex(source)}`)).default;
  if (!exported || !['def/1', 'def/2'].includes(exported.schema)) throw new Error('src.mjs must default-export a def/1 or def/2');
  if (!/^core-[a-z0-9][a-z0-9-]*$/.test(exported.name)) throw new Error('core catalogue source names must start with core-');
  const scratch = new WorldModel({ constants: { ground: 'land', extent: 1000 }, seed: 'catalog-build' });
  const def2 = exported.schema === 'def/2' ? def2Schema.parse(exported) : def1to2(scratch.defineDef(exported, 'core', 0)).def2;
  // New catalogue defs have no human text in their engine hash. P0 seed defs retain their original hashes forever.
  const { layers: _inert, ...engine } = def2to1(def2, { description: '' });
  const stored = scratch.defineDef(engine, 'core', 0);
  const at = options.at ?? new Date().toISOString();
  const base = await makeItem(stored, { at, run: options.run, author: 'catalog-worker', contract: loadContract(), status: 'draft' });
  const item = item1Schema.parse({ ...base.item, rev: def2Hash(def2), text: { ...base.item.text, ...metadata.text },
    licence: metadata.licence, provenance: { ...base.item.provenance, sourceHash: sha256Hex(source), author: metadata.author ?? 'catalog-worker', tool: 'catalog build' } });
  if (item.licence.spdx !== 'CC0-1.0' || !item.licence.redistribute || !item.id.startsWith('eden/')) throw new Error('central authoring is core-only CC0; pack imports remain the explicit import-core route');
  if (!item.licence.source) throw new Error('CC0 authoring must record its source');
  const gates: BuiltItem['gates'] = (await runGates({ item, def2 }, loadContract(), { all: true })).outcomes;
  const previous = registry.resolve(`${item.id}@${item.major}`), oldDef = previous && registry.def(previous.rev);
  if (oldDef) {
    const compat = compatibility(oldDef, def2);
    if (!compat.compatible) gates[0].errors.push(...compat.breaks.map((detail) => `major bump required: ${detail}`));
    gates[0].ok = !gates[0].errors.length;
  }
  const receipt = options.receipt, rendered = receipt?.items.find((r) => r.defHash === stored.hash && [stored.ref, `${item.id}@${item.major}`, ...base.item.aliases].includes(r.id));
  const expected = ['default'];
  for (const [name, param] of Object.entries(def2.params)) if (param.type === 'enum') for (const value of param.values) if (value !== param.default) expected.push(`${name}=${value}`);
  for (const [field, value] of [['on', true], ['open', true], ['lit', true], ['playing', true], ['level', 1]] as const)
    if (stored.state[field] && stored.state[field].default !== value) expected.push(`${field}=${value}`);
  const fourViews = ['front-left', 'front-right', 'back', 'above'];
  const complete = rendered && expected.every((label) => fourViews.every((view) => rendered.views.some((v) => v.label === label && v.view === view && !!v.file)));
  const renderErrors = !receipt || !rendered ? ['G4 needs a render receipt for this exact engine hash']
    : !receipt.gpu || /swiftshader|llvmpipe|software|softpipe/i.test(receipt.gpu) ? ['G4 requires hardware rendering']
    : !rendered.ok || !complete ? ['G4 render checks failed or required variant/state views are missing', ...(rendered.errors ?? [])] : [];
  gates.push({ gate: 'G4', ok: !renderErrors.length, errors: renderErrors, warnings: [], numbers: { views: rendered?.views.length ?? 0 } });
  const existing = registry.current('stable').map((entry) => registry.item(entry.id, entry.major, entry.rev, entry.itemHash)!).filter(Boolean);
  gates.push(g5(item, existing, options.intents));
  for (const gate of gates) item.tests.gates[gate.gate] = { ok: gate.ok, at, report: [...gate.errors, ...gate.warnings].join('; ').slice(0, 4000) || 'ok', numbers: gate.numbers };
  const row = vocab.manifestRow(stored as never, { bytes: item.budgets.bytes.assets, publicRef: `${item.id}@${item.major}` });
  Object.assign(row, { cat: item.text.category, syn: item.text.synonyms, doc: item.text.first, tris: item.budgets.tris.lod0 });
  const entry: IndexEntry = { id: item.id, major: item.major, rev: item.rev, itemHash: hashOf(item), status: item.status, tier: item.tier,
    aliases: item.aliases, def1Hash: stored.hash, line: lineOf(item), redistribute: item.licence.redistribute, row, facets: facetsOf(stored) };
  return { item, def2, engine, entry, gates, ok: gates.every((g) => g.ok) };
}

/** Store validated artifacts and move candidate only. Stable promotion remains a distinct reviewed operation. */
export function publishItem(registry: Registry, built: BuiltItem, run: string) {
  if (!built.ok || ['G1', 'G2', 'G3', 'G4', 'G5'].some((name) => !built.gates.some((gate) => gate.gate === name && gate.ok))) throw new RegistryError('catalog.gates', 'G1–G5 must pass before candidate publication');
  const previousEntry = registry.resolve(`${built.item.id}@${built.item.major}`, 'candidate');
  const previous = previousEntry && registry.item(previousEntry.id, previousEntry.major, previousEntry.rev, previousEntry.itemHash);
  const hold = previous?.rev === built.item.rev && ['fix', 'reject'].includes(previous.review?.verdict ?? '') ? previous.review : undefined;
  const item = item1Schema.parse({ ...built.item, status: 'candidate', ...(hold ? { review: hold } : {}) });
  if (hashOf(built.def2) !== item.rev) throw new RegistryError('catalog.hash', 'built def does not match the item');
  if (def1Hash(built.engine) !== built.entry.def1Hash || built.entry.def1Hash !== item.def1Hash || built.entry.id !== item.id || built.entry.major !== item.major || built.entry.rev !== item.rev)
    throw new RegistryError('catalog.hash', 'built engine/index does not match the item');
  registry.putDef(built.def2); registry.putDef1(built.entry.def1Hash!, built.engine); registry.putItem(item);
  const entry = { ...built.entry, itemHash: hashOf(item), status: 'candidate' as const };
  const seq = registry.publish('candidate', [entry], run);
  registry.log({ op: 'build-publish', run, id: item.id, major: item.major, rev: item.rev, itemHash: entry.itemHash, contract: item.tests.contract, gates: built.gates.map((g) => ({ gate: g.gate, ok: g.ok, numbers: g.numbers })) });
  return { seq, entry };
}
