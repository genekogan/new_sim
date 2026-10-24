// SOUL3 SOCIAL: a named partner far beyond here.near (sight 30 m, locate 60 m). Separates what the server perceives
// (here.near = proximity) from what it resolves by exact name (known-world identity) and from the partner's consent.
// Rows are the ACCEPT3 battery B owner texts; the server-side matrix is written to SOUL3_SOCIAL_MATRIX when set.
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {edenNavWorld} from '../test/eden-nav-fixture.ts';
import {hereFrame} from './edge/perception/here.ts';

async function apart() {
  const w = await edenNavWorld(2), [a, b] = w.souls;
  const body = (s: {entityId: string}) => (w.engine.world.entities as any)[s.entityId];
  const gap = () => Math.hypot(body(a).pose.p[0] - body(b).pose.p[0], body(a).pose.p[2] - body(b).pose.p[2]);
  const go = await Promise.all([w.act(a, 'walk:eden-north-woods'), w.act(b, 'walk:eden-gardens')]) as any[];
  await w.run(go.map((o, i) => ({soulId: w.souls[i].soulId, id: o.receipt.id})), 20 * 60 * 3);
  return {w, a, b, body, gap};
}

const ROWS: [string, (n: string) => string][] = [
  ['B2', n => 'hug ' + n], ['B3', n => 'dance with ' + n], ['B4', n => 'pick a flower and give it to ' + n],
  ['B5', n => 'high five ' + n], ['B6', n => 'wave to ' + n], ['B7', n => 'go say hi to ' + n], ['B8', n => 'follow ' + n],
  ['B10', n => 'invite ' + n + ' to read with you'], ['B12', n => 'walk with ' + n + ' to the fire'],
  ['B13', n => 'ride the balloon with ' + n], ['near', n => 'go-near ' + n], ['goto', n => 'go to ' + n], ['hi', n => 'say hi to ' + n], ['waveAt', n => 'wave at ' + n],
];

test('SOUL3 social: far named partner — perception vs resolve vs act matrix (no substitution)', {timeout: 900000}, async t => {
  const {w, a, b, gap} = await apart(); t.after(() => {w.f.host.stop(); w.f.db.close();});
  const before = gap(); assert.ok(before > 60, 'beyond server locate radius: ' + before);
  const frame: any = hereFrame(w.ledger, a);
  const inNear = (frame.near ?? []).some((n: any) => n.id === b.soulId);
  const rows: any[] = [];
  for (const [row, text] of ROWS) {
    const r: any = w.ledger.intents.dryRun(a, {capability: text(b.name)});
    rows.push({row, text: text('<B>'), ok: r.ok, ...(r.ok ? {capability: r.would?.capability, params: r.would?.params, resolved: r.would?.resolved?.slice(0, 90)} : {code: r.code, reason: String(r.reason).slice(0, 110)})});
  }
  for (const bad of ['Nobody Here', b.name + 'x']) {
    const r: any = w.ledger.intents.dryRun(a, {capability: 'hug ' + bad});
    rows.push({row: 'unknown', text: 'hug ' + (bad === b.name + 'x' ? '<B>x' : bad), ok: r.ok, code: r.code, capability: r.would?.capability});
    assert.ok(!r.ok || !String(r.would?.capability).endsWith(b.soulId), 'never substitutes b for another name: ' + JSON.stringify(r));
  }
  const out = {gap: Math.round(before), bInHereNear: inNear, nearCount: (frame.near ?? []).length, rows};
  t.diagnostic(JSON.stringify(out));
  if (process.env.SOUL3_SOCIAL_MATRIX) writeFileSync(process.env.SOUL3_SOCIAL_MATRIX, JSON.stringify(out, null, 1));
  assert.equal(inNear, false, 'proximity surface does not list a Soul 60+ m away');
});

test('SOUL3 social: far "hug B" walks over and invites, but never hugs without B accepting', {timeout: 900000}, async t => {
  const {w, a, b, body, gap} = await apart(); t.after(() => {w.f.host.stop(); w.f.db.close();});
  const before = gap();
  const out: any = await w.act(a, 'hug ' + b.name);
  assert.equal(out.accepted, true, JSON.stringify(out));
  let invited = false, hugged = false, closest = 99;
  await w.run([{soulId: a.soulId, id: out.receipt.id}], 20 * 60 * 3, () => {
    invited ||= ((w.ledger.observe(b, new Set()) as any).invites ?? []).some((i: any) => i.what === 'hug');
    hugged ||= body(a).human.activity === 'hug' || body(b).human.activity === 'hug'; closest = Math.min(closest, gap());
  });
  const r = w.ledger.receipt(a.soulId, out.receipt.id)!;
  t.diagnostic(JSON.stringify({before: Math.round(before), closest: +closest.toFixed(2), invited, hugged, phase: r.phase, code: r.code}));
  assert.ok(closest < 4, 'a physically approached b');
  assert.equal(invited, true, 'b was asked');
  assert.equal(hugged, false, 'no hug without consent');
  assert.notEqual(r.phase, 'completed', 'an unanswered invitation is not a completed hug');
  assert.deepEqual(w.f.host.engine.runtime.violations, []);
});

