// GOVERN (lane C17): constitution versions, amendments (propose, support, the god decides), the residents-decide
// switch, "changed since your last visit" for residents, and prayers' answered/waiting state. Real GodMode + routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono, type Context } from 'hono';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode } from './god.ts';
import { mountGodRoutes } from './routes.ts';
import { governanceOf } from './governance.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
const SOULS: Record<string, { id: string; name: string }> = { 'sim_ada': { id: 's_ada', name: 'Ada' }, 'sim_ben': { id: 's_ben', name: 'Ben' }, 'sim_cy': { id: 's_cy', name: 'Cy' } };

function fixture() {
  const db = new Db(':memory:');
  let tick = 100;
  const god = new GodMode(db, { worldId: 'gov-1', ownerId: 'dev:gene', tick: () => tick++, emit: () => {}, library: null });
  const app = new Hono();
  mountGodRoutes(app, {
    god, worldName: 'Gov',
    requireUser: async (c: Context) => { if (c.req.header('authorization') !== 'Bearer dev:gene') throw new ApiError(401, 'unauthorized', 'sign in'); return { id: 'dev:gene', role: 'user', email: null, wallet: null, created_at: 0, last_seen: 0, invited_by: null } as never; },
    soulFromBearer: (c) => SOULS[c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? ''] ?? null,
    baseOf: () => 'http://localhost:6130/w/gov', limitIp: () => {},
  });
  app.onError((err, c) => err instanceof ApiError ? c.json({ ok: false, code: err.code, message: err.message }, err.status as 400) : c.json({ ok: false, code: 'internal', message: String(err) }, 500));
  const delivered: { soulId: string; kind: string; body: any }[] = [];
  let residents = Object.values(SOULS);
  governanceOf(god, { residents: () => residents, deliver: (soulId, kind, body) => delivered.push({ soulId, kind, body }) });
  const token = god.mintFor({ id: 'dev:gene', role: 'user' }, 'test');
  const req = async (path: string, init: { method?: string; body?: unknown; token?: string } = {}) => {
    const r = await app.request(path, { method: init.method ?? (init.body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
    const text = await r.text(); let data: any; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
  const setConstitution = (text: string) => { const r = god.act({ ops: [{ op: 'world', state: { constitution: text } }] }, 'constitution'); assert.equal(r.accepted, true, JSON.stringify(r)); };
  return { god, req, token, delivered, setConstitution, setResidents: (r: typeof residents) => { residents = r; } };
}

test('every constitution change is a numbered version (god edits, undo); the public view shows it short and versioned', async () => {
  const f = fixture();
  assert.equal((await f.req('/v1/world/governance')).data.constitution.version, 0, 'no constitution yet');
  f.setConstitution('# Test Hill\n\nBe kind. Build slowly.');
  f.setConstitution('# Test Hill\n\nBe kind. Build slowly.\n\nQuiet after dark.');
  assert.equal(f.god.undo().accepted, true);
  const g = (await f.req('/v1/world/governance')).data;
  assert.equal(g.contract, 'governance/1');
  assert.equal(g.constitution.version, 3);
  assert.equal(g.constitution.text, '# Test Hill\n\nBe kind. Build slowly.');
  assert.deepEqual(g.history.map((h: any) => h.version), [3, 2, 1]);
  assert.deepEqual(g.history.map((h: any) => h.note), ['the god undid an edit', 'constitution', 'constitution'], "a version carries the god's own edit note");
  assert.equal((await f.req('/v1/world/constitution/versions/2')).data.text.includes('Quiet after dark'), true);
  assert.equal((await f.req('/v1/world/constitution/versions/9')).status, 404);
  // an edit that leaves the text alone is not a version
  assert.equal(f.god.act({ ops: [{ op: 'world', state: { sky: { sun: 0.3 } } }] }).accepted, true);
  assert.equal((await f.req('/v1/world/governance')).data.constitution.version, 3);
  assert.equal(g.residentsDecide, false, 'residents-decide is off by default');
});

test('a resident proposes, others support, the god sees support counts and decides: decline needs a reason, accept makes a new version', async () => {
  const f = fixture();
  f.setConstitution('# Test Hill\n\nBe kind.');
  assert.equal((await f.req('/v1/world/amendments', { body: { text: 'x' } })).status, 401, 'only a Soul proposes');
  const p = await f.req('/v1/world/amendments', { body: { text: 'Every resident may plant one tree in the commons.', title: 'Trees' }, token: 'sim_ada' });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  const id = p.data.amendment.id;
  assert.equal(p.data.amendment.support, 1, 'the proposer supports it');
  assert.equal((await f.req(`/v1/world/amendments/${id}/support`, { method: 'POST', token: 'sim_ben' })).data.amendment.support, 2);
  assert.equal((await f.req(`/v1/world/amendments/${id}/support`, { method: 'POST', token: 'sim_ben' })).data.amendment.support, 2, 'support is once per Soul');
  // the public sees the proposal and its support (names, not ids)
  const pub = (await f.req('/v1/world/governance')).data;
  assert.deepEqual(pub.amendments.map((a: any) => [a.title, a.support, a.status]), [['Trees', 2, 'open']]);
  assert.deepEqual(pub.amendments[0].supporters, ['Ada', 'Ben']);
  assert.equal(JSON.stringify(pub).includes('s_ada'), false);
  // the god's view, then a decision
  assert.equal((await f.req('/v1/god/amendments')).status, 401);
  const gv = (await f.req('/v1/god/amendments', { token: f.token })).data;
  assert.equal(gv.amendments[0].support, 2);
  assert.equal(gv.residents, 3);
  assert.equal((await f.req(`/v1/god/amendments/${id}/decide`, { body: { decision: 'decline' }, token: f.token })).status, 400, 'declining needs a reason');
  const second = (await f.req('/v1/world/amendments', { body: { text: 'No building after midnight.' }, token: 'sim_cy' })).data.amendment.id;
  const dec = await f.req(`/v1/god/amendments/${second}/decide`, { body: { decision: 'decline', reason: 'Night builders are welcome here.' }, token: f.token });
  assert.equal(dec.data.amendment.status, 'declined');
  assert.equal(dec.data.amendment.decided.reason, 'Night builders are welcome here.');
  assert.ok(f.delivered.some((e) => e.soulId === 's_cy' && e.kind === 'amendment.declined' && /Night builders/.test(e.body.text)));
  const acc = await f.req(`/v1/god/amendments/${id}/decide`, { body: { decision: 'accept' }, token: f.token });
  assert.equal(acc.status, 200, JSON.stringify(acc.data));
  assert.equal(acc.data.version, 2);
  assert.match(String(f.god.model.state.constitution), /## Amendment 1: Trees\n\nEvery resident may plant one tree/);
  assert.ok(f.delivered.filter((e) => e.kind === 'amendment.accepted').map((e) => e.soulId).sort().join() === 's_ada,s_ben', 'proposer and supporters hear of it');
  const v2 = (await f.req('/v1/world/governance')).data;
  assert.equal(v2.history[0].note, 'accepted amendment “Trees” (Ada)');
  assert.equal(v2.history[0].amendment, id);
  assert.equal((await f.req(`/v1/god/amendments/${id}/decide`, { body: { decision: 'accept' }, token: f.token })).status, 409, 'decided once');
  assert.equal((await f.req(`/v1/world/amendments/${id}/support`, { method: 'POST', token: 'sim_cy' })).status, 409, 'a decided amendment takes no support');
  // the god's acceptance is an ordinary god edit: undoable, and the undo is the next version
  assert.equal(f.god.undo().accepted, true);
  assert.equal((await f.req('/v1/world/governance')).data.constitution.version, 3);
  assert.equal(String(f.god.model.state.constitution), '# Test Hill\n\nBe kind.');
});

test('the god may accept in its own words; a whole-text proposal replaces the text; proposers withdraw their own only', async () => {
  const f = fixture();
  f.setConstitution('Old rules.');
  const a = (await f.req('/v1/world/amendments', { body: { text: 'Shorter rules please.' }, token: 'sim_ada' })).data.amendment.id;
  assert.equal((await f.req(`/v1/god/amendments/${a}/decide`, { body: { decision: 'accept', text: 'Be kind.' }, token: f.token })).data.version, 2);
  assert.equal(f.god.model.state.constitution, 'Be kind.');
  const b = (await f.req('/v1/world/amendments', { body: { full: '# New\n\nShare everything.' }, token: 'sim_ben' })).data.amendment;
  assert.equal(b.replacesWholeText, true);
  assert.equal((await f.req(`/v1/world/amendments/${b.id}/withdraw`, { method: 'POST', token: 'sim_ada' })).status, 403);
  assert.equal((await f.req(`/v1/god/amendments/${b.id}/decide`, { body: { decision: 'accept' }, token: f.token })).data.version, 3);
  assert.equal(f.god.model.state.constitution, '# New\n\nShare everything.');
  const c = (await f.req('/v1/world/amendments', { body: { text: 'Drop the sharing rule.' }, token: 'sim_cy' })).data.amendment.id;
  assert.equal((await f.req(`/v1/world/amendments/${c}/withdraw`, { method: 'POST', token: 'sim_cy' })).data.amendment.status, 'withdrawn');
  // at most three waiting per Soul
  for (let i = 0; i < 3; i++) assert.equal((await f.req('/v1/world/amendments', { body: { text: `idea ${i}` }, token: 'sim_cy' })).status, 200);
  assert.equal((await f.req('/v1/world/amendments', { body: { text: 'one more' }, token: 'sim_cy' })).status, 429);
  assert.equal((await f.req('/v1/world/amendments', { body: { text: 'x'.repeat(1501) }, token: 'sim_ada' })).status, 400);
});

test('residents-decide (opt-in): a majority of the active residents, at least two, accepts an amendment by itself', async () => {
  const f = fixture();
  f.setConstitution('Be kind.');
  const id = (await f.req('/v1/world/amendments', { body: { text: 'Sing at dawn.' }, token: 'sim_ada' })).data.amendment.id;
  await f.req(`/v1/world/amendments/${id}/support`, { method: 'POST', token: 'sim_ben' });
  assert.equal((await f.req('/v1/world/governance')).data.amendments[0].status, 'open', 'off by default: two of three wait for the god');
  assert.equal((await f.req('/v1/god/governance', { body: { residentsDecide: true } })).status, 401, 'only the god switches it');
  const on = await f.req('/v1/god/governance', { body: { residentsDecide: true }, token: f.token });
  assert.equal(on.data.residentsDecide, true);
  const pub = (await f.req('/v1/world/governance')).data;
  assert.equal(pub.amendments.find((a: any) => a.id === id).status, 'accepted', 'switching it on decides what already has a majority');
  assert.equal(pub.amendments.find((a: any) => a.id === id).decided.by, 'residents');
  assert.equal(pub.history[0].by, 'residents');
  assert.match(String(f.god.model.state.constitution), /Sing at dawn/);
  // a resident alone is never a majority; faded / absent Souls do not count
  f.setResidents([SOULS.sim_ada]);
  const solo = (await f.req('/v1/world/amendments', { body: { text: 'Ada rules.' }, token: 'sim_ada' })).data.amendment;
  assert.equal(solo.status, 'open');
  f.setResidents(Object.values(SOULS));
  const lone = (await f.req('/v1/world/amendments', { body: { text: 'Cy rules.' }, token: 'sim_cy' })).data.amendment;
  assert.equal(lone.status, 'open', 'one of three is not a majority');
  assert.equal((await f.req(`/v1/world/amendments/${lone.id}/support`, { method: 'POST', token: 'sim_ben' })).data.amendment.status, 'accepted');
});

test('a resident sees "changed since your last visit" once, with the text it last read', async () => {
  const f = fixture();
  f.setConstitution('Version one.');
  const first = (await f.req('/v1/world/governance/me', { token: 'sim_ada' })).data;
  assert.equal(first.version, 1);
  assert.equal(first.changedSinceLastVisit, false, 'a first read is not a change');
  f.setConstitution('Version two.');
  const second = (await f.req('/v1/world/governance/me', { token: 'sim_ada' })).data;
  assert.equal(second.changedSinceLastVisit, true);
  assert.equal(second.lastSeenVersion, 1);
  assert.equal(second.before, 'Version one.');
  assert.equal(second.constitution, 'Version two.');
  assert.equal((await f.req('/v1/world/governance/me', { token: 'sim_ada' })).data.changedSinceLastVisit, false);
  assert.equal((await f.req('/v1/world/governance/me')).status, 401);
});

test('prayers have a visible answered / waiting state; the Soul hears the answer; the public sees counts only', async () => {
  const f = fixture();
  const p = (await f.req('/v1/god/pray', { body: { text: 'Please send rain to my garden.' }, token: 'sim_ada' })).data.prayer;
  await f.req('/v1/god/pray', { body: { text: 'A bench by the pond?' }, token: 'sim_ben' });
  let pub = (await f.req('/v1/world/governance')).data;
  assert.deepEqual(pub.prayers, { total: 2, answered: 0, waiting: 2 });
  assert.equal(JSON.stringify(pub).includes('rain'), false, 'prayers stay between the Soul and the god');
  assert.deepEqual((await f.req('/v1/world/governance/me', { token: 'sim_ada' })).data.prayers.map((x: any) => x.state), ['waiting']);
  assert.equal((await f.req('/v1/god/answer', { body: { prayer: p.id, text: 'Rain comes at dusk.' }, token: f.token })).status, 200);
  pub = (await f.req('/v1/world/governance')).data;
  assert.deepEqual(pub.prayers, { total: 2, answered: 1, waiting: 1 });
  const mine = (await f.req('/v1/world/governance/me', { token: 'sim_ada' })).data.prayers[0];
  assert.equal(mine.state, 'answered');
  assert.equal(mine.answer, 'Rain comes at dusk.');
  const ev = f.delivered.find((e) => e.kind === 'prayer.answered');
  assert.equal(ev?.soulId, 's_ada');
  assert.match(ev!.body.text, /Rain comes at dusk/);
  assert.equal(ev!.body.untrusted, true);
});
