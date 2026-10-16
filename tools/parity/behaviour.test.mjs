import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFreshLocalTarget, runBehaviour, summarizeCases } from './behaviour.mjs';

const base = 'http://127.0.0.1:5901/w/parity-test';
function transport({ wrongName = false, absentEffect = false, refusal = false, noReceipt = false, wrongCapability = false, caps = [], throwCode = null } = {}) {
  const calls = [], actors = new Map();
  let serial = 0;
  const request = async (path, options = {}) => {
    calls.push({ path, options });
    if (path === '/v1/edge/map') return { places: [{ id: 'g-court', name: 'court' }] };
    if (throwCode) throw Object.assign(new Error('Do not serialize credentials from exception text: token=secret'), { code: throwCode, status: 503 });
    if (path === '/v1/admin') return { code: 'private-invite' };
    if (path === '/v1/invite') return {};
    if (path === '/v1/souls') { serial++; return { soul: { id: `s${serial}`, entityId: `body${serial}` } }; }
    if (path.endsWith('/pair') && path !== '/v1/agent/pair') return { code: 'private-pair' };
    if (path === '/v1/agent/pair') { actors.set(`secret-token-${serial}`, { serial, acted: false }); return { token: `secret-token-${serial}` }; }
    const actor = actors.get(options.token);
    if (path === '/v1/edge/capabilities') return { capabilities: caps };
    if (path === '/v1/edge/resolve') return { resolve: { ok: true, would: { capability: 'walk:court', chosen: { place: wrongName && options.body.target.place === 'Old court' ? 'g-other' : 'g-court' } } } };
    if (path === '/v1/edge/act') {
      if (refusal) return { accepted: false, code: 'route.blocked' };
      actor.acted = true; actor.capability = options.body.capability;
      return { accepted: true, ...(noReceipt ? {} : { receipt: { id: `receipt${actor.serial}`, phase: 'started' } }) };
    }
    if (path === '/v1/edge/observe') return { tick: 12, self: { entityId: `body${actor.serial}`, position: [1, 0, 1],
      state: 'standing', activity: actor.acted && !absentEffect && actor.capability.startsWith('sit:') ? 'sit' : 'idle',
      placePath: actor.acted && !absentEffect ? [{ id: 'g-court' }] : [] } };
    if (path.startsWith('/v1/edge/receipts/')) return { receipt: { id: `receipt${actor.serial}`, capability: wrongCapability ? 'sit:other-chair' : actor.capability, phase: 'completed' } };
    if (path === '/v1/world/entities/bowl') return { entity: { id: 'bowl-id', in: { parent: absentEffect ? 'table-id' : `body${serial}` } } };
    throw new Error(`Unexpected request ${path}`);
  };
  return { request, calls };
}
const input = () => ({ base, freshWorld: true, world: 'fixture', oldPlaces: [{ id: 'old-court', name: 'Old court' }],
  candidatePlaces: [{ id: 'old-court', entity: 'court' }], historyComplete: false });

test('mutation target excludes production, foreign hosts, credentials, and unasserted freshness', () => {
  assert.equal(assertFreshLocalTarget(base, true), base);
  for (const [url, fresh] of [
    ['https://sim.eden.art/worlds/w/mars', true], ['http://127.0.0.1:4963/w/mars', true],
    ['http://127.0.0.1:5910/w/mars', true], ['http://192.168.1.2:5901/w/mars', true],
    ['http://user:secret@127.0.0.1:5901/w/mars', true], [base + '?dev=1', true], [base, false],
  ]) assert.throws(() => assertFreshLocalTarget(url, fresh), /disposable/);
});

test('unmeasured data cannot vacuously qualify migration', async () => {
  const { request } = transport();
  const report = await runBehaviour({ base, freshWorld: true }, { request });
  assert.equal(report.status, 'UNKNOWN'); assert.equal(report.migrationEligible, false);
  assert.deepEqual(report.cases.map((c) => c.id), ['old-named-places', 'resident-history']);
  assert.equal(summarizeCases([]).status, 'UNKNOWN');
});

test('checks every old ID and name with a scripted resident; missing history stays UNKNOWN', async () => {
  const { request, calls } = transport();
  const report = await runBehaviour(input(), { request });
  assert.equal(report.cases.find((c) => c.kind === 'place').status, 'PASS');
  assert.equal(report.status, 'UNKNOWN');
  const queries = calls.filter((c) => c.path === '/v1/edge/resolve');
  assert.deepEqual(queries.map((c) => c.options.body.target.place), ['old-court', 'Old court']);
  assert.ok(queries.every((c) => c.options.token));
  assert.doesNotMatch(JSON.stringify(report), /secret-token|private-invite|private-pair/);
});

