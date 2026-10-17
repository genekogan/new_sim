// The blocked-ground index a scatter avoids is built once per world state, not once per scatter (Eden 2026: ~240
// woodlands each rebuilt it over ~3,800 entities, first frame 25 s -> 6 s), and it still sees every edit.
//   node --test apps/web/src/gen-mesh/ecology-block-cache.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch, type DefInput } from '@sim/world-compiler';
import terrainKit from '../../../../packages/world-compiler/src/core-kit/terrain.json' with { type: 'json' };
import { blockedBy } from './ecology.mesh.ts';

function world() {
  const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'block' });
  const have = new Set(CORE_KIT.map((d) => d.name));
  for (const d of [...CORE_KIT, ...(terrainKit as unknown as DefInput[]).filter((d) => !have.has(d.name))]) w.defineDef(d, 'core', 0);
  return w;
}

test('scatters share one blocked-ground index per world state; an edit rebuilds it', () => {
  const w = world();
  const add = (ops: unknown[]) => { const r = applyBatch(w, { ops } as never, 'god', 0) as { result: { accepted: boolean } }; assert.equal(r.result.accepted, true, JSON.stringify(r.result)); };
  add([{ op: 'place', def: 'core/bench@1', name: 'bench', p: [10, 10] },
    { op: 'place', def: 'core/woodland@1', name: 'wood-a', shape: { area: [[0, 0], [40, 0], [40, 40], [0, 40]] } },
    { op: 'place', def: 'core/woodland@1', name: 'wood-b', shape: { area: [[0, 0], [40, 0], [40, 40], [0, 40]] } }]);
  let footprints = 0; const fp = w.footprint.bind(w); w.footprint = ((...a: Parameters<typeof fp>) => { footprints++; return fp(...a); }) as typeof w.footprint;
  const a = blockedBy(w, w.get('wood-a')!), first = footprints, b = blockedBy(w, w.get('wood-b')!);
  assert.ok(first > 0, 'the first scatter builds the index');
  assert.equal(footprints, first, 'the second scatter reuses it');
  assert.equal(a(9.3, 10), true, 'a bench leg (+0.6 m pad) blocks'); assert.equal(b(9.3, 10), true); assert.equal(a(29.3, 30), false);
  add([{ op: 'place', def: 'core/bench@1', name: 'bench-2', p: [30, 30] }]);
  assert.equal(blockedBy(w, w.get('wood-a')!)(29.3, 30), true, 'a new solid is seen after the edit');
});
