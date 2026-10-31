// L3 item 4 (server reliability, 2026-10-31): acting on one capability builds that one offer (`EdgeLedger.bindOne`), not
// the Soul's whole menu. The oracle: for every id the whole menu offers, bindOne(id) equals the menu's offer and plan
// (`binds().caps.find(id)`, `binds().plans.get(id)`), built cold (no kept menu) and from a kept menu (tail redone for the
// one offer), at the arrival and after walks; an id the menu lacks is undefined.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import {bootEden} from '../test/eden-capabilities-timing.ts';
import {fixture, invite, accept} from '../test/native-owner-fixture.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {hereFrame, Perception} from './edge/perception/here.ts';
import type {EdgeSoul, EdgeCapability} from './edge/contract.ts';

const NO_EDEN = existsSync(new URL('../../../worlds/templates/eden-2026.json', import.meta.url)) ? false : 'needs worlds/templates/eden-2026.json';
type Raw = {bindOneRaw(s: EdgeSoul, id: string): unknown; binds(s: EdgeSoul): {caps: EdgeCapability[]; plans: Map<string, unknown>}};

/** `here` from its focused menu equals `here` from the whole menu (the frame before item 4), with doHere. */
function hereSame(L: EdgeLedger, soul: EdgeSoul, what: string) {
  const proto = Perception.prototype as unknown as {menu(): {caps: EdgeCapability[]}}, focused = proto.menu;
  L.invalidateBodies(); const a = JSON.stringify(hereFrame(L, soul, {doHere: true}));
  proto.menu = function (this: {L: EdgeLedger; soul: EdgeSoul}) {return {caps: this.L.capabilities(this.soul)};};
  try {L.invalidateBodies(); const b = JSON.stringify(hereFrame(L, soul, {doHere: true})); let i = 0; while (i < a.length && a[i] === b[i]) i++; assert.equal(a, b, `${what}: here differs at ${a.slice(Math.max(0, i - 120), i + 120)} | ${b.slice(Math.max(0, i - 120), i + 120)}`);}
  finally {proto.menu = focused;}
}

/** Every id of the whole menu, cold (cache dropped) and kept: the number of ids checked. */
function sweep(L: EdgeLedger, soul: EdgeSoul, what: string): number {
  const raw = L as unknown as Raw, full = raw.binds(soul), ids = [...new Set(full.caps.map(c => c.id))];
  const want = (id: string) => {const cap = full.caps.find(c => c.id === id); return JSON.stringify(cap ? {cap, plan: full.plans.get(id)} : null);};
  const bad: string[] = [];
  // kept: the menu just built is this tick's (same-tick path); then dropped: every id built cold by a focused build
  for (const id of ids) if (JSON.stringify(raw.bindOneRaw(soul, id) ?? null) !== want(id)) bad.push('same-tick ' + id);
  L.invalidateBodies();
  for (const id of ids) {
    const got = JSON.stringify(raw.bindOneRaw(soul, id) ?? null);
    if (got !== want(id)) bad.push(`cold ${id}: ${L.bindOneOracleV1(soul, id)}`);
  }
  assert.equal(raw.bindOneRaw(soul, 'walk:no-such-place-anywhere'), undefined);
  hereSame(L, soul, what);
  assert.deepEqual(bad.slice(0, 8), [], `${what}: ${bad.length} of ${ids.length} offers differ`);
  return ids.length;
}

test('Eden 2026: bindOne equals the whole menu for every offered id (cold and kept), at the arrival and after walks', {timeout: 900_000, skip: NO_EDEN}, async t => {
  const w = await bootEden(); t.after(() => w.close());
  const L = w.edge, host = w.host, soul = w.soul;
  const run = async (n: number) => {for (let i = 0; i < n; i++) {host.tickOnce(); if (i % 10 === 0) {await setImmediate(); host.drainInputs();}} await setImmediate(); host.drainInputs();};
  await run(120);   // rides spawn and the nav epoch settles
  const n0 = sweep(L, soul, 'arrival');
  assert.ok(n0 > 300, `Eden 2026 offers hundreds of ids (${n0})`);
  // kept path: build the menu, tick (the body stands still), then each id from the kept menu with the tail redone
  const raw = L as unknown as Raw; raw.binds(soul); host.tickOnce();
  const kept = raw.binds(soul).caps.slice(0, 120).map(c => c.id); host.tickOnce();
  const bad = kept.filter(id => L.bindOneOracleV1(soul, id) !== null);
  assert.deepEqual(bad, [], 'kept-menu offers equal the fresh menu');
  // after walks: a walk and a gait elsewhere, then the sweep again where the Soul stands
  for (const verb of ['walk', 'jog']) {
    const t0 = Date.now();
    const go = raw.binds(soul).caps.find(c => c.verb === verb && c.available && c.target?.kind === 'place');
    if (!go) continue;
    const r = await L.act(soul, {capability: go.id}); assert.equal(r.accepted, true, `${go.id}: ${JSON.stringify(r).slice(0, 200)}`);
    for (let k = 0; k < 12 && L.openReceipts(soul.soulId).length; k++) await run(25);   // (mid-walk or arrived: either is a fresh place to check)
    sweep(L, soul, `after ${go.id}`); t.diagnostic(`${go.id}: ${Date.now() - t0} ms`);
  }
});

test('green-field world: bindOne equals the whole menu for every offered id', {timeout: 300_000}, async t => {
  const f = fixture(':memory:'); t.after(() => {f.brain.quiesce(); f.host.stop(); f.db.close();});
  const L = new EdgeLedger(f.host, f.db);
  await invite(f, 'ana');
  const row = await accept(f.host, f.souls.create('dev:ana', {name: 'Ana', description: 'oracle'})) as {id: string; entity_id: string; name: string; owner: string};
  for (let i = 0; i < 6; i++) {f.host.tickOnce(); await setImmediate(); f.host.drainInputs();}
  const soul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  assert.ok(sweep(L, soul, 'green field') > 5);
});
