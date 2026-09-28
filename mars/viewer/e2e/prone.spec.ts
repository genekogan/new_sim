// Prone receiver (owner feedback §13; engine HANDUP.md "Prone receiver"; docs/engineering/POSES.md "Prone receiver"):
// lab presets `prone` (a 4x6 sheet handed up by two givers to a 2.9 m deck, 0.83 m below its top) and `prone-forks`
// (off the forks, 0.75 m below). p3 / p4 lie on their stomachs at the east deck edge, reach down, take the sheet, push
// up on one hand, kneel up and stand holding it. Every tick of the run:
// - hands: every arm with an engine hand point whose shoulder is within the arm's length of it has its palm within
//   0.1 m of the point; no arm longer than its bones; the share reached per prone activity is logged (misses listed);
// - body vs deck: lying (prone-wait / prone-reach) both shoulder joints beyond the deck lip, the shoulders' height
//   within 5 cm of the deck top + the rig's chest depth (the front of the chest on the deck, not in it); the rendered
//   body surface (skinned vertices) over the deck never below its top (1.5 cm skinning tolerance);
// - logged, not asserted (engine geometry the renderer cannot change): body vertices inside the joist tails / edge
//   beam beyond the lip, and the rendered sheet's clearance from the deck edge and joist ends while it comes up.
// Captures: lie-down, prone-reach with the sheet below in the givers' hands, the take, push-up, kneel-up, standing.
import { test, expect, type Page } from '@playwright/test';
import { labFrames, openLab } from './lab-helpers';
import { captureView } from './helpers';

type Arm = { side: string; shoulder: number[]; palm: number[]; len: number; target: number[] | null; source: string | null; contact: number; err: number | null; ratio: number | null };
type Prone = { r: number; bend: number; turn: number; yaw: number; w: number } | null;
type Bone = { activity: string; arms: Arm[]; hipY: number; head: number[] | null; prone: Prone; dims: { chestDepth: number; lieHip: number } | null; feet: number[][] };
type Box = { id: string; min: number[]; max: number[] };
const RECEIVERS = ['p3', 'p4'];
const PRONE = ['lie-down', 'prone-wait', 'prone-reach', 'push-up', 'kneel-up'];

type Acc = {
  ticks: number;
  points: number;
  reached: number;
  byAct: Record<string, [number, number]>;
  /** per receiver and activity: points, reached, missed points' ratio range (shoulder → point / arm) */
  byWho: Record<string, [number, number, number, number]>;
  misses: string[];
  unreachable: string[];
  over: string[];
  shoulders: string[];
  chest: { n: number; worst: number; bad: string[] };
  sink: { n: number; worst: number; where: string; by: Record<string, [number, number]> };
  /** the same after the prone phases (stand_with_load, lay, set_down: the posture layer's kneel), logged */
  sinkAfter: { n: number; worst: number; where: string; by: Record<string, [number, number]> };
  members: Record<string, { ticks: number; depth: number; parts: string[] }>;
  sheet: { minGap: number; at: string };
  acts: Record<string, string[]>;
  /** p3's prone layer through the reach and the rise (every 3rd tick) */
  trace: string[];
  prone: Record<string, { bendMax: number; turnMin: number; turnMax: number }>;
  done: boolean;
  tick: number;
};

/** Boxes (axis-aligned: the fixture's members are) of the lab components. */
async function boxes(page: Page) {
  const cs = await page.evaluate(() => (window.__marsEngine as unknown as { components(): { id: string; corners: number[][] }[] }).components());
  const out: Record<string, Box> = {};
  for (const c of cs) out[c.id] = { id: c.id, min: [0, 1, 2].map((k) => Math.min(...c.corners.map((q) => q[k]))), max: [0, 1, 2].map((k) => Math.max(...c.corners.map((q) => q[k]))) };
  return out;
}

