#!/usr/bin/env node
// A gate, not an engine migration: only disposable local worlds may be acted on.
// node tools/parity/behaviour.mjs --input input.json --base http://127.0.0.1:5901/w/example --out report.json
// Input: {freshWorld:true, oldPlaces:[{id,name}], candidatePlaces:[{id,entity}],
//   residents:[{id,name,lastActivity:{kind:'sit'|'enter'|'use',capability,params,expect,setup:[]}}],
//   historyComplete:false, historySource:null, residentRoster:null,
//   fixtures:[{id,kind,capability,params,expect,setup:[]}]}
// Fixtures may select capabilityPattern:{verb?,match,index?}; multiple matches need explicit sorted index.
// expect.entityParent.entity:'$target' uses the selected capability's target entity.
// Full historical coverage needs a source reference AND an explicit complete roster.
// Fixture success proves mechanisms only and never replaces historical evidence.
// Initial historical body/pose/posture/carried state is not reconstructed by this first gate.
// Every nonempty historical roster therefore retains an explicit UNKNOWN state-restoration case.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const STATUS = ['PASS', 'FAIL', 'UNKNOWN'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const nonempty = (x) => typeof x === 'string' && x.trim().length > 0;
const godPlaceId = (ref) => `g-${ref.toLowerCase().replace(/\//g, '.').replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '')}`.slice(0, 100);
const entityRef = (ref) => ref?.startsWith('flag:') ? `flag-${ref.slice(5)}` : ref;

export function assertFreshLocalTarget(base, freshWorld) {
  const u = new URL(base);
  if (freshWorld !== true || u.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(u.hostname)
      || !/^59\d\d$/.test(u.port) || Number(u.port) < 5900 || Number(u.port) > 5909
      || u.username || u.password || u.search || u.hash || !/^\/w\/[a-z][a-z0-9-]{0,31}\/?$/.test(u.pathname)) {
    throw new Error('Behaviour actions require freshWorld:true and an http://127.0.0.1:5900–5909/w/<slug> disposable fake-mind world.');
  }
  return u.href.replace(/\/$/, '');
}

export function summarizeCases(cases) {
  const counts = Object.fromEntries(STATUS.map((s) => [s, cases.filter((c) => c.status === s).length]));
  const status = counts.FAIL ? 'FAIL' : counts.UNKNOWN || !cases.length ? 'UNKNOWN' : 'PASS';
  return { status, migrationEligible: status === 'PASS', counts };
}

function safeObservation(o) {
  const me = o?.self;
  return me ? { tick: o.tick, activity: me.activity, state: me.state, position: me.position,
    placePath: (me.placePath ?? []).map((p) => typeof p === 'string' ? p : p.id) } : null;
}

function errorEvidence(error) {
  return { code: error?.code ?? 'harness.request', status: error?.status ?? null };
}

