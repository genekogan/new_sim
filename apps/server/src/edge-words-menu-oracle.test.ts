// L3 (b, server reliability, 2026-10-31): plain words (POST /resolve, act in words) resolve on a "words menu" that is kept
// where the whole menu is not (other Souls by radius band, my own position by 2 m cell, not over my own acts), and the
// offer the words choose is rebuilt exactly (bindOne) before it is reported or acted on. The oracle: at every step of a
// scenario on Eden 2026 (Ana walks and acts in words, Bea walks and gestures near her), each phrase of a corpus resolves
// on the words menu to what it resolves to on a menu built fresh from the world as it is; and the kept path is exercised.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import {accept, invite} from '../test/native-owner-fixture.ts';
import {bootEden} from '../test/eden-capabilities-timing.ts';
import {menuStats} from './edge/ledger/menu-stats.ts';
import type {EdgeSoul} from './edge/contract.ts';

const NO_EDEN = existsSync(new URL('../../../worlds/templates/eden-2026.json', import.meta.url)) ? false : 'needs worlds/templates/eden-2026.json';
const PHRASES = ['sit on a bench', 'walk to the pond', 'go to the cafe', 'wave to Bea', 'wave to Ana', 'hug Bea', 'go near Bea', 'follow Ana', 'read a book',
  'walk to the library', 'jog to the lawn', 'sit down', 'dance with Ana', 'stroll', 'lie down', 'play the piano', 'warm up by the fire', 'go to the garden'];

test('Eden 2026: words resolve on the kept words menu as on a fresh whole menu, at every step', {timeout: 900_000, skip: NO_EDEN}, async t => {
  const w = await bootEden(); t.after(() => w.close());
  const L = w.edge, host = w.host, ana = w.soul;
  await invite(w, 'bea');
  const row = await accept(host, w.souls.create('dev:bea', {name: 'Bea', description: 'oracle'})) as {id: string; entity_id: string; name: string; owner: string};
  const bea: EdgeSoul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  const run = async (n: number) => {for (let i = 0; i < n; i++) {host.tickOnce(); if (i % 10 === 0) {await setImmediate(); host.drainInputs();}} await setImmediate(); host.drainInputs();};
  const act = async (s: EdgeSoul, capability: string) => {const out = await accept(host, Promise.resolve(L.act(s, {capability}))) as {accepted?: boolean; code?: string}; return out;};
  await run(120);
  let checks = 0;
  const check = (what: string) => {
    for (const s of [ana, bea]) for (const text of PHRASES) {const diff = L.wordsDiffV1(s, text); assert.equal(diff, null, `${what}: ${s.name} "${text}" (${diff})`); checks++;}
  };
  const kept0 = menuStats.words.kept;
  check('settled');
  await run(3); check('settled, 3 ticks on');
  // Bea walks near Ana (a moving neighbour), Ana acts in words and walks (a moving self), both resolve at every step
  const walk = L.capabilities(bea).find(c => c.verb === 'walk' && c.available && c.target?.kind === 'place');
  if (walk) await act(bea, walk.id);
  for (let i = 0; i < 4; i++) {await run(15); check(`Bea walking (${i})`);}
  const out = await act(ana, 'walk to the pond');
  for (let i = 0; i < 6; i++) {await run(10); check(`Ana walking in words (${i})`); await act(ana, 'walk to the pond');}
  await act(bea, 'wave to Ana'); await run(20); check('Bea waved');
  await act(ana, 'stand:here'); await run(40); check('Ana stood');
  await run(400); check('idle 20 s');
  t.diagnostic(`${checks} phrase checks; words menu ${JSON.stringify(menuStats.words)}; Ana's first words act ${JSON.stringify(out).slice(0, 120)}`);
  assert.ok(menuStats.words.kept > kept0, 'the kept words menu answered at least once');
});