/** Run the scenario to the end in the page, checking the receivers every tick. */
async function runChecked(page: Page, B: Record<string, Box>) {
  const acc: Acc = { ticks: 0, points: 0, reached: 0, byAct: {}, byWho: {}, misses: [], unreachable: [], over: [], shoulders: [], chest: { n: 0, worst: 0, bad: [] }, sink: { n: 0, worst: 0, where: '', by: {} }, sinkAfter: { n: 0, worst: 0, where: '', by: {} }, members: {}, sheet: { minGap: Infinity, at: '' }, acts: {}, trace: [], prone: {}, done: false, tick: 0 };
  while (!acc.done && acc.ticks < 20 * 120) {
    Object.assign(
      acc,
      await page.evaluate(
        ([acc, B, RECEIVERS, PRONE]) => {
          type H = { step(n: number): { done: boolean; tick: number }; bones(): Record<string, Bone>; meshPoints(id: string, stride?: number): { p: number[]; part: string }[]; components(): { id: string; rendered: { min: number[]; max: number[] } | null }[]; state(): { humans: { id: string; activity: string }[] } };
          const h = window.__marsEngine as unknown as H;
          const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
          const decks = [B.d0, B.d2], top = B.d0.max[1], lip = B.d0.max[0];
          const members = Object.values(B).filter((b) => /^(j\d|b3)$/.test(b.id));
          // over the deck: inside its outline by 3 cm (a hand reaching round the lip may be just under it)
          const overDeck = (p: number[]) => decks.some((k) => p[0] >= k.min[0] && p[0] <= k.max[0] - 0.03 && p[2] >= k.min[2] && p[2] <= k.max[2]);
          for (let i = 0; i < 100 && !acc.done; i++) {
            const st = h.step(1);
            acc.ticks++;
            acc.tick = st.tick;
            acc.done = st.done;
            const bones = h.bones();
            for (const id of RECEIVERS) {
              const b = bones[id];
              const a = b.activity;
              const l = (acc.acts[id] ??= []);
              if (l[l.length - 1] !== a) l.push(a);
              for (const arm of b.arms) {
                if (d(arm.shoulder, arm.palm) > arm.len + 0.005) acc.over.push(`${st.tick} ${id} ${arm.side}`);
                if (arm.source !== 'hands' || !arm.target) continue;
                acc.points++;
                const ok = arm.err! <= 0.1;
                if (ok) acc.reached++;
                (acc.byAct[a] ??= [0, 0])[0]++;
                if (ok) acc.byAct[a][1]++;
                const pk = `${id} ${a}`;
                (acc.byWho[pk] ??= [0, 0, 9, 0])[0]++;
                if (ok) acc.byWho[pk][1]++;
                else [acc.byWho[pk][2], acc.byWho[pk][3]] = [Math.min(acc.byWho[pk][2], arm.ratio!), Math.max(acc.byWho[pk][3], arm.ratio!)];
                if (!ok && arm.ratio! <= 1.0 && acc.misses.length < 40) acc.misses.push(`${st.tick} ${id} ${a} ${arm.side} err ${arm.err!.toFixed(3)} ratio ${arm.ratio!.toFixed(2)}`);
                if (!ok && arm.ratio! > 1.0 && acc.unreachable.length < 40) acc.unreachable.push(`${st.tick} ${id} ${a} ${arm.side} ratio ${arm.ratio!.toFixed(2)} target ${arm.target.map((x) => x.toFixed(2)).join(',')}`);
              }
              const prone = (PRONE as string[]).includes(a);
              if (!prone && !['stand_with_load', 'lay', 'set_down'].includes(a)) continue;
              if (id === 'p3' && prone && b.prone && st.tick % 3 === 0 && (a === 'push-up' || a === 'kneel-up' || a === 'prone-reach'))
                acc.trace.push(`${st.tick} ${a} r ${b.prone.r.toFixed(2)} pitch ${((b.prone.bend * 180) / Math.PI).toFixed(0)}° turn ${((b.prone.turn * 180) / Math.PI).toFixed(0)}° hip ${(b.hipY - top).toFixed(2)}`);
              if (b.prone && prone) {
                const s = (acc.prone[a] ??= { bendMax: 0, turnMin: 0, turnMax: 0 });
                s.bendMax = Math.max(s.bendMax, b.prone.bend);
                s.turnMin = Math.min(s.turnMin, b.prone.turn);
                s.turnMax = Math.max(s.turnMax, b.prone.turn);
              }
              if (a === 'prone-wait' || a === 'prone-reach') {
                for (const arm of b.arms) if (arm.shoulder[0] <= lip && acc.shoulders.length < 20) acc.shoulders.push(`${st.tick} ${id} ${a} ${arm.side} shoulder x ${arm.shoulder[0].toFixed(3)} ≤ lip ${lip.toFixed(3)}`);
              }
              if (a === 'prone-wait' && b.dims && b.prone && b.prone.bend < 1.6) {
                // lying flat: the shoulders a chest depth above the deck
                const sy = (b.arms[0].shoulder[1] + b.arms[1].shoulder[1]) / 2 - top, want = b.dims.chestDepth;
                acc.chest.n++;
                acc.chest.worst = Math.max(acc.chest.worst, Math.abs(sy - want));
                if (Math.abs(sy - want) > 0.05 && acc.chest.bad.length < 10) acc.chest.bad.push(`${st.tick} ${id} shoulders ${sy.toFixed(3)} above the deck, chest depth ${want.toFixed(3)}`);
              }
              // the rendered surface: over the deck never below its top; inside the members beyond it (logged)
              if (st.tick % 2 === 0) {
                for (const q of h.meshPoints(id, 4)) {
                  if (overDeck(q.p) && q.p[1] < top) {
                    const dd = top - q.p[1];
                    const k = prone ? acc.sink : acc.sinkAfter;
                    if (dd > 0.015) {
                      k.n++;
                      const r = (k.by[`${a}:${q.part}`] ??= [0, 0]);
                      r[0]++;
                      r[1] = Math.max(r[1], dd);
                    }
                    if (dd > k.worst) [k.worst, k.where] = [dd, `${st.tick} ${id} ${a} ${q.part} (${q.p.map((x) => x.toFixed(3)).join(', ')})`];
                  }
                  for (const m of members) {
                    const e = 0.005;
                    if (q.p[0] > m.min[0] + e && q.p[0] < m.max[0] - e && q.p[1] > m.min[1] + e && q.p[1] < m.max[1] - e && q.p[2] > m.min[2] + e && q.p[2] < m.max[2] - e) {
                      const r = (acc.members[`${id} ${m.id}`] ??= { ticks: 0, depth: 0, parts: [] });
                      if (!r.parts.includes(`${a}:${q.part}`)) r.parts.push(`${a}:${q.part}`);
                      r.depth = Math.max(r.depth, Math.min(q.p[1] - m.min[1], m.max[1] - q.p[1], q.p[2] - m.min[2], m.max[2] - q.p[2]));
                      r.ticks++;
                    }
                  }
                }
              }
            }
            // the sheet while it comes up past the edge: its rendered box vs the deck lip / joist ends (logged)
            const ra = bones.p3.activity;
            if (ra === 'prone-reach' || ra === 'push-up' || ra === 'kneel-up') {
              const s1 = h.components().find((c) => c.id === 's1')?.rendered;
              if (s1 && s1.max[1] > B.j1.min[1] - 0.2) {
                const ends = Math.max(...members.filter((m) => m.id.startsWith('j')).map((m) => m.max[0]));
                const gap = s1.min[0] - Math.max(lip, s1.max[1] > B.j1.min[1] ? ends : lip);
                if (gap < acc.sheet.minGap) [acc.sheet.minGap, acc.sheet.at] = [gap, `${st.tick} ${ra} sheet x ${s1.min[0].toFixed(3)} y ${s1.min[1].toFixed(3)}–${s1.max[1].toFixed(3)}`];
              }
            }
          }
          return acc;
        },
        [acc, B, RECEIVERS, PRONE] as const,
      ),
    );
  }
  return acc;
}

