import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { coreLibrary } from '@sim/world-compiler';
import { Registry } from './registry.ts';
import { def1to2 } from './def1to2.ts';
import { buildItem, publishItem, type RenderReceipt } from './build.ts';
import { compatibility } from './compat.ts';

const dir = mkdtempSync(join(tmpdir(), 'catalog-build-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
const sourceDir = join(dir, 'item'); mkdirSync(sourceDir);
const raw = coreLibrary().get('core-bench@1')!;
const { hash: _h, ref: _r, by: _b, born: _n, ...source } = raw;
writeFileSync(join(sourceDir, 'src.mjs'), `export default ${JSON.stringify({ ...source, name: 'core-cx-rehearsal-bench' })};\n`);
const metadata = { text: { title: 'Rehearsal bench', first: 'A wooden seat for visitors to sit and rest outside in the garden.', description: 'A wooden seat for visitors to sit and rest outside in the garden.', category: 'furniture.seat', synonyms: ['garden bench', 'park seat', 'wooden seating'], heldOut: ['rest outdoors', 'sit garden'] },
  licence: { spdx: 'CC0-1.0', redistribute: true, source: 'https://github.com/genekogan/sim' }, author: 'test-worker' };
writeFileSync(join(sourceDir, 'item.json'), JSON.stringify(metadata));
const reg = new Registry(join(dir, 'registry'));
const options = { run: 'rehearsal', at: '2026-10-12T12:00:00.000Z' };

test('an item directory builds, gates and publishes without shared-source edits; text updates retain both def hashes', async () => {
  const draft = await buildItem(sourceDir, reg, options);
  assert.equal(draft.ok, false, 'a missing render receipt blocks publication');
  assert.ok(draft.gates.find((g) => g.gate === 'G4')!.errors.length);
  assert.throws(() => publishItem(reg, draft, 'blocked'), /G1–G5/);
  const receipt: RenderReceipt = { gpu: 'NVIDIA test fixture (mocked render)', items: [{ id: draft.entry.aliases[0], defHash: draft.entry.def1Hash!, ok: true,
    views: ['front-left', 'front-right', 'back', 'above'].map((view) => ({ label: 'default', view, file: `${view}.png` })) }] };
  const built = await buildItem(sourceDir, reg, { ...options, receipt });
  assert.ok(built.ok, JSON.stringify(built.gates));
  const candidate = publishItem(reg, built, 'candidate');
  assert.equal(candidate.seq, 1); assert.equal(reg.current('stable').length, 0);
  const stable = reg.promote([built.item.id], 'test-pm');
  assert.equal(stable, 1);
  writeFileSync(join(sourceDir, 'item.json'), JSON.stringify({ ...metadata, text: { ...metadata.text, description: metadata.text.description + ' It fits two people.' } }));
  const updated = await buildItem(sourceDir, reg, { ...options, receipt });
  assert.equal(updated.item.rev, built.item.rev); assert.equal(updated.entry.def1Hash, built.entry.def1Hash);
  assert.notEqual(updated.entry.itemHash, built.entry.itemHash);
  reg.yank(built.item.id, 1, 'yank', 'rehearsal'); assert.equal(reg.resolve(built.entry.aliases[0]), null);
  assert.ok(reg.def1(built.entry.def1Hash!), 'pinned bytes remain');
  reg.rollback('stable', 'rollback', stable); assert.equal(reg.resolve(built.entry.aliases[0])!.rev, built.item.rev);
});

test('G4 receipt cannot be borrowed from a different def or repeated copies of one view', async () => {
  const built = await buildItem(sourceDir, reg, options);
  for (const receipt of [
    { gpu: 'NVIDIA fixture', items: [{ id: built.entry.aliases[0], defHash: 'f'.repeat(64), ok: true, views: [] }] },
    { gpu: 'NVIDIA fixture', items: [{ id: built.entry.aliases[0], defHash: built.entry.def1Hash!, ok: true, views: Array(4).fill({ label: 'default', view: 'front-left', file: 'same.png' }) }] },
  ]) assert.equal((await buildItem(sourceDir, reg, { ...options, receipt })).gates.find((g) => g.gate === 'G4')!.ok, false);
});

test('compat requires a major for narrowed ranges, removed seats and changed physical envelopes', () => {
  const old = def1to2(raw).def2;
  assert.equal(compatibility(old, { ...old, size: { ...old.size, box: [old.size.box[0] * 1.05, old.size.box[1], old.size.box[2]] } }).compatible, true);
  assert.ok(compatibility(old, { ...old, slots: [] }).breaks.some((s) => s.startsWith('slot removed')));
  assert.ok(compatibility(old, { ...old, size: { ...old.size, box: [old.size.box[0] * 1.2, old.size.box[1], old.size.box[2]] } }).requiresMajor);
});
