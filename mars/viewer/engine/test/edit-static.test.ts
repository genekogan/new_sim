import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createController, type EngineController } from '../api/index.ts';
import { WorldHistory } from '../history/store.ts';
import { ENGINE_RULES_VERSION } from '../api/registry.ts';
import { addAll, emptyWorld, human } from '../world/factory.ts';
import { hashOf } from '../core/hash.ts';
import { sceneForWorld } from '../spatial/edits.ts';
import type { SpatialScene } from '../spatial/types.ts';

const scene: SpatialScene = {
  bounds: [-10, -10, 10, 10], levels: [{ id: 0, y: 0, label: 'ground' }],
  surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [10, 10], yaw: 0 } }],
  obstacles: [{ id: 'wall', label: 'test wall', kind: 'wall', y0: 0, y1: 2.4, obb: { c: [0, 0], half: [0.1, 3], yaw: 0 } }], links: [],
};
function fresh() {
  const history = new WorldHistory(ENGINE_RULES_VERSION);
  history.publishCanonical('static-yard', 'static yard', addAll(emptyWorld('static-yard', scene), human('p', -4, 0)), 'test');
  const c = createController({ history, scenes: { 'static-yard': scene } });
  assert.ok(c.call('fork', { from: 'static-yard', name: 'ws' }).ok);
  return c;
}
const edit = (c: EngineController, edits: unknown[]) => c.call('edit_world', { workspace: 'ws', note: 'static geometry regression', edits });
const obstacle = (id: string, x: number, z: number) => ({ id, obb: { c: [x, z], half: [0.1, 1], yaw: 0 }, y0: 0, y1: 2.4, kind: 'wall' });
const route = (c: EngineController) => c.call('query_world', { workspace: 'ws', route: { actor: 'p', x: 4, z: 0 } }).route as { ok: boolean; length: number };

test('static edits (LM-002): removing a wall stales a plan; auto-rebind routes through the opening, persists and leaves the canonical scene untouched', () => {
  const c = fresh(), sourceHash = hashOf(scene), canonical = c.history.head('static-yard').id;
  const before = route(c);
  assert.ok(before.ok);
  const bound = c.call('bind_plan', { workspace: 'ws', bindings: {}, template: { schema: 'mars-sequence/1', id: 'cross-wall', params: {}, steps: [{ id: 'cross', verb: 'walk_to', params: { actor: 'p', x: 4, z: 0 } }] } });
  assert.ok(bound.ok, JSON.stringify(bound));
  const changed = edit(c, [{ op: 'static_remove', id: 'wall' }]);
  assert.ok(changed.ok, JSON.stringify(changed));
  assert.deepEqual((changed.diff as { other: string[] }).other, ['obstacleEdits']);
  const after = route(c);
  assert.ok(after.ok);
  assert.ok(after.length < before.length - 1, `${before.length} -> ${after.length}`);
  assert.equal(c.call('execute', { workspace: 'ws', plan_id: bound.plan_id }).code, 'plan.stale');
  const restored = createController({ history: WorldHistory.fromJSON(JSON.parse(JSON.stringify(c.history.toJSON()))), scenes: { 'static-yard': scene } });
  assert.deepEqual(route(restored), after, 'overrides survive a room restart');
  const run = c.call('execute', { workspace: 'ws', plan_id: bound.plan_id, rebind: 'auto' });
  assert.ok(run.ok, JSON.stringify(run));
  assert.ok(run.rebound);
  assert.equal(c.history.read('ws').entities.p.pose.p[0], 4);
  assert.equal(c.history.head('static-yard').id, canonical);
  assert.equal(hashOf(scene), sourceHash);
  const effective = sceneForWorld(scene, c.history.read('ws'));
  assert.equal(effective.obstacles.length, 0, 'camera and navigation share the edited scene');
});

test('static edits (LM-002): sequential add/update/remove; invalid bounds, support, overlaps and missing ids refuse atomically with named diagnostics', () => {
  const c = fresh();
  const head = c.history.head('ws').id;
  for (const [edits, code, subject] of [
    [[{ op: 'static_remove', id: 'missing' }], 'edit.static-unknown', 'missing'],
    [[{ op: 'static_add', ...obstacle('wall', 5, 5) }], 'edit.id-taken', 'wall'],
    [[{ op: 'static_add', ...obstacle('person-wall', -4, 0) }], 'edit.blocked', 'p'],
    [[{ op: 'static_add', ...obstacle('floating', 4, 4), y0: 1 }], 'edit.unsupported', 'floating'],
    [[{ op: 'static_add', ...obstacle('backwards', 4, 4), y1: -1 }], 'edit.static-invalid', 'backwards'],
    [[{ op: 'static_add', ...obstacle('outside', 10, 0) }], 'edit.off-floor', 'outside'],
    [[{ op: 'static_remove', id: 'wall' }, { op: 'static_add', ...obstacle('bad', -4, 0) }], 'edit.blocked', 'p'],
  ] as const) {
    const result = edit(c, [...edits]);
    assert.equal(result.code, code, JSON.stringify(result));
    assert.match(String(result.message), new RegExp(subject));
    assert.equal(c.history.head('ws').id, head);
  }
  assert.equal(edit(c, [{ op: 'static_add', ...obstacle('zero', 4, 4), obb: { c: [4, 4], half: [0, 1], yaw: 0 } }]).code, 'op.invalid-input');
  const result = edit(c, [{ op: 'static_add', ...obstacle('new-wall', 4, 4) }, { op: 'static_update', ...obstacle('new-wall', 6, 4) }, { op: 'static_remove', id: 'wall' }]);
  assert.ok(result.ok, JSON.stringify(result));
  const queried = c.call('query_world', { workspace: 'ws', include: ['obstacles'] });
  assert.deepEqual((queried.obstacles as { id: string }[]).map((o) => o.id), ['new-wall']);
  assert.equal(c.call('edit_world', { workspace: 'static-yard', note: 'no', edits: [{ op: 'static_remove', id: 'wall' }] }).code, 'workspace.protected');
});