function report(name: string, acc: Acc) {
  const acts = Object.entries(acc.byAct).map(([k, [n, ok]]) => `${k} ${ok}/${n}`).join(', ');
  console.log(`[prone] ${name}: ${acc.ticks} ticks, receiver hand points ${acc.points}, reached ≤ 0.1 m ${acc.reached}; by activity: ${acts}`);
  console.log(`[prone] ${name}: per receiver (reached / points, misses' shoulder→point ratio): ${Object.entries(acc.byWho).filter(([k]) => /(reach|push|kneel|stand)/.test(k)).map(([k, [n, ok, lo, hi]]) => `${k} ${ok}/${n}${ok < n ? ` (${lo.toFixed(2)}–${hi.toFixed(2)})` : ''}`).join(', ')}`);
  console.log(`[prone] ${name}: activities ${Object.entries(acc.acts).map(([k, l]) => `${k}: ${l.join(' → ')}`).join(' | ')}`);
  console.log(`[prone] ${name}: prone layer ${Object.entries(acc.prone).map(([k, s]) => `${k} bend ≤ ${((s.bendMax * 180) / Math.PI).toFixed(0)}° turn ${((s.turnMin * 180) / Math.PI).toFixed(0)}…${((s.turnMax * 180) / Math.PI).toFixed(0)}°`).join(', ')}`);
  console.log(`[prone] ${name}: lying chest ${acc.chest.n} ticks, worst |shoulders − (deck + chest depth)| ${acc.chest.worst.toFixed(3)} m; surface over the deck below its top: worst ${acc.sink.worst.toFixed(3)} m at ${acc.sink.where || '-'} (${acc.sink.n} vertices > 1.5 cm)`);
  const by = (k: Acc['sink']) => Object.entries(k.by).map(([w, [n, dd]]) => `${w} ${n} ≤ ${dd.toFixed(3)}`).join(', ') || 'none';
  console.log(`[prone] ${name}: below the deck top by > 1.5 cm (vertex samples, by activity:part): ${by(acc.sink)} | after: ${by(acc.sinkAfter)}`);
  console.log(`[prone] ${name}: after the prone phases (stand_with_load / lay / set_down), surface over the deck below its top: worst ${acc.sinkAfter.worst.toFixed(3)} m at ${acc.sinkAfter.where || '-'} (${acc.sinkAfter.n} vertices > 1.5 cm)`);
  console.log(`[prone] ${name}: body inside members: ${Object.entries(acc.members).map(([k, r]) => `${k} ${r.ticks} vertex-ticks, ≤ ${r.depth.toFixed(3)} m deep (${r.parts.join(' ')})`).join(' | ') || 'none'}`);
  console.log(`[prone] ${name}: sheet vs deck edge / joist ends while coming up: min gap ${acc.sheet.minGap.toFixed(3)} m at ${acc.sheet.at}`);
  console.log(`[prone] ${name}: p3 through the reach and rise: ${acc.trace.join(' | ')}`);
  if (acc.unreachable.length) console.log(`[prone] ${name}: beyond the arm (hang): ${acc.unreachable.slice(0, 12).join(' | ')}`);
  if (acc.misses.length) console.log(`[prone] ${name}: rig-reachable misses: ${acc.misses.slice(0, 12).join(' | ')}`);
}