test('a name that resolves to a different place is FAIL, even when both resolve calls return ok', async () => {
  const { request } = transport({ wrongName: true });
  const report = await runBehaviour(input(), { request });
  assert.equal(report.cases.find((c) => c.kind === 'place').status, 'FAIL');
  assert.equal(report.status, 'FAIL'); assert.equal(report.migrationEligible, false);
});

test('uses fresh probe groups so every place is checked without overflowing per-Soul resolve limit', async () => {
  const { request, calls } = transport();
  const report = await runBehaviour({ ...input(), oldPlaces: Array.from({ length: 83 }, (_, i) => ({ id: `old-${i}`, name: `Old ${i}` })),
    candidatePlaces: Array.from({ length: 83 }, (_, i) => ({ id: `old-${i}`, entity: 'court' })) }, { request });
  assert.equal(report.cases.filter((c) => c.kind === 'place').length, 83);
  const groups = new Map();
  for (const c of calls.filter((c) => c.path === '/v1/edge/resolve')) groups.set(c.options.token, 1 + (groups.get(c.options.token) ?? 0));
  assert.deepEqual([...groups.values()], [80, 80, 6]);
});

test('fixture success measures sit/enter/use mechanisms but does not replace missing resident history', async () => {
  const { request } = transport();
  const fixtures = [
    { id: 'enter', kind: 'enter', capability: 'walk:court', expect: { place: 'court' } },
    { id: 'sit', kind: 'sit', capability: 'sit:chair' },
    { id: 'use', kind: 'use', capability: 'pick-up:bowl', expect: { entityParent: { entity: 'bowl', parent: '$resident' } } },
  ];
  const report = await runBehaviour({ ...input(), fixtures }, { request });
  assert.deepEqual(report.cases.filter((c) => c.kind === 'fixture').map((c) => c.status), ['PASS', 'PASS', 'PASS']);
  assert.equal(report.status, 'UNKNOWN'); assert.equal(report.migrationEligible, false);
});

test('every sourced resident gets an independent replay; missing resident or missing last action blocks', async () => {
  const { request } = transport();
  const report = await runBehaviour({ ...input(), historyComplete: true, historySource: 'owner-export:example', residentRoster: ['old-a', 'old-b'],
    residents: [{ id: 'old-a', lastActivity: { kind: 'sit', capability: 'sit:chair' } }, { id: 'old-b' }] }, { request });
  assert.deepEqual(report.cases.filter((c) => c.kind === 'history').map((c) => c.status), ['PASS', 'UNKNOWN']);
  assert.equal(report.migrationEligible, false);
  const mismatch = await runBehaviour({ ...input(), historyComplete: true, historySource: 'owner-export:example', residentRoster: ['missing'], residents: [] }, { request });
  assert.equal(mismatch.cases.find((c) => c.id === 'resident-history').status, 'FAIL');
});

test('complete activity input cannot falsely qualify unverified historical body-state reconstruction', async () => {
  const { request } = transport();
  const report = await runBehaviour({ ...input(), historyComplete: true, historySource: 'owner-export:example', residentRoster: ['old-a'],
    residents: [{ id: 'old-a', initialBodyState: { family: 'floater', position: [5, 1.45, 9], state: 'hovering' },
      lastActivity: { kind: 'enter', capability: 'walk:court', expect: { place: 'court' } } }] }, { request });
  assert.equal(report.cases.find((c) => c.kind === 'history').status, 'PASS');
  assert.equal(report.cases.find((c) => c.kind === 'history-state').status, 'UNKNOWN');
  assert.equal(report.status, 'UNKNOWN'); assert.equal(report.migrationEligible, false);
});

test('a sourced explicitly empty roster has no historical body-state obligation', async () => {
  const { request } = transport();
  const report = await runBehaviour({ ...input(), historyComplete: true, historySource: 'owner-export:empty-fixture', residentRoster: [], residents: [] }, { request });
  assert.equal(report.status, 'PASS'); assert.equal(report.migrationEligible, true);
});

test('accepted/completed activity without its observed effect is FAIL', async () => {
  const { request } = transport({ absentEffect: true });
  const report = await runBehaviour({ ...input(), fixtures: [{ id: 'use', kind: 'use', capability: 'pick-up:bowl', expect: { entityParent: { entity: 'bowl', parent: '$resident' } } }] }, { request });
  const c = report.cases.find((c) => c.kind === 'fixture');
  assert.equal(c.status, 'FAIL'); assert.match(c.reason, /expected effect was absent/);
});