test('SOUL3 social: far "wave to B" keeps B as the target — walks over and waves at B, never a silent solo wave', {timeout: 900000}, async t => {
  const {w, a, b, body, gap} = await apart(); t.after(() => {w.f.host.stop(); w.f.db.close();});
  const before = gap(), bActivity = body(b).human.activity;
  const out: any = await w.act(a, 'wave to ' + b.name);
  let waveGap = 99, closest = 99, bTouched = false;
  if (out.accepted) await w.run([{soulId: a.soulId, id: out.receipt.id}], 20 * 60 * 3, () => {
    const g = gap(); closest = Math.min(closest, g); if (body(a).human.activity === 'wave') waveGap = Math.min(waveGap, g);
    bTouched ||= body(b).human.activity !== bActivity && body(b).human.activity === 'wave';
  });
  const r: any = out.accepted ? w.ledger.receipt(a.soulId, out.receipt.id) : out;
  t.diagnostic(JSON.stringify({before: Math.round(before), accepted: out.accepted, capability: r.capability, phase: r.phase, code: r.code, closest: +closest.toFixed(2), waveGap: +waveGap.toFixed(2), bTouched}));
  assert.equal(out.accepted, true, JSON.stringify(out));
  assert.equal(r.capability, 'wave:' + b.soulId, 'the wave is aimed at B, not wave:here');
  assert.equal(r.phase, 'completed', JSON.stringify(r));
  assert.ok(waveGap < 3, 'waved once near B (no wave from 100 m away): ' + waveGap);
  assert.equal(bTouched, false, 'a wave asks nothing of B and moves nothing of B');
  // a named wave never degrades to a solo wave: unknown and faded names refuse; plain wave and exact IDs still work
  const plain: any = w.ledger.intents.dryRun(a, {capability: 'wave'}); assert.equal(plain.would?.capability, 'wave:here', 'plain wave stays solo');
  const byId: any = w.ledger.intents.dryRun(a, {capability: 'wave to ' + b.soulId}); assert.equal(byId.would?.capability, 'wave:' + b.soulId, 'exact ID: ' + JSON.stringify(byId));
  const nobody: any = await w.act(a, 'wave to Nobody Here');
  (w.ledger as any).faded.add(b.soulId); const gone: any = await w.act(a, 'wave to ' + b.name); (w.ledger as any).faded.delete(b.soulId);
  t.diagnostic(JSON.stringify({nobody: {accepted: nobody.accepted, code: nobody.code ?? nobody.error?.code}, faded: {accepted: gone.accepted, code: gone.code ?? gone.error?.code}}));
  for (const r of [nobody, gone]) assert.notEqual(r.accepted, true, 'a named wave at nobody is refused, never a solo wave: ' + JSON.stringify(r));
  assert.deepEqual(w.f.host.engine.runtime.violations, []);
});

test('SOUL3 social: two far Souls share a display name — wave/hug refuse instead of choosing one', {timeout: 900000}, async t => {
  const w = await edenNavWorld(3), [a, b, c] = w.souls; t.after(() => {w.f.host.stop(); w.f.db.close();});
  const go = await Promise.all([w.act(a, 'walk:eden-north-woods'), w.act(b, 'walk:eden-gardens'), w.act(c, 'walk:eden-gardens')]) as any[];
  await w.run(go.map((o, i) => ({soulId: w.souls[i].soulId, id: o.receipt.id})), 20 * 60 * 3);
  for (const s of [b, c]) (w.f.host as any).minds.get(s.soulId).name = 'Twin Name';
  const rows = ['wave to Twin Name', 'hug Twin Name'].map(text => {const r: any = w.ledger.intents.dryRun(a, {capability: text}); return {text, ok: r.ok, capability: r.would?.capability, code: r.code};});
  t.diagnostic(JSON.stringify(rows));
  for (const r of rows) assert.ok(!r.ok || !/s_/.test(String(r.capability)), 'never picks one of two same-named Souls: ' + JSON.stringify(r));
});

test('SOUL3 social: same display name, one near and one far — gestures refuse; the exact Soul ID still works', {timeout: 900000}, async t => {
  const w = await edenNavWorld(3), [a, b, c] = w.souls; t.after(() => {w.f.host.stop(); w.f.db.close();});
  const go = await Promise.all([w.act(a, 'walk:eden-gardens'), w.act(b, 'walk:eden-gardens'), w.act(c, 'walk:eden-north-woods')]) as any[];
  await w.run(go.map((o, i) => ({soulId: w.souls[i].soulId, id: o.receipt.id})), 20 * 60 * 3);
  for (const s of [b, c]) (w.f.host as any).minds.get(s.soulId).name = 'Twin Name';
  const rows = ['wave to Twin Name', 'hug Twin Name', 'dance with Twin Name', 'high five Twin Name', 'hug ' + b.soulId].map(text => {const r: any = w.ledger.intents.dryRun(a, {capability: text}); return {text, ok: r.ok, capability: r.would?.capability, code: r.code};});
  t.diagnostic(JSON.stringify(rows));
  for (const r of rows.slice(0, 4)) assert.equal(r.code, 'soul.name-ambiguous', JSON.stringify(r));
  assert.equal(rows[4].capability, 'hug:' + b.soulId, 'an exact Soul ID is not ambiguous: ' + JSON.stringify(rows[4]));
});
