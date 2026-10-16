// r2.1 (release 2 walk, FAIL 1): `look` waited for 60% of *all* snapshot entities in layer.drawn, but resident
// bodies are never drawn by the entity layer, so a world of 3 bodies + 1 thing timed out at 120–300 s.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drawableCount, waitForShot } from './look.mjs';
import { look } from '../cli.mjs';
import { invalidate } from './mirror.mjs';

const defs = [
  { ref: 'core-humanoid@1', hash: 'h1', make: { kind: 'none' }, components: { body: { rig: 'humanoid' } } },
  { ref: 'core-floater@1', hash: 'h2', make: { kind: 'none' }, components: { body: { rig: null } } },
  { ref: 'my-walker@1', hash: 'h3', extends: 'core-humanoid@1', components: {} },          // inherits make + body
  { ref: 'cottage-set@1', hash: 'h4', make: { kind: 'parts', parts: [] }, components: {} }, // prefab container
  { ref: 'core-lantern@1', hash: 'h5', make: { kind: 'gen', gen: 'lantern' }, components: {} },
];
const entities = [
  { id: 'b1', def: 'core/humanoid@1', in: { parent: 'world' } }, { id: 'b2', def: 'sha:h1', in: { parent: 'world' } },
  { id: 'b3', def: 'core/floater@1', in: { parent: 'world' } }, { id: 'b4', def: 'my-walker@1', in: { parent: 'world' } },
  { id: 'set', def: 'cottage-set@1', in: { parent: 'world' } }, { id: 'lamp', def: 'core/lantern@1', in: { parent: 'world' } },
  { id: 'ghost', def: 'missing@1', in: { parent: 'world' } },
];
const snapshot = { seq: 1, buildsRev: 0, constants: { extent: 100 }, entities, defs, library: [] };

test('r2.1 drawableCount: bodies (own or inherited), prefab containers and unresolved defs are not expected in layer.drawn', () => {
  assert.equal(drawableCount(snapshot), 1);
  assert.equal(drawableCount({ entities: [], defs: [] }), 0);
  assert.equal(drawableCount({}), 0);
});

test('r2.1 look asks the viewer for drawable entities only, not the body-heavy snapshot total', async t => {
  const cwd = process.cwd(), original = globalThis.fetch, dir = mkdtempSync(join(tmpdir(), 'r21-look-'));
  process.chdir(dir); invalidate();
  writeFileSync('.eden-god.json', JSON.stringify({ world: 'http://127.0.0.1:5362/w/unit', token: 'fixture-only' }));
  globalThis.fetch = async (url, o) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/seq')) return Response.json({ seq: 1, builds: 0 });
    if (path.endsWith('/snapshot')) return Response.json(snapshot);
    if (path.endsWith('/query')) return Response.json(JSON.parse(o.body).layout ? { layout: { entities: [] } } : { points: [{ y: 0, water: 0 }] });
    throw Error(`unexpected ${path}`);
  };
  t.after(() => { globalThis.fetch = original; process.chdir(cwd); invalidate(); rmSync(dir, { recursive: true, force: true }); });
  let captured;
  await look({ at: '0,0', json: true }, { shoot: async args => { captured = args; return { file: args.out, ms: 1 }; } });
  assert.equal(captured.expect, 1, 'one lantern is drawable; four bodies, a prefab container and an unknown def are not');
});

test('r2.1 the in-page wait settles with 3 bodies + 1 drawn thing, and a real stall names what is missing', async t => {
  const target = new EventTarget();
  const w = { __shotReady: true, __simEntity: { layer: { active: true, drawn: new Map([['lamp', { t0: 0, dur: .001 }]]), now: 1000 } },
    addEventListener: (...a) => target.addEventListener(...a), removeEventListener: (...a) => target.removeEventListener(...a) };
  const before = { window: globalThis.window, document: globalThis.document, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame };
  Object.assign(globalThis, { window: w, document: { title: 'ready' }, requestAnimationFrame: fn => setImmediate(fn), cancelAnimationFrame: id => clearImmediate(id) });
  t.after(() => { for (const [k, v] of Object.entries(before)) if (v === undefined) delete globalThis[k]; else globalThis[k] = v; });
  const ok = await waitForShot({ expect: drawableCount(snapshot), timeoutMs: 2000 });
  assert.equal(ok.ready, true); assert.equal(ok.drawn, 1);
  // the old expectation (every snapshot entity) can never be met; the error now says why instead of a bare timeout
  await assert.rejects(waitForShot({ expect: entities.length, timeoutMs: 50 }), /drawn 1 of 4 needed from 7 drawable/);
});