test('sitting at a different target cannot qualify the historical last activity', async () => {
  const source = { ...input(), historyComplete: true, historySource: 'owner-export:example', residentRoster: ['old-a'],
    residents: [{ id: 'old-a', lastActivity: { kind: 'sit', capability: 'sit:chair' } }] };
  const wrong = await runBehaviour(source, transport({ wrongCapability: true }));
  assert.equal(wrong.cases.find((c) => c.kind === 'history').status, 'FAIL');
  source.residents[0].lastActivity.capability = 'sit on the chair';
  const unbound = await runBehaviour(source, transport());
  assert.equal(unbound.cases.find((c) => c.kind === 'history').status, 'UNKNOWN');
});

test('refusals fail; missing receipts and unobservable/unsupported histories stay UNKNOWN', async () => {
  const action = { kind: 'sit', capability: 'sit:chair' };
  const refused = await runBehaviour({ ...input(), fixtures: [action] }, transport({ refusal: true }));
  assert.equal(refused.cases.find((c) => c.kind === 'fixture').status, 'FAIL');
  const missing = await runBehaviour({ ...input(), fixtures: [action] }, transport({ noReceipt: true }));
  assert.equal(missing.cases.find((c) => c.kind === 'fixture').status, 'UNKNOWN');
  const unknown = await runBehaviour({ ...input(), fixtures: [{ kind: 'use', capability: 'use:thing' }, { kind: 'sleep', capability: 'sleep:bed' }] }, transport());
  assert.deepEqual(unknown.cases.filter((c) => c.kind === 'fixture').map((c) => c.status), ['UNKNOWN', 'UNKNOWN']);
});

test('request failures are UNKNOWN and do not serialize token-bearing exception text', async () => {
  const { request } = transport({ throwCode: 'unreachable' });
  const report = await runBehaviour(input(), { request });
  assert.equal(report.cases.find((c) => c.kind === 'place').status, 'UNKNOWN');
  assert.doesNotMatch(JSON.stringify(report), /secret|credentials/);
});

test('fixture patterns select canonical capabilities deterministically and bind observable target effects', async () => {
  const caps = [{ id: 'sit:z-chair', verb: 'sit', label: 'honey sofa right' }, { id: 'sit:a-chair', verb: 'sit', label: 'honey sofa left' },
    { id: 'pick-up:bowl', verb: 'pick-up', label: 'mixing bowl', target: { id: 'bowl', kind: 'object' } }];
  const report = await runBehaviour({ ...input(), fixtures: [
    { id: 'sit', kind: 'sit', capabilityPattern: { verb: 'sit', match: 'honey.sofa', index: 0 } },
    { id: 'use', kind: 'use', capabilityPattern: { verb: 'pick-up', match: 'bowl' }, expect: { entityParent: { entity: '$target', parent: '$resident' } } },
  ] }, transport({ caps }));
  const cases = report.cases.filter((c) => c.kind === 'fixture');
  assert.deepEqual(cases.map((c) => c.status), ['PASS', 'PASS']);
  assert.equal(cases[0].evidence.selection.chosen.id, 'sit:a-chair');
  assert.equal(cases[1].evidence.effect.entityParent.entity, 'bowl');
});

test('zero/ambiguous fixture matches and historical pattern substitutions stay UNKNOWN', async () => {
  const caps = [{ id: 'sit:a', verb: 'sit', label: 'sofa' }, { id: 'sit:b', verb: 'sit', label: 'sofa' }];
  const report = await runBehaviour({ ...input(), fixtures: [
    { id: 'zero', kind: 'sit', capabilityPattern: { match: 'not-found' } },
    { id: 'many', kind: 'sit', capabilityPattern: { match: 'sofa' } },
    { id: 'range', kind: 'sit', capabilityPattern: { match: 'sofa', index: 3 } },
  ], residents: [{ id: 'historical', lastActivity: { kind: 'sit', capabilityPattern: { match: 'sofa', index: 0 } } }] }, transport({ caps }));
  assert.deepEqual(report.cases.filter((c) => c.kind === 'fixture' || c.kind === 'history').map((c) => c.status), ['UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
});

test('walking to a room does not prove use, and entering must name its destination', async () => {
  const { request, calls } = transport();
  const report = await runBehaviour({ ...input(), fixtures: [
    { kind: 'use', capability: 'walk:court', expect: { place: 'court' } },
    { kind: 'enter', capability: 'walk:court', expect: { activity: 'idle' } },
    { kind: 'sit', capability: 'pick-up:bowl', expect: { activity: 'sit' } },
  ] }, { request });
  assert.deepEqual(report.cases.filter((c) => c.kind === 'fixture').map((c) => c.status), ['UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
  assert.equal(calls.filter((c) => c.path === '/v1/edge/act').length, 0);
});
