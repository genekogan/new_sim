// R2 stroll (longrun 2026-10-16, team/lanes/t3-stroll.md): three residents stood still for 70 minutes. Every "stroll around
// the Green field" resolved to stroll:field, whose 5-stop loop had one stop inside the walk1 construction closure, so the
// whole loop was blocked ("walk1 is under construction") and the Soul stayed put. The exact phrases from the live logs:
// a stroll named for the place the Soul is already in wanders right there; a different place still walks there; a site
// under construction is still refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {fixture, invite, accept, factory} from '../test/native-owner-fixture.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {resolveCapability, type VocabContext, type VocabPlace} from './edge/ledger/vocabulary.ts';
import type {EdgeCapability} from './edge/contract.ts';

const BLOCK = {code: 'site.under-construction', reason: 'walk1 is under construction; come back when it is finished.'};
const places: VocabPlace[] = [
  {id: 'field', name: 'Green field', center: [0, 0], parent: 'world', kind: 'grounds', walkable: true},
  {id: 'cottage', name: 'Moss cottage', center: [-15, -15], parent: 'field', kind: 'building', walkable: true},
  {id: 'walk-lighthouse', name: 'Release walk lighthouse', center: [24, 30], parent: 'field', kind: 'building', walkable: true},
];
const P = (verb: string, id: string, label: string, blocked = false): EdgeCapability => ({id: `${verb}:${id}`, verb, label, available: !blocked, ...(blocked ? {blocked: BLOCK} : {}), target: {id, kind: 'place'}});
const caps = (fieldBlocked: boolean): EdgeCapability[] => [
  P('stroll', 'field', 'Stroll through Green field (a loop of 5 stops)', fieldBlocked),
  P('walk', 'field', 'Green field'), P('walk', 'cottage', 'Moss cottage'), P('walk', 'walk-lighthouse', 'Release walk lighthouse', true),
  {id: 'wander:here', verb: 'wander', label: 'Stroll around nearby', available: true},
  {id: 'rest:here', verb: 'rest', label: 'Rest here', available: true}, {id: 'lie:here', verb: 'lie', label: 'Lie down on the grass here', available: true},
];
const ctx = (fieldBlocked = true, here = ['field', 'world']): VocabContext => ({caps: caps(fieldBlocked), places, root: ['world'], me: [0, 0], here,
  target: c => {const p = places.find(x => x.id === c.target?.id); return {names: p ? [p.name] : [], around: [], at: p ? p.center : null};}});
const to = (input: string, c = ctx()) => {const r = resolveCapability(input, c); return r.kind === 'unknown' ? `unknown:${r.code ?? 'capability.unknown'}` : r.cap.id;};

test('stroll: the longrun phrases about the Green field the Soul stands in wander there while its loop is closed', () => {
  // Ada ×2, Basil, the owner's tour stretch, and the everyday variants of the same request
  for (const phrase of ['stroll around the Green field', 'take a walk through the Green field', 'take a walk through the park',
    'walk around the Green field', 'explore the Green field', 'tour the Green field', 'take a tour of the Green field', 'go for a stroll in the field',
    'wander around the Green field', 'stroll through the field', 'go touring'])
    assert.equal(to(phrase), 'wander:here', phrase);
  const r = resolveCapability('stroll around the Green field', ctx());
  assert.equal(r.kind, 'alias');
  assert.match((r as {note: string}).note, /you are in Green field already and its loop \(stroll:field\) is closed right now \(walk1 is under construction; come back when it is finished\); wandering around where you are instead \(wander:here\)/);
  // nothing named was already a wander here; it stays one
  for (const phrase of ['explore', 'take a walk', 'take a tour', 'stroll']) assert.equal(to(phrase), 'wander:here', phrase);
});

test('stroll: with the loop open the same phrases take the real loop through the field (unchanged)', () => {
  for (const phrase of ['stroll around the Green field', 'take a walk through the Green field', 'take a walk through the park', 'walk around the Green field', 'tour the Green field'])
    assert.equal(to(phrase, ctx(false)), 'stroll:field', phrase);
});

