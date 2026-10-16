#!/usr/bin/env node
// Bounded resident comparison for Gene, with no retirement/migration verdict.
// Both endpoints must be explicitly attested fresh fake-mind disposable worlds.
// node tools/parity/compare-behaviour.mjs input.json > comparison.json
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertFreshLocalTarget } from './behaviour.mjs';

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const byId = (a, b) => a.id.localeCompare(b.id);
const pathIds = (o) => (o.self?.placePath ?? []).map((p) => typeof p === 'string' ? p : p.id);
const cleanCap = (c) => ({ id: c.id, verb: c.verb, label: c.label, available: c.available, ...(c.target ? { target: c.target } : {}), ...(c.blocked ? { blocked: c.blocked } : {}) });
const observed = (o) => ({ tick: o.tick, activity: o.self?.activity, state: o.self?.state, position: o.self?.position, placePath: pathIds(o) });
const issue = (error) => ({ code: error?.code ?? 'comparison.request', httpStatus: error?.status ?? null });

export async function runComparisonBehaviour({ oldBase, newBase, world, freshWorld, timeoutMs = 45_000, pollMs = 500,
  request: injectedRequest, sleep = pause, now = Date.now } = {}) {
  const bases = { old: assertFreshLocalTarget(oldBase, freshWorld), new: assertFreshLocalTarget(newBase, freshWorld) };
  if (bases.old === bases.new) throw new Error('Comparison needs two distinct disposable world endpoints.');
  const request = injectedRequest ?? (async (base, path, { body, token, identity } = {}) => {
    const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : identity ? { authorization: `Bearer dev:${identity}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
    let data; try { data = await r.json(); } catch { data = {}; }
    if (!r.ok) throw Object.assign(new Error('Comparison request failed'), { status: r.status, code: data.error?.code ?? data.code ?? 'http.error' });
    return data;
  });
  const sides = {};
  for (const [side, base] of Object.entries(bases)) {
    const result = { base, body: null, catalogue: [], steps: {} };
    sides[side] = result;
    const api = (path, opts) => request(base, path, opts);
    try {
      const owner = `parity-compare-${side}-${now().toString(36)}`;
      const inv = await api('/v1/admin', { identity: 'admin', body: { action: 'invite', uses: 1 } });
      await api('/v1/invite', { identity: owner, body: { code: inv.code } });
      const born = await api('/v1/souls', { identity: owner, body: { name: `Parity comparison ${side} ${now().toString(36)}`, description: 'Disposable scripted comparison resident; no LLM.' } });
      if (!born.soul?.id) throw Object.assign(new Error('No scripted Soul'), { code: 'comparison.soul-missing' });
      const pair = await api(`/v1/souls/${encodeURIComponent(born.soul.id)}/pair`, { identity: owner, body: {} });
      const exchange = await api('/v1/agent/pair', { body: { code: pair.code, agent: 'parity-comparison-script' } });
      if (!exchange.token) throw Object.assign(new Error('No scoped pairing'), { code: 'comparison.pair-missing' });
      const actor = { token: exchange.token };
      let observation;
      const t0 = now();
      do { observation = await api('/v1/edge/observe', actor); if (observation.self?.position) break; await sleep(pollMs); } while (now() - t0 < timeoutMs);
      if (!observation.self?.position) throw Object.assign(new Error('No body'), { code: 'comparison.body-timeout' });
      const entityId = observation.self.entityId ?? born.soul.entityId;
      result.scriptedSoul = born.soul.id;
      result.initial = observed(observation);
      try { const b = await api('/v1/edge/body', actor); result.body = { family: b.body?.family ?? 'default-humanoid', type: b.body?.type ?? 'humanoid', model: b.body?.model ?? null, lookDef: b.lookDef ?? null }; }
      catch (error) { result.body = { unmeasured: true, ...issue(error) }; }
      const map = (await api('/v1/edge/map')).places ?? [];
      result.places = map.map((p) => ({ id: p.id, name: p.name, enclosed: p.enclosed, walkable: p.walkable }));
      const caps = async () => {
        const list = (await api('/v1/edge/capabilities', actor)).capabilities ?? [];
        const merged = new Map(result.catalogue.map((c) => [c.id, c]));
        for (const c of list) merged.set(c.id, cleanCap(c));
        result.catalogue = [...merged.values()].sort(byId);
        return list;
      };
      const pick = (list, predicate, preferred) => list.filter(predicate).sort((a, b) => Number(b.available === true) - Number(a.available === true)
        || Number(preferred?.(b) ?? false) - Number(preferred?.(a) ?? false) || byId(a, b))[0];
      async function does(cap, kind) {
        if (!cap) return { status: 'NOT_OFFERED', detail: kind === 'sit'
          ? 'No named furniture-seat capability was offered at the measured location; ground sitting was not used as furniture proof.'
          : kind === 'enter' ? 'No named interior destination was offered at the measured location.'
            : 'None of the sampled carry/read/object-use verbs was offered at the measured location; inspect the separate catalogue for other interactions.' };
        const label = cap.label ?? cap.id;
        const started = now();
        const out = await api('/v1/edge/act', { ...actor, body: { capability: cap.id, ...(kind === 'sit' || kind === 'use' && cap.verb !== 'pick-up' ? { params: { seconds: 15 } } : {}) } });
        if (!out.accepted) return { status: 'REFUSED', detail: label, capability: cap.id, code: out.code ?? null };
        let receipt = out.receipt;
        if (!receipt?.id) return { status: 'UNKNOWN', detail: `${label}: acceptance had no auditable receipt.`, capability: cap.id };
        let effect = null;
        do {
          observation = await api('/v1/edge/observe', actor);
          receipt = (await api(`/v1/edge/receipts/${encodeURIComponent(receipt.id)}`, actor)).receipt ?? receipt;
          if (receipt.capability && receipt.capability !== cap.id) return { status: 'UNKNOWN', detail: `${label}: receipt target differs.`, capability: cap.id, actual: receipt.capability };
          if (['failed', 'replaced'].includes(receipt.phase)) return { status: 'REFUSED', detail: label, capability: cap.id, receipt: receipt.id, code: receipt.code ?? receipt.phase, observation: observed(observation) };
          if (kind === 'enter' && receipt.phase === 'completed' && cap.target?.kind === 'place' && pathIds(observation).includes(cap.target.id)) effect = { place: cap.target.id };
          if (kind === 'sit' && observation.self?.activity === 'sit') effect = { activity: 'sit', target: cap.target?.id ?? null };
          if (kind === 'use' && cap.verb === 'pick-up') {
            const target = cap.target?.id ?? cap.id.slice(cap.id.indexOf(':') + 1);
            const holding = observation.self?.holding;
            const ids = typeof holding === 'string' ? [holding] : [holding?.id, holding?.entity, holding?.entityId, holding?.item?.id];
            if (ids.includes(target)) effect = { holding: target };
            if (!effect && side === 'new') {
              try { const e = await api(`/v1/world/entities/${encodeURIComponent(target)}`); if (e.entity?.in?.parent === entityId) effect = { heldEntity: target, parent: entityId }; }
              catch { /* Older engines have no entity-model endpoint; absence is not success. */ }
            }
          }
          if (kind === 'use' && cap.verb !== 'pick-up' && observation.self?.activity === cap.verb) effect = { activity: cap.verb, target: cap.target?.id ?? null };
          if (effect) return { status: 'OBSERVED', detail: label, capability: cap.id, receipt: receipt.id, phase: receipt.phase, effect, observation: observed(observation), elapsedMs: now() - started };
          // Timed activities are checked while active; item/room effects get a bounded chance to publish after completion.
          await sleep(pollMs);
        } while (now() - started < timeoutMs);
        return { status: 'UNKNOWN', detail: `${label}: no matching observable effect within ${timeoutMs / 1000}s.`, capability: cap.id, receipt: receipt.id, phase: receipt.phase, observation: observed(observation) };
      }
      let list = await caps();
      const interior = (c) => c.verb === 'walk' && c.target?.kind === 'place' && (map.some((p) => p.id === c.target.id && p.enclosed)
        || /(?:kitchen|mimos\/floor|tower.*(?:L0|ground)|minarete-passage|house.*(?:living|ground))/i.test(c.id + ' ' + c.label));
      const preferInterior = (c) => world === 'mars' ? (side === 'new' ? /mimos\/floor/.test(c.id) : /kitchen/.test(c.id))
        : world === 'littlemartians' ? /tower.*(?:L0|ground)|minarete-passage/i.test(c.id + ' ' + c.label) : /house-2|house2/i.test(c.id + ' ' + c.label);
      result.steps.enter = await does(pick(list, interior, preferInterior), 'enter');
      list = await caps();
      result.steps.sit = await does(pick(list, (c) => c.verb === 'sit' && !c.id.endsWith(':here'), (c) => /honey.sofa|kitchen.*bench|tower|temple/i.test(c.id + ' ' + c.label)), 'sit');
      // Release this probe's timed seat before testing another interaction.
      if (result.steps.sit.status === 'OBSERVED') {
        const stand = (await caps()).find((c) => c.id === 'stand:here');
        if (stand) {
          const stop = await api('/v1/edge/act', { ...actor, body: { capability: stand.id } });
          result.standAfterSit = { accepted: stop.accepted === true, code: stop.code ?? null };
          for (let i = 0; i < 10; i++) { observation = await api('/v1/edge/observe', actor); if (observation.self?.activity !== 'sit') break; await sleep(pollMs); }
        }
      }
      list = await caps();
      const useVerbs = ['pick-up', 'use-computer', 'read', 'cook', 'play-game', 'paint', 'play-piano', 'drink', 'eat'];
      const usable = list.filter((c) => useVerbs.includes(c.verb)).sort((a, b) => Number(b.available === true) - Number(a.available === true)
        || useVerbs.indexOf(a.verb) - useVerbs.indexOf(b.verb) || Number(a.id.endsWith(':here')) - Number(b.id.endsWith(':here')) || byId(a, b));
      result.steps.use = await does(usable[0], 'use');
      result.verbCounts = Object.fromEntries([...new Set(result.catalogue.map((c) => c.verb))].sort().map((verb) => [verb, result.catalogue.filter((c) => c.verb === verb).length]));
    } catch (error) {
      result.error = issue(error);
      for (const kind of ['enter', 'sit', 'use']) result.steps[kind] ??= { status: 'UNKNOWN', detail: 'Scripted measurement could not finish.', ...issue(error) };
    }
  }
  const rows = ['enter', 'sit', 'use'].map((activity) => ({ activity, old: sides.old.steps[activity], new: sides.new.steps[activity] }));
  rows.push({ activity: 'catalogue', old: { status: sides.old.error ? 'UNKNOWN' : 'LISTED', detail: sides.old.verbCounts ?? {}, count: sides.old.catalogue.length },
    new: { status: sides.new.error ? 'UNKNOWN' : 'LISTED', detail: sides.new.verbCounts ?? {}, count: sides.new.catalogue.length } });
  rows.push({ activity: 'original-cast', old: { status: 'UNMEASURED', detail: 'Fresh scripted body only; original residents, floater assignments and history were not copied.' },
    new: { status: 'UNMEASURED', detail: 'Fresh scripted body only; original residents, floater assignments and history were not reconstructed.' } });
  return { schema: 'sim-resident-comparison/1', world, measuredAt: new Date().toISOString(), sides, rows,
    limits: ['Disposable fake-mind dev worlds; no original resident or production action.', 'Catalogue means currently offered, not demonstrated; only OBSERVED rows include a measured effect.',
      'Three bounded examples per side; no claim that every listed activity, body or historical resident is equivalent.', 'Sitting records the requested seat and observed seated activity, not an independent occupancy/slot audit.'],
    purpose: 'Comparison evidence for Gene; no retirement or migration verdict.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runComparisonBehaviour(JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'))).then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error) => { console.error(error.message); process.exitCode = 2; });
}
