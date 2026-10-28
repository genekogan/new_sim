// Pure fixture identity and ordinary, reversible media alignment. No server/browser boot.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { WorldModel } from '../../packages/world-compiler/src/index.ts';
import { contextTargets, contextEnclosed } from '../../apps/server/src/god/context-view-scene.ts';
import { genesis, cases } from '../context-views/fixture.mjs';
import { bindCases } from '../context-views/bindings.mjs';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value;
export const qualityHash = value => createHash('sha256').update(Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest('hex');
export const fixtureModel = snapshot => WorldModel.fromSnapshot({ ...snapshot, seq: snapshot.counter ?? 0, editSeq: snapshot.seq });

export function qualityBeforeReceipt(bytes, expected) {
  const before = JSON.parse(bytes);
  assert.equal(before.source, expected.baselineSource, 'retained source identity');
  assert.equal(qualityHash(bytes), expected.baselineReceiptSha256, 'retained camera/build receipt identity');
  return before;
}
export function qualityBeforeImage(role, bytes, before, expected) {
  const pin = before.checks.find(row => row.name === role + ' exact cached key/URL/bytes with no render')?.data?.sha256;
  assert.equal(qualityHash(bytes), expected.baselinePngs[role], 'before PNG fixed pin');
  assert.equal(qualityHash(bytes), pin, 'before PNG receipt identity');
  return pin;
}

export function qualityBindings(model) {
  const targets = contextTargets(model).map(target => ({ ...target, enclosed: contextEnclosed(model, target) }));
  return { targets, bindings: bindCases(cases, [...model.entities.values()], targets) };
}

/** Strip only generated IDs/editor counters; retain every geometry/material/media input and baked physical output. */
export function qualityFixtureFacts(model) {
  const nameOf = id => id === 'world' ? id : model.entities.get(id)?.name ?? id;
  const entities = [...model.entities.values()].map(entity => {
    const def = model.resolvedDef(entity.def); assert.ok(def, 'fixture definition resolves');
    return { name: entity.name, def: def.ref, defHash: def.hash, in: { ...entity.in, parent: nameOf(entity.in.parent) },
      p: entity.p, r: entity.r, s: entity.s, params: entity.params, state: entity.state, shape: entity.shape, seed: entity.seed,
      bakedSha256: qualityHash(model.bake(def, entity.params ?? {}, entity.seed ?? 0, entity.shape)) };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const ground = model.ground();
  return canonical({ fixtureSha256: qualityHash({ genesis, cases }), constants: model.constants, groundAppearance: model.state.ground ?? null,
    ground: { ...ground, landforms: ground.landforms.map(row => ({ ...row, id: nameOf(row.id) })), waters: ground.waters.map(row => ({ ...row, id: nameOf(row.id) })) }, entities });
}

/** Only media may differ at admission; all other render facts must equal the pinned untouched fixture. */
export async function alignQualityFixture(session, snapshot, expected) {
  const model = fixtureModel(snapshot), artwork = [...model.entities.values()].find(entity => entity.name === 'artwork');
  assert.ok(artwork, 'fixture artwork exists');
  const priorMedia = artwork.state?.media, targetMedia = expected.entities.find(entity => entity.name === 'artwork')?.state?.media;
  assert.equal(typeof priorMedia, 'string'); assert.equal(targetMedia, '', 'untouched genesis has empty artwork media');
  const allowed = structuredClone(qualityFixtureFacts(model)); allowed.entities.find(entity => entity.name === 'artwork').state.media = targetMedia;
  assert.deepEqual(allowed, expected, 'fixture geometry/material/state differs beyond the admitted uploaded artwork');
  let changed = false;
  const restore = async () => {
    if (!changed) return { changed: false, restored: true };
    const result = await (await session.request('/v1/god/act', { ops: [{ op: 'set', id: artwork.id, state: { media: priorMedia } }] })).json();
    assert.ok(result.accepted, 'ordinary artwork media restore accepted');
    const restored = await (await session.request('/v1/world/snapshot', undefined, null)).json();
    assert.deepEqual(qualityFixtureFacts(fixtureModel(restored)), qualityFixtureFacts(model), 'shared fixture restored before painting proof');
    changed = false; return { changed: true, restored: true, seq: result.seq };
  };
  try {
    if (priorMedia !== targetMedia) {
      changed = true; // Restore even if the mutation succeeded but its response was interrupted.
      const result = await (await session.request('/v1/god/act', { ops: [{ op: 'set', id: artwork.id, state: { media: targetMedia } }] })).json();
      assert.ok(result.accepted, 'ordinary artwork media alignment accepted');
    }
    const aligned = changed ? await (await session.request('/v1/world/snapshot', undefined, null)).json() : snapshot;
    assert.deepEqual(qualityFixtureFacts(fixtureModel(aligned)), expected, 'aligned fixture matches pinned untouched geometry/material/media identities');
    return { snapshot: aligned, restore, evidence: { artworkId: artwork.id, changed, priorMedia, targetMedia, originalSeq: snapshot.seq, alignedSeq: aligned.seq, expectedFactsSha256: qualityHash(expected), alignedFactsSha256: qualityHash(qualityFixtureFacts(fixtureModel(aligned))) } };
  } catch (error) { try { await restore(); } catch (restoreError) { throw Object.assign(new AggregateError([error, restoreError], 'alignment failed and restore requires owner attention'), { restorationFailed: true }); } throw error; }
}
