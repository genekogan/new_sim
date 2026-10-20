// ANI: animals walked straight through Souls (Gene 2026-10-20). The drawn animal now gives way: it walks round a Soul
// standing in its path, steps aside when a Soul walks into it, and returns exactly to its routine afterwards.
// Run: node --test apps/web/test/creature-give-way.test.ts
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {giveWay, giveWayState, clearFor, type Person} from '../src/gen-mesh/creatures/give-way.ts';

const HZ = 60, dt = 1 / HZ;
/** Walk a routine along x at `v` m/s from x0 for `secs`; people(t) says where people are. Returns the drawn track. */
function walk(x0: number, z0: number, v: number, secs: number, people: (t: number) => Person[], clear: number, free?: (x: number, z: number) => boolean) {
  const st = giveWayState(), out: {t: number; rx: number; rz: number; x: number; z: number; yaw: number; active: boolean; people: Person[]}[] = [];
  for (let i = 0; i <= secs * HZ; i++) {
    const t = 1000 + i * dt, rx = x0 + v * i * dt, rz = z0, ps = people(t);
    const g = giveWay(st, rx, rz, Math.PI / 2, true, ps, clear, t, free);
    out.push({t, rx, rz, x: g.x, z: g.z, yaw: g.yaw, active: g.active, people: ps});
  }
  return out;
}
const minGap = (track: ReturnType<typeof walk>) => Math.min(...track.flatMap((f) => f.people.map((q) => Math.hypot(f.x - q[0], f.z - q[1]))));
const maxJump = (track: ReturnType<typeof walk>) => Math.max(...track.slice(1).map((f, i) => Math.hypot(f.x - track[i].x, f.z - track[i].z)));

const horse = clearFor(2.2);

test('a horse walking straight at a standing Soul walks round it and back onto its routine', () => {
  for (const zOff of [0, 0.3, -0.3, 0.9]) {
    const track = walk(-6, zOff, 1.1, 14, () => [[0, 0]], horse);
    assert.ok(minGap(track) >= horse - 1e-6, `zOff ${zOff}: never inside the Soul (${minGap(track).toFixed(3)} < ${horse})`);
    assert.ok(maxJump(track) < 0.12, `zOff ${zOff}: smooth (largest step ${maxJump(track).toFixed(3)} m per frame)`);
    const end = track.at(-1)!;
    assert.ok(!end.active && end.x === end.rx && end.z === end.rz, `zOff ${zOff}: back exactly on its routine`);
    assert.ok(Math.max(...track.map((f) => f.x)) > 1, 'it got past the Soul (not stuck behind)');
  }
});

test('a Soul walking through a grazing horse nudges it aside; two Souls side by side are both cleared', () => {
  const st = giveWayState();
  let worst = Infinity, last = {x: 0, z: 0};
  for (let i = 0; i <= 8 * HZ; i++) {
    const t = i * dt, soul: Person = [-4 + 1.4 * i * dt, 0.2];
    const g = giveWay(st, 0, 0, 0, false, [soul], horse, t);
    worst = Math.min(worst, Math.hypot(g.x - soul[0], g.z - soul[1]));
    last = g;
  }
  assert.ok(worst >= horse - 1e-6, `kept clear of a walking Soul: ${worst}`);
  assert.ok(Math.hypot(last.x, last.z) < 1e-3, 'grazing in its spot again after the Soul has gone');
  const pair = walk(-6, 0, 1, 14, () => [[0, -0.5], [0, 0.5]], horse);
  assert.ok(minGap(pair) >= horse - 0.05, `two Souls: ${minGap(pair)}`);
});

test('nobody near: the routine pose comes back untouched (no drift, no cost beyond a bounds check)', () => {
  const st = giveWayState();
  for (let i = 0; i < 100; i++) {
    const g = giveWay(st, i * 0.01, 2, 0.3, true, [[50, 50], [-40, 3]], horse, i * dt);
    assert.deepEqual([g.x, g.z, g.yaw, g.active], [i * 0.01, 2, 0.3, false]);
  }
});

test('it never steps into a wall to give way', () => {
  const wall = (_x: number, z: number) => z < 0.5;   // solid north of z = 0.5: the near side is walled
  const track = walk(-6, 0.3, 1.1, 14, () => [[0, 0]], horse, wall);
  assert.ok(track.every((f) => f.z < 0.5 || !f.active), "stayed on the open side");
  assert.ok(minGap(track) >= horse - 1e-6, `went round the far side instead: ${minGap(track)}`);
});
