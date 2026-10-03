// Take replay of a prone receiver (W37; STUDIO_REPLAY.md "Prone receivers in a take"): the lab `prone` preset (W32's
// fixture: a 4x6 sheet handed up to two receivers lying at a 2.750 m deck edge) recorded with the engine's TakeRecorder
// (mars-take/4 carries `proneYaw` in integer mrad and `phaseK` in integer %) and replayed through TakePeople, the studio
// replay's path. take-replay.ts hands both fields to the renderer's SampledHuman (rad, 0–1), so the replayed receivers lie
// at the engine's heading and rise on the engine's phase progress.
//
// Every tick where p3 / p4 are in a prone activity (W35's diagnostics: `prone.engTurn` / `prone.phaseK` are the engine
// numbers each renderer received; `prone.r` the rise coordinate, `turn` the body turn):
// - the replay receives the same engine numbers as the live lab, in the same activity;
// - the body turn matches (≤ 0.01 rad) everywhere;
// - lying (lie-down, prone-wait, prone-reach) the rise and the hips match (≤ 0.025 / 2 cm), and in prone-wait (the long
//   lying phase) the head too (≤ 3 cm);
// - getting up (push-up, kneel-up) the live body is never ahead of the replay: the replay is random access (no tick history,
//   humans.ts setFrame) and so rises exactly on smooth(phaseK), while the live layer may wait for the load a hand holds
//   (W35: "never ahead of the engine"). That lag, and the torso pitch search with vs without the previous tick's pose, are
//   reported, not asserted.
// Without the fields (measured once, W37): the turn was off by 0.35 rad through every prone-wait tick, the rise by up to
// 2.97 and the head by 1.2 m.
import { test, expect } from '@playwright/test';
import { openLab } from './lab-helpers';
import { recordWithFixture } from './take-fixture';
import { writeArtifact } from './helpers';

type Prone = { r: number; bend: number; turn: number; yaw: number; w: number; slide: number; engTurn: number | null; phaseK: number | null } | null;
type Bone = { activity: string; hipY: number; head: number[] | null; prone: Prone };
const RECEIVERS = ['p3', 'p4'];
const PRONE = ['lie-down', 'prone-wait', 'prone-reach', 'push-up', 'kneel-up'];
const LYING = ['lie-down', 'prone-wait', 'prone-reach'];

type Row = { tick: number; id: string; act: string; dTurn: number; dR: number; ahead: number; dBend: number; dHip: number; dHead: number };

