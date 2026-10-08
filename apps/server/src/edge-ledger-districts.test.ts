// CN5 (Gene 2026-10-07): the districts are walkable — harbour (strip, boardwalk, piers, beach), artists' village, old-town
// plaza and market street — as native level-0 ground with their obstacles; sampled walks from the commons to each district
// arrive without crossing any solid footprint. Observatory hill stays refused (its plateau is ~11.5 m up).
import test from 'node:test';
import assert from 'node:assert/strict';
import {HUMAN_RADIUS} from '../../../mars/viewer/engine/world/catalog.ts';
import {edenNavWorld, inSolid} from '../test/eden-nav-fixture.ts';
import {CN5_DISTRICT_PLACES} from './edge/ledger/districts.ts';

test('districts: admitted as native places; walks from the commons arrive at each with zero footprint crossings', {timeout: 1800000}, async t => {
  const t0 = Date.now(), w = await edenNavWorld(4, {cn5: true}); t.after(() => {w.f.host.stop(); w.f.db.close();});
  t.diagnostic(`boot ${Date.now() - t0} ms, solids ${w.spec!.solids.length}, ground ${w.spec!.ground.length}, bounds ${JSON.stringify(w.engine.groundBoundsV1())}`);
  const adm = w.admitted as {admitted: string[]; refused: {id: string; code: string}[]}, admitted = new Set(adm.admitted);
  assert.deepEqual(CN5_DISTRICT_PLACES.filter(id => !admitted.has(id)), [], 'every district place admitted: ' + JSON.stringify(adm.refused));
  const body = (s: typeof w.souls[number]) => w.engine.world.entities[s.entityId], inside: string[] = [];
  const watch = () => {for (const s of w.souls) {const e = body(s); if (!e?.human || (e.human.level ?? 0) !== 0) continue; for (const q of w.spec!.solids) if (inSolid(e.pose.p[0], e.pose.p[2], q, HUMAN_RADIUS * 0.5)) inside.push(`${s.name} in ${q.id} at ${e.pose.p[0].toFixed(1)},${e.pose.p[2].toFixed(1)}`);}};
  const legs: [string, string][] = [['region-harbour.boardwalk', 'region-harbour.west-pier'], ['region-old-town.plaza', 'region-old-town.market-street'], ['region-artists-village.green', 'region-artists-village'], ['region-harbour.beach', 'region-harbour.east-pier']];
  const placeOf = (s: typeof w.souls[number]) => w.ledger.placePathOf(s.soulId).map(p => p.id);
  for (const [i, [first, second]] of legs.entries()) {
    const s = w.souls[i];
    for (const target of [first, second]) {
      const t1 = Date.now(), out: any = await w.act(s, 'walk:' + target); assert.equal(out.accepted, true, target + ' ' + JSON.stringify(out));
      const ticks = await w.run([{soulId: s.soulId, id: out.receipt.id}], 20 * 60 * 6, watch), r = w.ledger.receipt(s.soulId, out.receipt.id)!;
      t.diagnostic(`${s.name} → ${target}: ${r.phase} in ${ticks} ticks (${Date.now() - t1} ms wall) at ${body(s).pose.p.map((v: number) => v.toFixed(1)).join(',')} path ${placeOf(s).join('>')}`);
      assert.equal(r.phase, 'completed', `${target}: ${JSON.stringify(r)}`);
      assert.ok(placeOf(s).includes(target), `${s.name} is in ${target}: ${placeOf(s).join(' > ')}`);
    }
  }
  assert.deepEqual(inside.slice(0, 5), [], 'no footprint crossings');
  // natural names reach them; the observatory plateau is refused, never swapped for another place
  const [a] = w.souls;
  const harbour: any = await w.act(a, 'walk to the harbour'); assert.equal(harbour.accepted, true); assert.equal(harbour.resolved?.to, 'walk:region-harbour');
  const obs: any = await w.act(a, 'walk to the observatory'); assert.equal(obs.accepted, false); assert.equal(obs.code, 'place.unreachable'); assert.ok(obs.did_you_mean.length > 0);
  assert.deepEqual(w.f.host.engine.runtime.violations, []);
});
