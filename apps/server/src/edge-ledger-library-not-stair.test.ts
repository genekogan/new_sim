// B9 (ACCEPT3 battery B, live 3.87): "go to the library" resolved to walk:eden-house-3-roof-stairs, whose offer reads "a
// mars-tool-library-stair" (its def comes from the Mars tool library), and completed on the south lawn, 24 s, ~60 m from
// the library. A word found only as a modifier of an offer's kind no longer names that offer: the words go to the place
// they name (offered, else refused place.unreachable for its on-demand walk), and "the library stair" still names the stair.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolveCapability, type VocabContext, type VocabPlace } from './edge/ledger/vocabulary.ts';
import type { EdgeCapability } from './edge/contract.ts';
import { bootEden } from '../test/eden-capabilities-timing.ts';
import { accept } from '../test/native-owner-fixture.ts';

const places: VocabPlace[] = [
  { id: 'lawn', name: 'South lawn', center: [25, 30], walkable: true },
  { id: 'library-1', name: 'library-1', center: [74, -4], walkable: true },
];
const stair = (n: number, at: [number, number]): EdgeCapability & { at: [number, number] } =>
  ({ id: `walk:house-${n}-roof-stairs`, verb: 'walk', label: `Walk to house-${n}-roof-stairs, a mars-tool-library-stair, by lawn (30 m)`, available: true, target: { id: `house-${n}-roof-stairs`, kind: 'object' }, at });
const libraryWalk: EdgeCapability = { id: 'walk:library-1', verb: 'walk', label: 'Walk to library-1, a hall: in at its front door (78 m)', available: true, target: { id: 'library-1', kind: 'place' } };
const ctx = (withLibrary: boolean): VocabContext => {
  const stairs = [stair(3, [25, 30]), stair(4, [28, 33])];
  const caps = [...stairs, ...(withLibrary ? [libraryWalk] : []), { id: 'walk:lawn', verb: 'walk', label: 'Walk to lawn', available: true, target: { id: 'lawn', kind: 'place' } } as EdgeCapability];
  return { caps, places, root: [], me: [32, 60], target: (c) => {
    const s = stairs.find((x) => x.id === c.id), p = places.find((x) => x.id === c.target?.id);
    return s ? { names: [], around: ['lawn', 'South lawn'], at: s.at } : { names: p ? [p.name] : [], around: [], at: p?.center ?? null };
  } };
};

test('B9: a kind modifier ("a mars-tool-library-stair") does not make a stair the library', () => {
  for (const text of ['go to the library', 'walk to the library', 'go to library']) {
    const r = resolveCapability(text, ctx(true));
    assert.ok(r.kind !== 'unknown', `${text}: ${r.kind === 'unknown' ? r.reason : ''}`);
    assert.equal(r.cap.id, 'walk:library-1', text);
  }
  // the library not offered from here: refused for its on-demand walk, never the nearest stair
  const far = resolveCapability('go to the library', ctx(false));
  assert.equal(far.kind, 'unknown', far.kind !== 'unknown' ? far.cap.id : '');
  assert.equal(far.kind === 'unknown' && far.code, 'place.unreachable');
  assert.equal(far.kind === 'unknown' && far.place, 'library-1');
  // words that name the stair itself (its kind's head) still go to the stair
  for (const text of ['go to the library stair', 'walk to the stairs', 'walk to house-3-roof-stairs']) {
    const r = resolveCapability(text, ctx(true));
    assert.ok(r.kind !== 'unknown', `${text}: ${r.kind === 'unknown' ? r.reason : ''}`);
    assert.match(r.cap.id, /roof-stairs$/, text);
  }
});

const NO_EDEN = existsSync(new URL('../../../worlds/templates/eden-2026.json', import.meta.url)) ? false : 'needs worlds/templates/eden-2026.json (lane/engine content)';
test('Eden 2026: "go to the library" from the garden plots arrives in the library within the B9 budget', { timeout: 900_000, skip: NO_EDEN }, async (t) => {
  const w = await bootEden();
  t.after(() => w.close());
  const e = () => (w.host.engine.world.entities as Record<string, { pose: { p: number[] } }>)[w.soul.entityId];
  e().pose.p = [32.8, e().pose.p[1], 59.8]; await w.settle(2);   // the accept31 start, land-garden-plot-7
  const L = w.edge as unknown as { act: (s: unknown, i: unknown) => unknown; receipt: (soul: string, id: string) => { phase: string } | null; placePathOf: (soul: string) => { id: string }[] };
  const out = await accept(w.host, Promise.resolve(L.act(w.soul, { capability: 'go to the library' }))) as { accepted?: boolean; receipt?: { id: string; capability: string } };
  assert.equal(out.accepted, true, JSON.stringify(out));
  assert.equal(out.receipt!.capability, 'walk:eden-library-1');
  const t0 = w.host.engine.world.tick;
  let phase = 'started';
  while (w.host.engine.world.tick - t0 < 77.8 * 20 && ['accepted', 'started'].includes(phase)) { await w.settle(20); phase = L.receipt(w.soul.soulId, out.receipt!.id)!.phase; }
  assert.equal(phase, 'completed', `after ${((w.host.engine.world.tick - t0) / 20).toFixed(1)} s`);
  assert.ok(L.placePathOf(w.soul.soulId).some((p) => p.id === 'g-eden-library-1'), JSON.stringify(L.placePathOf(w.soul.soulId).map((p) => p.id)));
});
