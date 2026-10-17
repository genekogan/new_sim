// E-life P1: caching the static entity physics' stable text (core/hash.ts) and sharing it in takes (take/recorder.ts)
// must leave every hash byte-identical: state hashes, take ids, final-state hashes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { hashOf, stableStringify } from '../../../mars/viewer/engine/core/hash.ts';
import { takeIdOf } from '../../../mars/viewer/engine/take/recorder.ts';
import { entityPhysicsHash } from './entity-physics.ts';

/** The pre-cache stable stringify, verbatim. */
function reference(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number') return Object.is(value, -0) ? '0' : JSON.stringify(value);
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : reference(v))).join(',')}]`;
  const keys = Object.keys(value as object).filter((k) => (value as Record<string, unknown>)[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${reference((value as Record<string, unknown>)[k])}`).join(',')}}`;
}
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const physics = (n: number) => {
  const byEntity: Record<string, unknown> = {}, assets: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) { byEntity[`e_${i}`] = { solids: [{ id: `e_${i}#c0`, obb: { c: [i, -i], half: [0.5, 0.25], yaw: -0 }, y0: 0, y1: 2 }] }; assets[`ew:a${i % 7}`] = { id: `ew:a${i % 7}`, size: [1, 2, 3] }; }
  const ep = { version: 'entity-physics/1', seq: n, hash: '', baseKey: 'b', levels: [{ id: 1, y: 3, label: 'l' }], bounds: null, byEntity, assets };
  ep.hash = entityPhysicsHash(ep as never);
  return ep;
};

test('state and take hashes are byte-identical with the physics text cache and shared physics', () => {
  for (const n of [0, 3, 50]) {
    const world = { tick: 7, entities: { h_a: { id: 'h_a', pose: { p: [1, 0, -0], yaw: 0.5 } } }, entityPhysicsV1: physics(n) };
    assert.equal(stableStringify(world), reference(world));
    assert.equal(stableStringify(world), reference(world), 'cached second time');
    assert.equal(hashOf(world), sha(reference(world)));
    const body = { schema: 'take/2', finalState: world, finalStateHash: hashOf(world), tracks: {}, changes: [], events: [], undefinedField: undefined };
    assert.equal(takeIdOf(body as never), sha(reference(body)).slice(0, 24));
    assert.equal(takeIdOf(body as never, new Map([[world, stableStringify(world)]])), sha(reference(body)).slice(0, 24));
  }
  // a new physics value (different content, new hash) is never served the old text
  const a = physics(5), b = physics(6);
  assert.notEqual(stableStringify({ p: a }), stableStringify({ p: b }));
  assert.equal(stableStringify({ p: b }), reference({ p: b }));
});