for (const name of ['prone', 'prone-forks']) {
  test(`${name}: prone receivers — hands on the engine points, lying on the deck (not in it), shoulders over the edge`, async ({ page }) => {
    test.setTimeout(600_000);
    await openLab(page, name);
    const st = await page.evaluate((n) => window.__marsEngine!.runScenario(n, { paused: true }), name);
    expect(st.scenario).toBe(name);
    const B = await boxes(page);
    const acc = await runChecked(page, B);
    report(name, acc);
    const end = await page.evaluate(() => window.__marsEngine!.state());
    for (const c of end.checks) expect(c.ok, c.message).toBe(true);
    // off the forks the sheet is already there when they are down: no wait
    const phases = ['lie-down', ...(name === 'prone' ? ['prone-wait'] : []), 'prone-reach', 'push-up', 'kneel-up', 'stand_with_load', 'lay', 'set_down'];
    for (const id of RECEIVERS) expect(acc.acts[id].filter((a) => a !== 'idle' && a !== 'walk')).toEqual(phases);
    expect(acc.over, 'no arm longer than its bones').toEqual([]);
    expect(acc.misses, 'every rig-reachable engine hand point reached within 0.1 m').toEqual([]);
    expect(acc.shoulders, 'lying, both shoulders beyond the deck lip').toEqual([]);
    expect(acc.chest.bad, 'lying flat, the shoulders a chest depth above the deck (± 5 cm)').toEqual([]);
    expect(acc.sink.n, `rendered body over the deck below its top (worst ${acc.sink.worst.toFixed(3)} m at ${acc.sink.where})`).toBe(0);
  });
}

