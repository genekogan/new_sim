// 3.2 walk finding: a resident at the Eden 2026 commons asked to "go to the big top" was refused place.unreachable while
// visitors walked there. The listing offers walks only to nearby things (buildings within 150 m, places within 400 m of
// the Soul's position, nearest 120 things), and the big top (277,52) is ~280 m from the arrival; the place itself is
// reachable. A named place asked for by name now gets its one walk on demand for that act; the listing stays as it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { accept } from '../test/native-owner-fixture.ts';
import { bootEden } from '../test/eden-capabilities-timing.ts';

const NO_EDEN = existsSync(new URL('../../../worlds/templates/eden-2026.json', import.meta.url)) ? false : 'needs worlds/templates/eden-2026.json (lane/engine content)';
const BIG_TOP = 'walk:region-festival-meadow-big-top', AT: [number, number] = [277, 52];

test('Eden 2026: a resident far from the big top walks there when asked by name', { timeout: 600_000, skip: NO_EDEN }, async (t) => {
  const w = await bootEden();
  t.after(() => w.close());
  const before = w.edge.capabilities(w.soul);
  assert.ok(!before.some((c) => c.id === BIG_TOP), 'the big top is beyond the listing (the case this covers)');
  const pos = () => { const p = w.host.engine.world.entities[w.soul.entityId].pose.p; return Math.hypot(p[0] - AT[0], p[2] - AT[1]); };
  const d0 = pos();
  assert.ok(d0 > 200, `the Soul starts far from the big top (${Math.round(d0)} m)`);
  const a = await accept(w.host, Promise.resolve(w.edge.act(w.soul, { capability: 'go to the big top', clientRef: 'bt-1' }))) as { accepted?: boolean; code?: string; reason?: string; resolved?: { to?: string } };
  assert.equal(a.accepted, true, `accepted (${a.code ?? ''} ${a.reason ?? ''})`);
  assert.equal(a.resolved?.to, BIG_TOP);
  assert.ok(!w.edge.capabilities(w.soul).some((c) => c.id === BIG_TOP), 'the listing is unchanged (the walk was for that act only)');
  await w.settle(60);
  assert.ok(pos() < d0 - 1, `the Soul is walking toward the big top (${Math.round(d0)} -> ${Math.round(pos())} m)`);
});