test('stroll: a different, reachable place still walks there; a Soul outside the closed place is not swapped to a wander', () => {
  assert.equal(to('walk to the Moss cottage'), 'walk:cottage');
  assert.equal(to('go to the cottage'), 'walk:cottage');
  assert.equal(to('walk to the Green field'), 'walk:field', 'walk to (not around) keeps the walk');
  // standing in the cottage only (not in the field): the closed field loop keeps its own refusal, nothing else chosen
  const r = resolveCapability('stroll around the Green field', ctx(true, ['cottage']));
  assert.equal(r.kind === 'alias' && r.cap.id, 'stroll:field');
  assert.equal(r.kind === 'alias' && r.cap.available, false, 'the ledger refuses it with the site code');
  // an exact id is never rewritten here (the ledger's refusal names the alternative instead)
  assert.equal(to('stroll:field'), 'stroll:field');
});

test('stroll: a phrase naming the site under construction is still the site (refused by the ledger), never a wander', () => {
  for (const phrase of ['walk to the Release walk lighthouse', 'walk to the walk lighthouse', 'go to the lighthouse']) {
    const r = resolveCapability(phrase, ctx());
    assert.equal(r.kind === 'alias' && r.cap.id, 'walk:walk-lighthouse', phrase);
    assert.equal(r.kind === 'alias' && r.cap.available, false, phrase);
  }
  // a place that does not exist is refused honestly, never mapped onto the field (Cleo's "walk to the harbour")
  assert.match(to('walk to the harbour'), /^unknown:/);
});

// The same through the real ledger on the Green field world (the live release-check template), with the construction
// block applied the way the Godmode layer applies it (worldProfile: available false, blocked, plan removed).
async function greenField(t: import('node:test').TestContext, closed: boolean) {
  const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
  t.after(() => {f.brain.quiesce(); f.host.stop(); f.db.close();});
  const settle = async (n = 3) => {for (let i = 0; i < n; i++) {f.host.tickOnce(); await setImmediate(); f.host.drainInputs();}};
  await invite(f, 'ada'); const row: any = await accept(f.host, f.souls.create('dev:ada', {name: 'Ada', description: 'curious'})); await settle(3);
  const L = new EdgeLedger(f.host, f.db), soul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  if (closed) L.worldProfile = (_s, caps, plans) => {for (const c of caps) if (c.id === 'stroll:field') {c.available = false; c.blocked = {...BLOCK}; plans.delete(c.id);}};
  const W = f.host.engine.world as any, pos = (): [number, number] => {const p = W.entities[soul.entityId].pose.p; return [p[0], p[2]];};
  const run = async (n: number) => {for (let i = 0; i < n; i++) {f.host.tickOnce(); if (i % 20 === 0) {await setImmediate(); f.host.drainInputs();}}};
  return {f, L, soul, pos, run, act: (capability: string) => accept(f.host, L.act(soul, {capability})) as Promise<any>};
}

test('stroll (ledger): "take a walk through the Green field" wanders and the body moves while walk1 closes the loop', {timeout: 120000}, async t => {
  const w = await greenField(t, true);
  assert.equal(w.L.capabilities(w.soul).find(c => c.id === 'stroll:field')?.available, false, 'fixture: the field loop is closed');
  const before = w.pos(), out = await w.act('take a walk through the Green field');
  assert.equal(out.accepted, true, JSON.stringify(out));
  assert.equal(out.receipt.capability, 'wander:here');
  assert.match(out.resolved.note, /closed right now \(walk1 is under construction; come back when it is finished\); wandering around where you are instead/);
  let moved = 0; for (let i = 0; i < 12 && moved < 1; i++) {await w.run(100); moved = Math.max(moved, Math.hypot(w.pos()[0] - before[0], w.pos()[1] - before[1]));}
  t.diagnostic(`moved ${moved.toFixed(2)} m from [${before.map(v => v.toFixed(1))}]`);
  assert.ok(moved >= 1, `the Soul visibly moved (${moved.toFixed(2)} m)`);
});

test('stroll (ledger): the site refusal names the in-place alternative; with the loop open the phrase takes the loop', {timeout: 120000}, async t => {
  const w = await greenField(t, true);
  const refused = await w.act('stroll:Green field');
  assert.equal(refused.accepted, false); assert.equal(refused.code, 'site.under-construction');
  assert.equal(refused.reason, 'walk1 is under construction; come back when it is finished; to stroll here instead, explore the Green field (wander:here).');
  assert.equal(refused.did_you_mean?.[0]?.id, 'wander:here');
  const open = await greenField(t, false), out = await open.act('take a walk through the Green field');
  assert.equal(out.accepted, true, JSON.stringify(out)); assert.equal(out.receipt.capability, 'stroll:field');
});
