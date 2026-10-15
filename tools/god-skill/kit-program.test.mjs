import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limb, mirror } from './examples/kit-helpers.mjs';
import { limb as sourceLimb, mirror as sourceMirror } from '../../packages/world-compiler/src/core-kit/authoring/dsl.mjs';
import { defineKit } from './cli.mjs';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('served limb and mirror snippets match the existing DSL helpers', () => {
  for (const kind of [undefined, 'cyl', 'cone']) {
    const args = [[.3, 1, .2], [-.6, .2, .4], .08, '#665544', { ...(kind ? { kind } : {}), role: 'arm.l', pivot: [.3, 1, .2] }];
    const s = limb(...args); assert.deepEqual(s, sourceLimb(...args)); assert.deepEqual(mirror([s]), sourceMirror([s]));
  }
});
test('define-kit passes authored endpoint programs unchanged with explicit bounds', async t => {
  const originalCwd = process.cwd(), originalFetch = globalThis.fetch, dir = mkdtempSync(join(tmpdir(), 'kit-program-cli-')), calls = [];
  process.chdir(dir); writeFileSync('.eden-god.json', JSON.stringify({ world: 'https://world.invalid', token: 'fixture-only' }));
  globalThis.fetch = async (url, opts) => { calls.push({ url, ...opts }); return Response.json({ defs: [] }); };
  t.after(() => { process.chdir(originalCwd); globalThis.fetch = originalFetch; rmSync(dir, { recursive: true, force: true }); });
  const kit = { name: 'beam', box: [3, 3, 1], shapes: [{ kind: 'cyl', from: [0, 0, 0], to: [2, 2, 0], r: .1, mirror: true }] };
  const r = await defineKit(kit, { dry: true });
  assert.deepEqual(r.def.make.args.shapes, kit.shapes); assert.deepEqual(r.def.size.box, kit.box); assert.equal(calls.length, 1);
  await assert.rejects(defineKit({ ...kit, box: undefined }, { dry: true }), /programs need box/);
  assert.equal(calls.length, 1);
});
test('each measured declarative kit is valid define-kit input without a local generator script', async t => {
  const cwd = process.cwd(), fetch = globalThis.fetch, dir = mkdtempSync(join(tmpdir(), 'kit-fixtures-cli-'));
  process.chdir(dir); writeFileSync('.eden-god.json', JSON.stringify({ world: 'https://world.invalid', token: 'fixture-only' }));
  globalThis.fetch = async () => Response.json({ defs: [] });
  t.after(() => { process.chdir(cwd); globalThis.fetch = fetch; rmSync(dir, { recursive: true, force: true }); });
  for (const name of ['m4-gatehouse', 'm2-tower']) {
    const kit = JSON.parse(readFileSync(new URL(`../../packages/generators/src/fixtures/kit-programs/${name}.kit.json`, import.meta.url), 'utf8'));
    const r = await defineKit(kit, { dry: true }); assert.equal(r.def.make.args.shapes.length, kit.shapes.length); assert.ok(r.def.size.box.every(Number.isFinite));
  }
});