// Injectable transport lets focused tests exercise real verdict logic without binding any port.
export async function runBehaviour(input, options = {}) {
  const base = assertFreshLocalTarget(input.base ?? options.base, input.freshWorld);
  const sleep = options.sleep ?? wait, now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 45_000, pollMs = options.pollMs ?? 500;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const request = options.request ?? (async (path, { body, token, identity } = {}) => {
    const response = await fetchImpl(base + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : identity ? { authorization: `Bearer dev:${identity}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000), redirect: 'error' });
    let data; try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status, code: data.error?.code ?? data.code ?? 'http.error' });
    return data;
  });
  const cases = [];
  const add = (kind, id, status, reason, evidence = {}) => cases.push({ kind, id, status, reason, evidence });
  let serial = 0;
  async function createResident(label) {
    const owner = `parity-${now().toString(36)}-${++serial}`;
    const inv = await request('/v1/admin', { identity: 'admin', body: { action: 'invite', uses: 1 } });
    if (!inv.code) throw Object.assign(new Error('Invite missing'), { code: 'fixture.invite-missing' });
    await request('/v1/invite', { identity: owner, body: { code: inv.code } });
    const born = await request('/v1/souls', { identity: owner, body: { name: `Parity ${serial}: ${label}`.slice(0, 80), description: 'Disposable scripted parity probe; no LLM.' } });
    if (!born.soul?.id) throw Object.assign(new Error('Soul missing'), { code: 'fixture.soul-missing' });
    const pair = await request(`/v1/souls/${encodeURIComponent(born.soul.id)}/pair`, { identity: owner, body: {} });
    const exchange = await request('/v1/agent/pair', { body: { code: pair.code, agent: 'parity-scripted-probe' } });
    if (!exchange.token) throw Object.assign(new Error('Pair missing'), { code: 'fixture.pair-missing' });
    const actor = { token: exchange.token, soulId: born.soul.id, entityId: born.soul.entityId };
    const t0 = now();
    do {
      const o = await request('/v1/edge/observe', actor);
      if (o.self?.position) return { ...actor, entityId: o.self.entityId ?? actor.entityId };
      await sleep(pollMs);
    } while (now() - t0 < timeoutMs);
    throw Object.assign(new Error('Body missing'), { code: 'fixture.body-timeout' });
  }

  let runtimePlaces = [];
  try { runtimePlaces = (await request('/v1/edge/map')).places ?? []; }
  catch (error) { add('coverage', 'candidate-map', 'UNKNOWN', 'Candidate map could not be read.', errorEvidence(error)); }
  const oldPlaces = Array.isArray(input.oldPlaces) ? input.oldPlaces : [];
  if (!oldPlaces.length) add('coverage', 'old-named-places', 'UNKNOWN', 'The complete old-world named-place input was not supplied.');
  const oldIds = new Set();
  let probe = null;
  for (let i = 0; i < oldPlaces.length; i++) {
    const old = oldPlaces[i];
    if (!nonempty(old?.id) || !nonempty(old?.name) || oldIds.has(old.id)) {
      add('place', old?.id ?? `invalid-${i}`, 'UNKNOWN', 'Old-place identity is missing or duplicated.'); continue;
    }
    oldIds.add(old.id);
    const mapped = (input.candidatePlaces ?? []).filter((p) => p.id === old.id);
    if (mapped.length > 1) { add('place', old.id, 'FAIL', 'Candidate mapping repeats an old-place identity.'); continue; }
    const ref = entityRef(mapped[0]?.entity);
    const expectedIds = new Set([old.id, ...(ref ? [ref, godPlaceId(ref)] : [])]);
    const targetMap = runtimePlaces.filter((p) => expectedIds.has(p.id) || (ref ? p.name === ref : p.name === old.name));
    for (const p of targetMap) expectedIds.add(p.id);
    try {
      // The /resolve limit is120/min per Soul. At most80 queries per probe; no sleeps or hidden truncation.
      if (i % 40 === 0 || !probe) probe = await createResident(`place group ${Math.floor(i / 40) + 1}`);
      const checks = [];
      for (const [by, value] of [['id', old.id], ['name', old.name]]) {
        const data = await request('/v1/edge/resolve', { ...probe, body: { verb: 'go', target: { place: value } } });
        const r = data.resolve;
        const chosen = r?.would?.chosen?.place;
        const cap = r?.would?.capability;
        checks.push({ by, input: value, ok: r?.ok === true && r?.would?.available !== false && expectedIds.has(chosen),
          resolved: chosen ?? null, capability: cap ?? null, code: r?.code ?? r?.would?.blocked?.code ?? null });
      }
      const status = checks.every((c) => c.ok) && checks[0].resolved === checks[1].resolved ? 'PASS' : 'FAIL';
      add('place', old.id, status, status === 'PASS' ? 'Old ID and exact old name resolve to the same intended candidate place.' : 'An old ID/name is refused, unavailable, ambiguous, or resolves to a different place.',
        { oldName: old.name, candidateRef: ref ?? null, checks, probe: probe.soulId });
    } catch (error) { add('place', old.id, 'UNKNOWN', 'Runtime resolution could not be measured.', errorEvidence(error)); }
  }

  const roster = input.residentRoster, residents = input.residents ?? [];
  const supplied = new Set(residents.map((r) => r.id));
  if (input.historyComplete !== true || !nonempty(input.historySource) || !Array.isArray(roster)) {
    add('coverage', 'resident-history', 'UNKNOWN', 'Complete historical resident roster and sourced last activities are unavailable. Fresh fixtures cannot qualify resident migration.');
  } else {
    const missing = roster.filter((id) => !supplied.has(id));
    const extra = [...supplied].filter((id) => !roster.includes(id));
    const duplicates = supplied.size !== residents.length || new Set(roster).size !== roster.length;
    add('coverage', 'resident-history', missing.length || extra.length || duplicates ? 'FAIL' : 'PASS',
      missing.length || extra.length || duplicates ? 'Historical roster and replay inputs do not match.' : 'Explicit sourced roster is fully represented in replay inputs.',
      { source: input.historySource, expected: roster.length, supplied: residents.length, missing, extra, duplicates });
  }

  function expectation(action) {
    if (action.expect && Object.keys(action.expect).some((k) => ['activity', 'place', 'state', 'entityParent'].includes(k))) return action.expect;
    if (action.kind === 'sit') return { activity: 'sit' };
    return null;
  }
  async function verify(expect, actor, observation) {
    const evidence = {}, mismatches = [];
    if (expect.activity !== undefined) { evidence.activity = observation.self?.activity; if (evidence.activity !== expect.activity) mismatches.push('activity'); }
    if (expect.state !== undefined) { evidence.state = observation.self?.state; if (evidence.state !== expect.state) mismatches.push('state'); }
    if (expect.place !== undefined) {
      const path = (observation.self?.placePath ?? []).map((p) => typeof p === 'string' ? p : p.id);
      evidence.placePath = path;
      if (!path.includes(expect.place) && !path.includes(godPlaceId(expect.place))) mismatches.push('place');
    }
    if (expect.entityParent) {
      const { entity, parent } = expect.entityParent;
      const data = await request(`/v1/world/entities/${encodeURIComponent(entity)}`);
      evidence.entityParent = { entity, actual: data.entity?.in?.parent ?? null };
      let expectedParent = parent === '$resident' ? actor.entityId : parent;
      if (parent !== '$resident' && parent !== 'world' && nonempty(parent)) {
        expectedParent = (await request(`/v1/world/entities/${encodeURIComponent(parent)}`)).entity?.id ?? parent;
      }
      if (!expectedParent || evidence.entityParent.actual !== expectedParent) mismatches.push('entityParent');
    }
    return { ok: !mismatches.length, mismatches, evidence };
  }
  async function replayDirect(action, actor, historical = false) {
    const expect = expectation(action);
    if (!['sit', 'enter', 'use'].includes(action.kind) || !nonempty(action.capability) || !expect) {
      return { status: 'UNKNOWN', reason: 'Activity needs kind sit/enter/use, an explicit capability, and an observable expected effect (sit defaults to seated activity).' };
    }
    const expectedCapability = action.expect?.capability ?? (/^[a-z][a-z-]*:[^\s]+$/.test(action.capability) ? action.capability : null);
    const claimedVerb = expectedCapability?.split(':')[0];
    if (action.kind === 'enter' && expect.place === undefined) return { status: 'UNKNOWN', reason: 'Entering needs an explicit expected destination place.' };
    if (claimedVerb && (action.kind === 'sit' && claimedVerb !== 'sit'
      || action.kind === 'enter' && !['walk', 'go', 'glide'].includes(claimedVerb)
      || action.kind === 'use' && ['walk', 'go', 'glide', 'sit', 'stand', 'rest', 'wander', 'stroll', 'hang-out'].includes(claimedVerb))) {
      return { status: 'UNKNOWN', reason: 'The supplied capability does not demonstrate the claimed sit/enter/use activity kind.' };
    }
    if (historical && action.kind === 'sit' && !expectedCapability) {
      return { status: 'UNKNOWN', reason: 'Historical sitting needs an exact sit:<seat> capability or expect.capability; sitting in any seat is insufficient.' };
    }
    const started = now();
    const act = await request('/v1/edge/act', { ...actor, body: { capability: action.capability, ...(action.params ? { params: action.params } : {}) } });
    if (act.accepted !== true) return { status: 'FAIL', reason: 'Scripted activity was refused.', evidence: { code: act.code ?? null, capability: action.capability } };
    let receipt = act.receipt, observation, effect;
    if (!receipt?.id) return { status: 'UNKNOWN', reason: 'Activity acceptance had no auditable receipt.' };
    do {
      observation = await request('/v1/edge/observe', actor);
      receipt = (await request(`/v1/edge/receipts/${encodeURIComponent(receipt.id)}`, actor)).receipt ?? receipt;
      effect = await verify(expect, actor, observation);
      const actualCapability = receipt.capability ?? act.resolved?.to;
      const actualVerb = actualCapability?.split(':')[0];
      if (actualVerb && (action.kind === 'sit' && actualVerb !== 'sit'
        || action.kind === 'enter' && !['walk', 'go', 'glide'].includes(actualVerb)
        || action.kind === 'use' && ['walk', 'go', 'glide', 'sit', 'stand', 'rest', 'wander', 'stroll', 'hang-out'].includes(actualVerb))) return {
          status: 'FAIL', reason: 'The actual receipt capability does not demonstrate the claimed sit/enter/use activity kind.', evidence: { capability: actualCapability, receipt: receipt.id } };
      if (expectedCapability && actualCapability !== expectedCapability) return { status: actualCapability ? 'FAIL' : 'UNKNOWN',
        reason: actualCapability ? 'Activity resolved to a different capability/target.' : 'Receipt did not identify the actual capability/target.',
        evidence: { expectedCapability, actualCapability: actualCapability ?? null, receipt: receipt.id } };
      if (['failed', 'replaced'].includes(receipt.phase)) return { status: 'FAIL', reason: 'Scripted activity did not complete.', evidence: { capability: action.capability, receipt: receipt.id, phase: receipt.phase, code: receipt.code ?? null, observation: safeObservation(observation) } };
      // Enter/use need a terminal receipt AND the observed effect; sitting may hold its receipt open for its duration.
      if (effect.ok && (action.kind === 'sit' || receipt.phase === 'completed')) return { status: 'PASS', reason: 'Scripted resident reproduced the activity with the expected observable effect.', evidence: { capability: action.capability, receipt: receipt.id, phase: receipt.phase, elapsedMs: now() - started, effect: effect.evidence, observation: safeObservation(observation) } };
      if (receipt.phase === 'completed') return { status: 'FAIL', reason: 'Receipt completed but the expected effect was absent.', evidence: { capability: action.capability, receipt: receipt.id, phase: receipt.phase, mismatches: effect.mismatches, effect: effect.evidence, observation: safeObservation(observation) } };
      await sleep(pollMs);
    } while (now() - started < (action.timeoutMs ?? timeoutMs));
    return { status: 'UNKNOWN', reason: 'Bounded replay timed out before proof of completion/effect.', evidence: { capability: action.capability, receipt: receipt.id, phase: receipt.phase, elapsedMs: now() - started, observation: safeObservation(observation) } };
  }
  async function replay(action, actor, historical = false) {
    if (!action.capabilityPattern) return replayDirect(action, actor, historical);
    if (historical) return { status: 'UNKNOWN', reason: 'Historical replay requires its explicit activity target; capability patterns are fixture-only.' };
    const pattern = action.capabilityPattern;
    if (!nonempty(pattern.match) || pattern.match.length > 1024 || !expectation(action)) return { status: 'UNKNOWN', reason: 'Fixture pattern needs a bounded regex and an observable expected effect.' };
    let regex; try { regex = new RegExp(pattern.match, 'i'); } catch { return { status: 'UNKNOWN', reason: 'Fixture capability regex is invalid.' }; }
    const caps = (await request('/v1/edge/capabilities', actor)).capabilities ?? [];
    const matches = caps.filter((c) => nonempty(c.id) && (!pattern.verb || c.verb === pattern.verb)
      && regex.test(`${c.id} ${c.label ?? ''}`)).sort((a, b) => a.id.localeCompare(b.id));
    const selection = { pattern, matched: matches.map((c) => c.id) };
    if (!matches.length || matches.length > 1 && pattern.index === undefined) return { status: 'UNKNOWN',
      reason: matches.length ? 'Fixture capability pattern is ambiguous; an explicit sorted index is required.' : 'Fixture capability pattern matched no current capability.', evidence: { selection } };
    const index = pattern.index ?? 0;
    if (!Number.isInteger(index) || index < 0 || index >= matches.length) return { status: 'UNKNOWN', reason: 'Fixture capability pattern index is out of range.', evidence: { selection } };
    const chosen = matches[index]; selection.chosen = { id: chosen.id, label: chosen.label, target: chosen.target, available: chosen.available, index };
    const expect = structuredClone(expectation(action));
    if (expect.entityParent?.entity === '$target') {
      expect.entityParent.entity = chosen.target?.id ?? chosen.id.slice(chosen.id.indexOf(':') + 1);
      if (!nonempty(expect.entityParent.entity)) return { status: 'UNKNOWN', reason: 'Selected fixture capability did not identify its target entity.', evidence: { selection } };
    }
    const result = await replayDirect({ ...action, capability: chosen.id, expect }, actor);
    return { ...result, evidence: { ...result.evidence, selection } };
  }
  async function runActivity(kind, id, label, action) {
    if (!action) { add(kind, id, 'UNKNOWN', 'No sourced last activity was supplied for this historical resident.'); return; }
    try {
      const actor = await createResident(label);
      for (const [i, setup] of (action.setup ?? []).entries()) {
        const result = await replay(setup, actor);
        if (result.status !== 'PASS') { add(kind, id, result.status, `Replay precondition ${i + 1}: ${result.reason}`, result.evidence); return; }
      }
      const result = await replay(action, actor, kind === 'history');
      add(kind, id, result.status, result.reason, { ...(result.evidence ?? {}), scriptedSoul: actor.soulId });
    } catch (error) { add(kind, id, 'UNKNOWN', 'Scripted replay could not be measured.', errorEvidence(error)); }
  }
  for (const resident of residents) {
    add('history-state', resident.id, 'UNKNOWN', 'The historical initial body, pose, posture, held items and commitments have not been restored and independently verified. A fresh default-body mechanism replay cannot qualify this resident for migration.',
      { initialStateSupplied: resident.initialBodyState !== undefined, restorationImplemented: false });
    await runActivity('history', resident.id, resident.name ?? resident.id, resident.lastActivity);
  }
  for (const [i, fixture] of (input.fixtures ?? []).entries()) await runActivity('fixture', fixture.id ?? `fixture-${i}`, fixture.id ?? `mechanism ${i}`, fixture);
  return { schema: 'sim-parity-behaviour/1', world: input.world ?? null, base, freshWorldAttested: true,
    startedFrom: 'caller-supplied fresh fake-mind dev world; no production data read',
    fixtureNote: 'Fixtures measure mechanics only. They are not historical resident replay evidence.',
    ...summarizeCases(cases), cases };
}

async function main() {
  const args = process.argv.slice(2), get = (k) => { const i = args.indexOf(`--${k}`); return i < 0 ? undefined : args[i + 1]; };
  if (!get('input') || !get('base') || !get('out')) throw new Error('Usage: behaviour.mjs --input input.json --base http://127.0.0.1:5901/w/example --out report.json');
  const input = JSON.parse(readFileSync(resolve(get('input')), 'utf8'));
  const report = await runBehaviour({ ...input, base: get('base') });
  const out = resolve(get('out')); mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.status}: ${report.counts.PASS} pass, ${report.counts.FAIL} fail, ${report.counts.UNKNOWN} unknown; migration ${report.migrationEligible ? 'eligible' : 'blocked'}; ${out}`);
  process.exitCode = report.status === 'PASS' ? 0 : report.status === 'FAIL' ? 1 : 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => { console.error(error.message); process.exitCode = 2; });
