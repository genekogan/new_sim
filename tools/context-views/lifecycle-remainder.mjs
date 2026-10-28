import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { edits } from './fixture.mjs';

// Exactly three cache records, so the requested landmark competes with real
// maintenance work. Original edits and 15s end-to-end bound remain unchanged.
export async function runLifecycleRemainder({ withFixtureSession, report, save }) {
  const evidence = report.lifecycleRemainder = { checks: [], phases: [], originalBoundMs: 15000 };
  const receipt = await withFixtureSession({ variant: 'move-delete-undo' }, async session => {
    const refs = ['landmark', 'enclosed-room', 'wall-artwork'].map(id => session.bindings.find(b => b.id === id).ref);
    const check = (name, ok, data = {}) => { evidence.checks.push({ name, ok: !!ok, ...data }); save(); assert.ok(ok, name); };
    const ready = async (selected, phase, started = performance.now()) => {
      session.setPhase(phase); const startedAt = Date.now() - (performance.now() - started); let result;
      do {
        session.signal.throwIfAborted();
        result = await (await session.request('/v1/world/context/views', { refs: selected, detail: false, sheet: false }, null)).json();
        if (result.views.every(v => v.status !== 'pending')) break;
        if (performance.now() - started >= 15000) break;
        await delay(100, undefined, { signal: session.signal });
      } while (true);
      const elapsedMs = performance.now() - started;
      const events = session.jobEvents();
      const timings = result.views.map(view => {
        const start = events.find(e => e.phase === 'start' && e.ref === view.ref && e.key === view.key && e.at >= startedAt);
        const finish = start && events.find(e => e.phase === 'finish' && e.ref === view.ref && e.key === view.key && e.at >= start.at);
        return { ref: view.ref, queueAndAdmissionMs: start ? start.at - startedAt : null, renderMs: finish?.ms ?? null, note: start ? 'Queue includes admission/edit work before actual renderer start.' : 'No matching new start; cached/reused work or unavailable, retained events are authoritative.' };
      });
      evidence.phases.push({ phase, startedAt, elapsedMs, timings, views: result.views, events }); save();
      check(phase + ' ready within original 15s including edit/queue', result.views.every(v => v.status === 'ready') && elapsedMs <= 15000, { elapsedMs });
      return result.views;
    };
    const initial = await ready(refs, 'prime-three');
    let started = performance.now();
    const move = await (await session.request('/v1/god/act', { ops: edits.find(e => e.id === 'move').ops })).json();
    check('original move accepted', move.accepted, { failures: move.failures });
    const moved = await ready([refs[0]], 'move-requested-first', started);
    check('move keeps ref and changes pixels', moved[0].ref === refs[0] && moved[0].key !== initial[0].key);
    const old = await session.rawGet(initial[0].url);
    check('pre-move image refused', old.status === 404, { status: old.status });
    session.setPhase('delete-and-undo');
    started = performance.now();
    const removed = await (await session.request('/v1/god/act', { ops: edits.find(e => e.id === 'delete').ops })).json();
    check('original delete accepted', removed.accepted, { failures: removed.failures });
    const missing = await session.rawGet('/v1/world/context?ref=' + encodeURIComponent(refs[0]));
    const missingBody = await missing.json();
    const listing = await (await session.request('/v1/world/context', undefined, null)).json();
    const stale = await session.rawGet(moved[0].url);
    evidence.deletion = { exactStatus: missing.status, exact: missingBody, defaultRefs: listing.targets.map(t => t.ref), defaultNextCursor: listing.nextCursor, oldImageStatus: stale.status }; save();
    // GET context is a listing/filter contract: absent exact refs are 200+empty.
    // Actual image retrieval remains a refusal (404), not an empty success.
    check('deleted target absent from exact/default listing and cached image refused promptly',
      missing.status === 200 && missingBody.contract === 'world-context/1' && missingBody.scope === 'exact' && missingBody.total === 0 && Array.isArray(missingBody.targets) && missingBody.targets.length === 0 && missingBody.nextCursor === null &&
      listing.nextCursor === null && !listing.targets.some(t => t.ref === refs[0]) && stale.status === 404 && performance.now() - started <= 15000,
      { metadataStatus: missing.status, imageStatus: stale.status, elapsedMs: performance.now() - started });
    const undo = await (await session.request('/v1/god/undo', {})).json();
    check('delete undo accepted', undo.accepted, { failures: undo.failures });
    const restored = await ready([refs[0]], 'delete-and-undo-requested-first', started);
    check('undo restores exact target and moved pixel key', restored[0].ref === refs[0] && restored[0].key === moved[0].key);
    session.setPhase('undo-background-drain');
    for (;;) {
      session.signal.throwIfAborted();
      const events = session.jobEvents();
      if (events.filter(e => e.phase === 'start').length === events.filter(e => e.phase === 'finish').length) {
        await delay(300, undefined, { signal: session.signal });
        if (session.jobEvents().length === events.length) break;
      }
      await delay(100, undefined, { signal: session.signal });
    }
    evidence.backgroundDrained = true; save();
  });
  evidence.receipt = receipt; evidence.functionalPass = !receipt.error && receipt.cleanup.complete && evidence.checks.every(c => c.ok); evidence.resourcePass = receipt.resources?.combinedWithinBound === true; evidence.pass = evidence.functionalPass && evidence.resourcePass; save();
  return evidence;
}
