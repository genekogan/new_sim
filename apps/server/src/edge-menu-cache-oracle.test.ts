// L3 item 3 (server reliability, 2026-10-31): a Soul's menu is kept across ticks while nothing it reads has changed
// (its body, the bodies near it, the cells near it, together, the static world, the world minute) instead of being
// rebuilt every tick and cleared for every Soul on any act. The oracle: at every step of a replayed scenario on
// Eden 2026 (three Souls: two together near the arrival, one 200+ m away; walks, waves, sits, stands, idle time), each
// Soul's menu equals one built fresh from the world as it is. And locality: the far Soul keeps its menu while the
// others act.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import {accept, invite} from '../test/native-owner-fixture.ts';
import {bootEden} from '../test/eden-capabilities-timing.ts';
import {menuStats} from './edge/ledger/menu-stats.ts';
import type {EdgeSoul} from './edge/contract.ts';

const NO_EDEN = existsSync(new URL('../../../worlds/templates/eden-2026.json', import.meta.url)) ? false : 'needs worlds/templates/eden-2026.json';

test('Eden 2026: kept menus equal fresh ones at every step, and a far Soul keeps its menu while others act', {timeout: 600_000, skip: NO_EDEN}, async t => {
  const w = await bootEden(); t.after(() => w.close());
  const L = w.edge, host = w.host, souls: EdgeSoul[] = [w.soul];
  for (const name of ['bea', 'cy']) {
    await invite(w, name);
    const row = await accept(host, w.souls.create(`dev:${name}`, {name: name[0]!.toUpperCase() + name.slice(1), description: 'oracle'})) as {id: string; entity_id: string; name: string; owner: string};
    souls.push({soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner});
  }
  const run = async (n: number) => {for (let i = 0; i < n; i++) {host.tickOnce(); if (i % 10 === 0) {await setImmediate(); host.drainInputs();}} await setImmediate(); host.drainInputs();};
  await run(60);
  const [ana, bea, cy] = souls as [EdgeSoul, EdgeSoul, EdgeSoul];
  const at = (s: EdgeSoul) => host.engine.world.entities[s.entityId]!.pose.p;
  const where = (id: string): [number, number] | null => {const poly = L.places.byId.get(id)?.polygon; return poly?.length ? [poly.reduce((a, p) => a + p[0], 0) / poly.length, poly.reduce((a, p) => a + p[1], 0) / poly.length] : L.positionOf(id);};
  // Cy goes far (300-600 m from the arrival, beyond the 160 m a menu reads): onto standing room near an outdoor place
  const eng = host.engine as unknown as {nearestStandableV1(at: [number, number]): [number, number] | null};
  const far = [...L.places.byId.values()].filter(p => p.parent !== null && !p.enclosed && ['lawn', 'field', 'park', 'garden', 'outdoor', 'plaza'].includes(p.kind))
    .map(p => ({id: p.id, c: where(p.id)!})).filter(x => x.c && Math.hypot(x.c[0] - at(cy)[0], x.c[1] - at(cy)[2]) > 300 && Math.hypot(x.c[0] - at(cy)[0], x.c[1] - at(cy)[2]) < 600)
    .map(x => ({...x, p: eng.nearestStandableV1(x.c)})).find(x => !!x.p) as {id: string; p: [number, number]} | undefined;
  assert.ok(far, 'standing room 300-600 m off');
  await accept(host, host.enqueue('edge-relocate', `edge:${cy.soulId}`, {soulId: cy.soulId, entityId: cy.entityId, to: far.p}));
  await run(60);
  let steps = 0;
  const check = async (what: string) => {
    for (const s of souls) {L.capabilities(s); const diff = L.menuOracleV1(s); assert.equal(diff, null, `${what}: ${s.name}'s kept menu is the fresh one (${diff})`);}
    steps++;
  };
  const act = async (s: EdgeSoul, capability: string) => {const out = await accept(host, Promise.resolve(L.act(s, {capability}))) as {accepted?: boolean}; return !!out.accepted;};
  await check('settled');
  // the far Soul keeps its menu while the others act near the arrival
  L.capabilities(cy); const kept0 = menuStats.cap.hitKept, miss0 = menuStats.cap.miss, cy0 = menuStats.missBySoul[cy.soulId] ?? 0, ana0 = menuStats.missBySoul[ana.soulId] ?? 0, t0 = host.engine.world.tick;
  const near = L.capabilities(ana).filter(c => c.verb === 'walk' && c.available && c.target?.kind === 'place')
    .find(c => {const p = where(c.target!.id); return p && Math.hypot(p[0] - at(ana)[0], p[1] - at(ana)[2]) < 40;});
  assert.ok(await act(ana, 'wave:here'), 'Ana waves');
  await run(5);
  await check('after a wave');
  if (near) {assert.ok(await act(bea, near.id), `Bea walks to ${near.id}`); for (let i = 0; i < 6; i++) {await run(40); await check(`Bea walking (${i})`);}}
  const sit = L.capabilities(ana).find(c => /^sit(-ground)?:here$/.test(c.id) && c.available);
  const sat = !!sit && await act(ana, sit.id); await run(80); await check(sat ? 'Ana sitting' : 'Ana idle');
  if (sat) assert.ok(await act(ana, 'stand:here'), 'Ana stands'); await run(60); await check('Ana stood');
  await run(400); await check('idle 20 s');
  L.capabilities(cy);
  const all = menuStats.cap.miss - miss0, kept = menuStats.cap.hitKept - kept0, cyMiss = (menuStats.missBySoul[cy.soulId] ?? 0) - cy0, anaMiss = (menuStats.missBySoul[ana.soulId] ?? 0) - ana0;
  const minutes = Math.floor(host.engine.world.tick / 1200) - Math.floor(t0 / 1200);
  t.diagnostic(`${steps} oracle steps over ${host.engine.world.tick - t0} ticks: ${all} rebuilds, ${kept} kept; far Soul ${cyMiss} rebuilds (${minutes} world-minute changes), Ana ${anaMiss}`);
  // the far Soul rebuilds only when the world minute moves (activities name the time), never for the others' acts
  assert.ok(cyMiss <= minutes + 1, `the far Soul keeps its menu while others act (${cyMiss} rebuilds, ${minutes} minute changes)`);
  assert.ok(anaMiss > cyMiss, 'the acting Soul rebuilds');
});
