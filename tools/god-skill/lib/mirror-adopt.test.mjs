// GODPLACE: an edit's mirror delta is applied to the mirror this process held when it sent the edit, never by
// re-reading the cache file (a 7+ MB parse at Eden 2026 size), and the cache it writes is the same either way.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {adoptMirror, heldMirror, invalidate, mirrorHash, CACHE} from './mirror.mjs';

const guard = (rows, ents, defs) => mirrorHash(`${rows.map((r) => `${r.id}:${mirrorHash(JSON.stringify(r))}`).join(',')}|${ents.map((e) => `${e.id}:${mirrorHash(JSON.stringify(e))}`).join(',')}|${mirrorHash(JSON.stringify(defs))}`);
const top = (seq) => ({contract: 'god/1', seq, buildsRev: 0, constants: {extent: 100}});
const ent = (id, x) => ({id, def: 'core-bench@1', in: {parent: 'world'}, name: id, p: [x, 0, 0]});
const row = (id, x) => ({id, path: id, name: id, def: 'core-bench@1', parent: 'world', at: [x, 0]});

test('act adopts the mirror delta onto the held mirror without reading the cache file; same cache as from disk', () => {
  const cwd = process.cwd(), dir = mkdtempSync(join(tmpdir(), 'gp-adopt-'));
  try {
    process.chdir(dir); invalidate();
    writeFileSync('.eden-god.json', JSON.stringify({world: 'http://127.0.0.1:1/w/x'}));
    const defs = [{ref: 'core-bench@1', hash: 'h'}], library = [{ref: 'core-bench@1', hash: 'h'}];
    const e0 = [ent('a', 1)], r0 = [row('a', 1)];
    assert.equal(adoptMirror({contract: 'mirror/1', full: true, top: top(1), entities: e0, rows: r0, defs, library, libraryHash: 'L', guard: guard(r0, e0, defs)}), true);
    const held = heldMirror(), base = held.guard;
    const e1 = [...e0, ent('b', 2)], r1 = [...r0, row('b', 2)];
    const delta = {contract: 'mirror/1', since: base, top: top(2), entities: [ent('b', 2)], entitiesGone: [], rows: [row('b', 2)], rowsGone: [], libraryHash: 'L', guard: guard(r1, e1, defs)};
    // from disk (the old path): what the cache file holds after the edit
    invalidate(); assert.equal(adoptMirror(delta), true);
    const fromDisk = JSON.parse(readFileSync(CACHE, 'utf8'));
    // the held path, with the cache file made unreadable: it must not be read
    writeFileSync(CACHE, JSON.stringify(held)); invalidate(); writeFileSync(CACHE, 'not json');
    assert.equal(adoptMirror(delta, held), true);
    const fromHeld = JSON.parse(readFileSync(CACHE, 'utf8'));
    delete fromDisk.at; delete fromHeld.at;
    assert.deepEqual(fromHeld, fromDisk);
    assert.deepEqual(fromHeld.rows.map((r) => r.id), ['a', 'b']);
  } finally { invalidate(); process.chdir(cwd); rmSync(dir, {recursive: true, force: true}); }
});
