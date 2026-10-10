// Creature behaviour is a pure function of (seed, time, home, surroundings).
//   node --test apps/web/src/gen-mesh/creatures/behavior.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pose, RouteCache, legSeconds, type Plan, type Surroundings } from './behavior.ts';

const open: Surroundings = { free: () => true };
const plan = (o: Partial<Plan> = {}): Plan => ({ kind: 'wander', speed: 1, radius: 6, size: 0.25, seed: 1234, home: [10, -4], ...o });

test('deterministic: two viewers at the same time agree, whatever they computed before', () => {
  const a = new RouteCache(), b = new RouteCache();
  for (let t = 0; t < 50; t += 0.37) pose(plan(), 1_760_000_000 + t, open, a);   // viewer A watched for a while
  for (const t of [3.1, 17.25, 44.9]) assert.deepEqual(pose(plan(), 1_760_000_000 + t, open, a), pose(plan(), 1_760_000_000 + t, open, b));
});

test('wander stays within the radius, moves continuously and rests between legs', () => {
  const c = new RouteCache(), p = plan(), t0 = 1_760_000_123;
  let prev = pose(p, t0, open, c), maxJump = 0, walking = 0, resting = 0;
  for (let t = t0 + 0.05; t < t0 + 300; t += 0.05) {
    const q = pose(p, t, open, c);
    assert.ok(Math.hypot(q.x - p.home[0], q.z - p.home[1]) <= p.radius + 1e-6, 'inside radius');
    maxJump = Math.max(maxJump, Math.hypot(q.x - prev.x, q.z - prev.z));
    if (q.activity === 'walk') walking++; else resting++;
    prev = q;
  }
  assert.ok(maxJump < p.speed * 0.05 * 4, `no teleports (max step ${maxJump.toFixed(3)} m in 50 ms)`);
  assert.ok(walking > 200 && resting > 200, `walks (${walking}) and rests (${resting})`);
  assert.ok(legSeconds(p) > p.radius / p.speed);
});

test('avoids a solid: never stands inside a box in its yard', () => {
  const box = { x0: 9, x1: 12, z0: -6, z1: -2 };   // a shed in the middle of the yard (home is just outside)
  const s: Surroundings = { free: (x, z, r) => !(x > box.x0 - r && x < box.x1 + r && z > box.z0 - r && z < box.z1 + r) };
  const p = plan({ home: [7, -4], radius: 7 }), c = new RouteCache();
  let inside = 0;
  for (let t = 0; t < 600; t += 0.1) { const q = pose(p, 1_760_000_000 + t, s, c); if (q.x > box.x0 && q.x < box.x1 && q.z > box.z0 && q.z < box.z1) inside++; }
  assert.ok(inside < 10, `inside the shed ${inside} samples of 6000`);
});

test('swimmers keep to water; graze pauses longer than wander', () => {
  const pond = (x: number, z: number) => Math.hypot(x - 10, z + 4) < 5;
  const s: Surroundings = { free: (x, z) => pond(x, z) };
  const c = new RouteCache(), p = plan({ kind: 'swim', speed: 0.4, radius: 6 });
  let dry = 0;
  for (let t = 0; t < 400; t += 0.2) { const q = pose(p, 1_760_000_000 + t, s, c); if (!pond(q.x, q.z)) dry++; }
  assert.ok(dry < 20, `out of the pond ${dry} samples`);
  assert.ok(legSeconds(plan({ kind: 'graze', seed: 5 })) > legSeconds(plan({ kind: 'wander', seed: 5 })));
});

test('flying arcs leave the ground and land again', () => {
  const c = new RouteCache(), p = plan({ kind: 'fly', speed: 3, radius: 12 });
  let maxAlt = 0, landed = 0;
  for (let t = 0; t < 120; t += 0.1) { const q = pose(p, 1_760_000_000 + t, open, c); maxAlt = Math.max(maxAlt, q.alt); if (q.alt === 0) landed++; }
  assert.ok(maxAlt > 1.5 && landed > 100);
});
