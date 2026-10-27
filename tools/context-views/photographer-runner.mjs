// Suite only. The context owner supplies six serial fresh-cache sessions under
// one outer deadline/Chrome lease and retains all process/cleanup custody.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { photographerFixture, photographerEdit, bindPhotographerFixture, assertPhotographerBudget,
  PHOTOGRAPHER_LIMITS } from './photographer-fixture.mjs';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest('hex');
export function physicalFingerprint(snapshot) {
  return hash(snapshot.entities.map(({ v, born, by, ...facts }) => facts).sort((a, b) => a.id.localeCompare(b.id)));
}

/** withFixtureSession({variant}, callback) must start with an empty cache and
 * make NO view requests before callback. It returns {contextJobs, cleanup} only
 * after stopping its own server, including on failure (receipt.error records it).
 * contextJobs includes every start/finish trace, including unrequested work and
 * retries. No product cache reset is permitted. */
export async function runPhotographerQualification(owner) {
  const { withFixtureSession, out, deadline, signal, report, save } = owner;
  if (!Number.isFinite(deadline) || !signal || typeof withFixtureSession !== 'function')
    throw Error('photographer needs owner session factory, absolute deadline and abort signal');
  const fixture = photographerFixture({ genesis: null, cases: owner.cases });
  const steps = fixture.steps.filter(step => !step.optional);
  const variants = ['base', 'declared-front-rotation', 'entrance-occluder', 'transformed-authored', 'unclassified-obstruction', 'classified-roof'];
  const rows = [...steps.map(step => ({ id: step.id, status: 'not-run', oracle: false })),
    { id: 'cutaway-sheet', status: 'not-run', oracle: false }];
  const evidence = report.photographer = { version: fixture.version, limits: fixture.limits, startedAt: Date.now(),
    results: rows, sessions: [], notes: ['Unavailable, missing and deadline rows fail their oracle and are retained.',
      'Actual image composition and visible Cutaway labels require root inspection.',
      'Fresh-session differences prove composition/transform behavior, not hot cache invalidation.',
      'Every actual job start/retry/unrequested capture comes from the owner server trace, not result counts.'] };
  const check = () => { signal.throwIfAborted(); if (Date.now() >= deadline) throw Error('photographer absolute deadline'); };
  const persist = () => { assertPhotographerBudget(rows); save(); };
  const replace = (id, value) => { const row = rows.find(row => row.id === id); Object.assign(row, value); persist(); return row; };
  let baselineFingerprint;
  try {
    for (const variant of variants) {
      check();
      const sessionEvidence = { variant, status: 'starting' }; evidence.sessions.push(sessionEvidence); persist();
      const receipt = await withFixtureSession({ variant }, async session => {
        const { request, setPhase } = session;
        if (typeof setPhase !== 'function') throw Error('photographer session sampler phase callback missing');
        const json = async (path, body, auth) => { check(); const response = await request(path, body, auth); check(); return response.json(); };
        const snapshot = () => json('/v1/world/snapshot', undefined, null);
        const waitPending = async read => {
          let value = await read();
          while (value?.status === 'pending') { check(); await delay(Math.min(250, Math.max(1, deadline - Date.now())), undefined, { signal }); value = await read(); }
          return value;
        };
        const image = async (id, url) => {
          check(); const response = await request(url, undefined, null); const bytes = Buffer.from(await response.arrayBuffer()); check();
          const file = join(out, `photographer-${id}.png`); writeFileSync(file, bytes);
          return { file, imageSha: hash(bytes), bytes: bytes.length };
        };
        const capture = async (step, ref, expectedCamera) => {
          setPhase(`photographer:${step.id}`); const start = performance.now();
          const view = await waitPending(async () => (await json('/v1/world/context/views', { refs: [ref], detail: true }, null)).views?.[0]);
          const row = replace(step.id, { ...(view ?? { status: 'missing' }), id: step.id, ref,
            requestToReadyMs: performance.now() - start, oracle: false, visualInspection: 'pending-root-review' });
          if (view?.url) Object.assign(row, await image(step.id, view.url));
          let oracle = view?.status === 'ready' && view.photo?.status === 'ready' && typeof view.photo.recipeVersion === 'string';
          if (step.id === 'declared-front-rotation') oracle &&= view.photo.provenance?.front === 'declared-front';
          if (step.id === 'entrance-occluder') oracle &&= view.photo.provenance?.front === 'entrance' && !view.photo.cutaway;
          if (step.id === 'classified-roof') oracle &&= view.photo.cutaway?.label === 'Cutaway' &&
            view.photo.cutaway.occluderIds.some(id => id.startsWith(`${sessionEvidence.structuralEntity}:`)) &&
            view.photo.cutaway.occluderIds.every(id => !id.startsWith(`${view.entity}:`));
          if (step.id === 'transformed-authored') oracle &&= view.photo.provenance?.camera === 'authored' &&
            hash(view.photo.eye) === hash(expectedCamera?.eye) && hash(view.photo.at) === hash(expectedCamera?.at);
          if (step.id === 'unclassified-obstruction') oracle = view?.status === 'unavailable' && view.photo?.status === 'unavailable' &&
            view.photo.reason === 'needs-viewpoint' && view.photo.diagnostics?.some(score => score.reason === 'obscured') && !view.photo.cutaway;
          row.oracle = Boolean(oracle); row.latencyWithin15s = row.requestToReadyMs <= 15000; persist();
          return row;
        };
        const baseline = await snapshot();
        const fingerprint = physicalFingerprint(baseline);
        baselineFingerprint ??= fingerprint;
        if (fingerprint !== baselineFingerprint) throw Error('fresh fixture physical/semantic baseline mismatch');
        sessionEvidence.baselineFingerprint = fingerprint;
        const listing = await json('/v1/world/context', undefined, null);
        if (listing.nextCursor) throw Error('five-case photographer fixture unexpectedly requires paging');
        const bindings = bindPhotographerFixture(fixture, baseline.entities, listing.targets, () => session.bindings);
        for (const binding of bindings) if (!listing.targets.some(target => target.ref === binding.ref && target.entity === binding.entity))
          throw Error(`photographer binding not published: ${binding.id}`);
        sessionEvidence.bindings = bindings;
        if (variant !== 'base') {
          const ops = photographerEdit(variant, baseline.entities), authoring = await json('/v1/god/act', { ops });
          sessionEvidence.ops = ops; sessionEvidence.authoring = authoring;
          if (!authoring.accepted) { replace(variant, { status: 'authoring-refused', oracle: false, authoring }); return; }
          const edited = await snapshot(); sessionEvidence.editedFingerprint = physicalFingerprint(edited);
          sessionEvidence.structuralEntity = edited.entities.find(entity => entity.name === 'photographer-roof-cover')?.id;
        }
        for (const step of steps.filter(step => variant === 'base' ? step.id.startsWith('base:') : step.id === variant)) {
          check(); const binding = bindings.find(binding => binding.id === step.binding);
          if (!binding) throw Error(`missing photographer binding ${step.binding}`);
          const exact = variant === 'base' ? undefined : await json(`/v1/world/context?ref=${encodeURIComponent(binding.ref)}`, undefined, null);
          const row = await capture(step, binding.ref, exact?.targets[0]?.camera);
          // Safety is already resolved. If it unexpectedly rendered, no spare
          // image exists for this sheet: preserve the missing sheet as failure.
          if (variant === 'classified-roof' && row.status === 'ready' && rows.filter(row => row.url || row.imageSha).length < PHOTOGRAPHER_LIMITS.images) {
            setPhase('photographer:cutaway-sheet'); const start = performance.now(); let manifest;
            const sheet = await waitPending(async () => {
              manifest = await json('/v1/world/context/views', { refs: [binding.ref], detail: true, sheet: true }, null); return manifest.sheet;
            });
            const same = manifest.views?.[0], tile = sheet?.tiles?.[0];
            const sheetRow = replace('cutaway-sheet', { ...(sheet ?? { status: 'missing' }), id: 'cutaway-sheet', ref: binding.ref,
              requestToReadyMs: performance.now() - start, individualPhoto: same?.photo,
              oracle: sheet?.status === 'ready' && same?.key === row.key && tile?.key === row.key &&
                same?.photo?.cutaway?.label === 'Cutaway' && (tile?.photo?.cutaway?.label ?? tile?.cutaway?.label) === 'Cutaway',
              visualInspection: 'pending-root-review: individual and sheet must visibly say Cutaway' });
            sheetRow.latencyWithin15s = sheetRow.requestToReadyMs <= 15000;
            if (sheet?.url) Object.assign(sheetRow, await image('cutaway-sheet', sheet.url)); persist();
          }
        }
        sessionEvidence.status = 'completed-callback'; persist();
      });
      sessionEvidence.receipt = receipt;
      if (!Array.isArray(receipt?.contextJobs) || !receipt?.cleanup) throw Error('owner omitted actual-job or cleanup receipt');
      sessionEvidence.actualJobStarts = receipt.contextJobs.filter(event => event.phase === 'start').length;
      sessionEvidence.status = 'cleaned'; persist(); check();
      if (receipt.error) throw Error(`fixture ${variant}: ${receipt.error}`);
    }
  } catch (error) { evidence.error = String(error); }
  finally {
    evidence.endedAt = Date.now();
    evidence.actualJobStarts = evidence.sessions.reduce((count, session) => count + (session.actualJobStarts ?? 0), 0);
    evidence.jobStartsWithin22 = evidence.actualJobStarts <= PHOTOGRAPHER_LIMITS.jobStarts;
    evidence.machinePass = !evidence.error && evidence.jobStartsWithin22 && rows.every(row => row.oracle && row.latencyWithin15s !== false);
    evidence.visualQualification = 'pending-root-review'; persist();
  }
  return evidence;
}
