// ROUTE-RECHECK (ACCEPT2 2026-10-23, still failing on 3.70): "read a book in the library" from the park or the commons
// pond resolved to the campus library annex and was refused place.unreachable ("there is nowhere to read in ..."): the
// listing keeps only the nearest reading places, so neither library had a read:<place> offer from afar, and the refusal
// named the first match (the annex). A place named by a spot verb is now offered on demand (its read:<place> built for
// that act), and among the places the words name the one called just that (the Library) comes before an "annex".
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { bootEden } from '../test/eden-capabilities-timing.ts';

const NO_EDEN = existsSync(new URL('../../../worlds/templates/eden-2026.json', import.meta.url)) ? false : 'needs worlds/templates/eden-2026.json (lane/engine content)';
type Would = { ok: boolean; code?: string; reason?: string; would?: { capability: string } };

test('Eden 2026: "read a book in the library" reads in the library from anywhere', { timeout: 600_000, skip: NO_EDEN }, async (t) => {
  const w = await bootEden();
  t.after(() => w.close());
  const e = () => (w.host.engine.world.entities as Record<string, { pose: { p: number[] } }>)[w.soul.entityId];
  const stand = async (x: number, z: number) => { e().pose.p = [x, e().pose.p[1], z]; await w.settle(2); };
  const dry = (text: string) => w.edge.intents.dryRun(w.soul, { capability: text }) as Would;
  for (const [x, z, where] of [[-30, 110, 'park lawns west'], [0, 98, 'park specimens'], [-38, 8, 'commons pond reeds'], [-15, -100, 'campus quad'], [10, 5, 'by the library']] as const) {
    await stand(x, z);
    const r = dry('read a book in the library');
    assert.equal(r.ok, true, `${where}: ${r.code ?? ''} ${r.reason ?? ''}`);
    assert.match(r.would!.capability, /^read:g-eden-library-1\b/, `${where}: the Library, not the annex (${r.would!.capability})`);
  }
  // the annex by its own name still reads in the annex
  await stand(-15, -100);
  const annex = dry('read a book in the library annex');
  assert.equal(annex.ok, true, `${annex.code ?? ''} ${annex.reason ?? ''}`);
  assert.match(annex.would!.capability, /annex/);
});

// ROUTE-RECHECK: "go for a swim" by the park pond was "Say which: swim:<target>" (Eden 2026 offers several waters)
test('Eden 2026: "go for a swim" swims in the nearest water', { timeout: 600_000, skip: NO_EDEN }, async (t) => {
  const w = await bootEden();
  t.after(() => w.close());
  const e = () => (w.host.engine.world.entities as Record<string, { pose: { p: number[] } }>)[w.soul.entityId];
  e().pose.p = [-30, e().pose.p[1], 110]; await w.settle(2);
  const r = w.edge.intents.dryRun(w.soul, { capability: 'go for a swim' }) as Would;
  assert.equal(r.ok, true, `${r.code ?? ''} ${r.reason ?? ''}`);
  assert.equal(r.would!.capability, 'swim:land-park-pond');
});