/** Step until `pred` holds for the page's lab state (a function source over the hook). */
async function stepUntil(page: Page, pred: string, max = 20 * 60) {
  return page.evaluate(
    ([src, n]) => {
      const h = window.__marsEngine! as unknown as { step(n: number): unknown };
      const f = new Function('h', `return (${src})(h)`) as (h: unknown) => boolean;
      for (let i = 0; i < (n as number); i++) {
        if (f(h)) return true;
        h.step(1);
      }
      return f(h);
    },
    [pred, max] as const,
  );
}
const act = (id: string, a: string) => `(h) => h.state().humans.find((q) => q.id === '${id}').activity === '${a}'`;

/** Oblique from the south-east (both receivers, the deck edge and the sheet below), or head-on from the east. */
async function view(page: Page, kind: 'se' | 'e') {
  const [pos, t] = kind === 'se' ? [[3.1, 3.6, -2.4], [0.7, 2.25, 1.1]] : [[3.9, 3.0, 0.4], [0.6, 2.4, 1.0]];
  await page.evaluate(([p, q]) => window.__marsEngine!.camera(p, q), [pos, t]);
  await labFrames(page, 4);
}

test('prone: captures (lie down, reach with the sheet below, take, push-up, kneel-up, standing)', async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  await openLab(page, 'prone');
  await page.addStyleTag({ content: '.lab-perf { visibility: hidden }' });
  await page.evaluate(() => window.__marsEngine!.runScenario('prone', { paused: true }));
  const shot = async (name: string, kind: 'se' | 'e', compare = false) => {
    await view(page, kind);
    const st = await page.evaluate(() => window.__marsEngine!.state());
    console.log(`[prone] ${name} tick ${st.tick}: ${st.humans.map((q) => `${q.id}:${q.activity}`).join(' ')}`);
    await captureView(page, name, { testInfo, compare });
  };
  // lying down: half way from kneeling to the deck
  expect(await stepUntil(page, act('p3', 'lie-down'))).toBe(true);
  await page.evaluate(() => window.__marsEngine!.step(7));
  await shot('prone-lie-down', 'se');
  // reaching down, the sheet below in the givers' hands
  expect(await stepUntil(page, act('p3', 'prone-reach'), 20 * 40)).toBe(true);
  await page.evaluate(() => window.__marsEngine!.step(9));
  await shot('prone-reach', 'se', true);
  // the take: its last tick (the givers let go at its end)
  expect(await stepUntil(page, `(h) => { const n = h.state(); const p3 = n.humans.find((q) => q.id === 'p3'); return p3.activity === 'prone-reach' && n.humans.find((q) => q.id === 'p1').activity !== 'reach_up'; }`)).toBe(true);
  await page.evaluate(() => window.__marsEngine!.step(0));
  await shot('prone-take', 'e');
  // push-up: the free hand back on the deck, the other on the sheet
  expect(await stepUntil(page, act('p3', 'push-up'))).toBe(true);
  await page.evaluate(() => window.__marsEngine!.step(16));
  await shot('prone-push-up', 'se', true);
  await shot('prone-push-up-e', 'e');
  expect(await stepUntil(page, act('p3', 'kneel-up'))).toBe(true);
  await page.evaluate(() => window.__marsEngine!.step(8));
  await shot('prone-kneel-up', 'se');
  expect(await stepUntil(page, act('p3', 'lay'))).toBe(true);
  await shot('prone-standing', 'se', true);
});