test('static edits (LM-002): a post supporting a walkable deck cannot be removed or moved', () => {
  const supported = structuredClone(scene);
  supported.surfaces.push({ id: 'deck', level: 1, y: 2.4, obb: { c: [0, 0], half: [2, 3], yaw: 0 } });
  supported.levels.push({ id: 1, y: 2.4, label: 'deck' });
  const history = new WorldHistory(ENGINE_RULES_VERSION);
  history.publishCanonical('static-yard', 'static yard', emptyWorld('static-yard', supported), 'test');
  const c = createController({ history, scenes: { 'static-yard': supported } });
  c.call('fork', { from: 'static-yard', name: 'ws' });
  for (const change of [{ op: 'static_remove', id: 'wall' }, { op: 'static_update', ...obstacle('wall', 4, 4) }]) {
    const result = edit(c, [change]);
    assert.equal(result.code, 'edit.static-support');
    assert.match(String(result.message), /deck/);
  }
});


test('static edits (LM-002): supported corners across disconnected floors do not permit a floating span', () => {
  const split = structuredClone(scene);
  split.surfaces = [-3, 3].map((x, i) => ({ id: `patch-${i}`, level: 0, y: 0, obb: { c: [x, 0] as [number, number], half: [1, 2] as [number, number], yaw: 0 } }));
  split.obstacles = [];
  const history = new WorldHistory(ENGINE_RULES_VERSION);
  history.publishCanonical('static-yard', 'split floor', emptyWorld('static-yard', split), 'test');
  const c = createController({ history, scenes: { 'static-yard': split } });
  c.call('fork', { from: 'static-yard', name: 'ws' });
  const r = edit(c, [{ op: 'static_add', ...obstacle('span', 0, 0), obb: { c: [0, 0], half: [3, 1], yaw: 0 } }]);
  assert.equal(r.code, 'edit.unsupported');
});


test('static edits (LM-002): geometry-supported people cannot be stranded by removing their platform', () => {
  const history = new WorldHistory(ENGINE_RULES_VERSION);
  history.publishCanonical('static-yard', 'platform', addAll(emptyWorld('static-yard', scene), human('standing', 0, 0, { y: 2.4 })), 'test');
  const c = createController({ history, scenes: { 'static-yard': scene } });
  c.call('fork', { from: 'static-yard', name: 'ws' });
  const head = c.history.head('ws').id;
  const result = edit(c, [{ op: 'static_remove', id: 'wall' }]);
  assert.equal(result.code, 'edit.static-support');
  assert.match(String(result.message), /standing/);
  assert.equal(c.history.head('ws').id, head);
});


test('static edits (LM-002): spawn shares the effective static namespace and collision batches are atomic in either order', () => {
  const withLink = structuredClone(scene);
  withLink.links.push({ id: 'passage', kind: 'ramp', from: { level: 0, p: [5, 5], y: 0 }, to: { level: 0, p: [6, 5], y: 0 }, width: 1, heading: 0, path: [[5, 0, 5], [6, 0, 5]], usable: true });
  const history = new WorldHistory(ENGINE_RULES_VERSION);
  history.publishCanonical('static-yard', 'static yard', emptyWorld('static-yard', withLink), 'test');
  const c = createController({ history, scenes: { 'static-yard': withLink } });
  assert.ok(c.call('fork', { from: 'static-yard', name: 'ws', inventory: 'unlimited' }).ok);
  const spawn = (id: string) => ({ op: 'spawn', id, def: 'human', pose: { p: [-4, 0, 0], yaw: 0 } });
  const add = { op: 'static_add', ...obstacle('shared', 4, 4) };
  const head = c.history.head('ws').id;
  for (const edits of [[add, spawn('shared')], [spawn('shared'), add], [spawn('wall')], ...['ground', 'passage'].map((id) => [{ op: 'static_remove', id: 'wall' }, spawn(id)])]) {
    const r = edit(c, edits);
    assert.equal(r.code, 'edit.id-taken', JSON.stringify(r));
    assert.equal(c.history.head('ws').id, head, 'earlier edits in the failed batch must not commit');
    assert.equal(c.history.read('ws').entities.shared, undefined);
  }
  // Removed obstacles are absent from the effective namespace; their IDs can be reused.
  const reuse = edit(c, [{ op: 'static_remove', id: 'wall' }, spawn('wall')]);
  assert.ok(reuse.ok, JSON.stringify(reuse));
  assert.ok(c.history.read('ws').entities.wall);
  const removed = edit(c, [{ op: 'remove', id: 'wall' }]);
  assert.ok(removed.ok, JSON.stringify(removed));
  assert.ok(edit(c, [{ op: 'static_add', ...obstacle('wall', 4, 4) }]).ok);
});