test('prone take replay: the replayed receivers get the engine\'s proneYaw / phaseK and lie, turn and rise as the live lab', async ({ page }) => {
  test.setTimeout(600_000);
  await openLab(page, 'prone');
  const st = await page.evaluate(() => window.__marsEngine!.runScenario('prone', { paused: true }));
  expect(st.scenario).toBe('prone');
  const { extra, live } = await recordWithFixture<Record<string, Bone>>(page, 20 * 120, 1);
  const rows: Row[] = [];
  const bad: string[] = [];
  const acts: Record<string, number> = {};
  const engSeen = { turn: 0, k: 0 };
  for (const tick of Object.keys(live).map(Number).sort((a, b) => a - b)) {
    const lb = live[tick];
    const want = RECEIVERS.filter((id) => PRONE.includes(lb[id]?.activity));
    if (!want.length) continue;
    const r = await page.evaluate(([ex, t]) => (window.__marsEngine as unknown as { replayTake(e: unknown, t: number): { bones: Record<string, Bone> } }).replayTake(ex, t), [extra, tick * 0.05] as const);
    for (const id of want) {
      const a = lb[id], b = r.bones[id];
      acts[a.activity] = (acts[a.activity] ?? 0) + 1;
      if (!b || b.activity !== a.activity || !a.prone || !b.prone) {
        bad.push(`${tick} ${id}: live ${a.activity} ${a.prone ? 'prone' : '-'}, replay ${b?.activity ?? '—'} ${b?.prone ? 'prone' : '-'}`);
        continue;
      }
      if (a.prone.engTurn !== null) engSeen.turn++;
      if (a.prone.phaseK !== null) engSeen.k++;
      const same = (x: number | null, y: number | null, tol: number) => (x === null ? y === null : y !== null && Math.abs(x - y) <= tol);
      if (!same(a.prone.engTurn, b.prone.engTurn, 0.0011) || !same(a.prone.phaseK, b.prone.phaseK, 0.0051))
        bad.push(`${tick} ${id} ${a.activity}: engine numbers live turn ${a.prone.engTurn} k ${a.prone.phaseK}, replay turn ${b.prone.engTurn} k ${b.prone.phaseK}`);
      rows.push({
        tick, id, act: a.activity,
        dTurn: Math.abs(a.prone.turn - b.prone.turn), dR: Math.abs(a.prone.r - b.prone.r), ahead: a.prone.r - b.prone.r, dBend: Math.abs(a.prone.bend - b.prone.bend),
        dHip: Math.abs(a.hipY - b.hipY), dHead: a.head && b.head ? Math.hypot(a.head[0] - b.head[0], a.head[1] - b.head[1], a.head[2] - b.head[2]) : 0,
      });
    }
  }
  const r4 = (x: number) => Math.round(x * 10000) / 10000;
  const worst = (xs: Row[], k: keyof Row) => (xs.length ? xs.reduce((m, x) => (Number(x[k]) > Number(m[k]) ? x : m), xs[0]) : null);
  const byAct = Object.fromEntries(PRONE.map((act) => {
    const xs = rows.filter((x) => x.act === act);
    return [act, Object.fromEntries((['dTurn', 'dR', 'ahead', 'dBend', 'dHip', 'dHead'] as const).map((k) => { const w = worst(xs, k); return [k, w ? `${r4(Number(w[k]))} @${w.tick} ${w.id}` : '—']; }))];
  }));
  const max = (xs: Row[], k: keyof Row) => Math.max(0, ...xs.map((x) => Number(x[k])));
  const lying = rows.filter((x) => LYING.includes(x.act)), wait = rows.filter((x) => x.act === 'prone-wait'), rising = rows.filter((x) => !LYING.includes(x.act));
  const out = { samples: rows.length, byActivity: acts, engineNumbersSeen: engSeen, worstByActivity: byAct, bad: bad.slice(0, 20) };
  writeArtifact('studio-take-prone.json', out);
  console.log(`[prone replay] ${rows.length} receiver samples ${JSON.stringify(acts)}; live published proneYaw on ${engSeen.turn}, phaseK on ${engSeen.k}; worst by activity ${JSON.stringify(byAct)}`);
  if (bad.length) console.log(`[prone replay] ${bad.slice(0, 8).join(' | ')}`);

  expect(rows.length, 'prone receiver samples compared').toBeGreaterThan(300);
  for (const a of PRONE) expect(acts[a] ?? 0, `samples in ${a}`).toBeGreaterThan(0);
  expect(engSeen.turn, 'the live lab publishes proneYaw').toBe(rows.length);
  expect(engSeen.k, 'the live lab publishes phaseK').toBe(rows.length);
  expect(bad, 'replay: same activity, and the engine\'s proneYaw / phaseK reach the replayed receivers').toEqual([]);
  expect(max(rows, 'dTurn'), 'body turn = live (rad)').toBeLessThan(0.01);
  expect(max(lying, 'dR'), 'lying: rise = live').toBeLessThan(0.025);
  expect(max(lying, 'dHip'), 'lying: hips = live (m)').toBeLessThan(0.02);
  expect(max(wait, 'dHead'), 'prone-wait: head = live (m)').toBeLessThan(0.03);
  expect(max(rising, 'ahead'), 'getting up: the live body is never ahead of the replay (= the engine\'s phaseK)').toBeLessThan(0.01);
});
