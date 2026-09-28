// Capture-only (NOT in the gate): the pictures for docs/engineering/questions/index.html.
// QUESTIONS_CAPTURE=1 E2E_VITE_PORT=5611 E2E_RUN=w41 npx playwright test -c e2e/playwright.config.ts questions-captures.spec.ts
// Optional QUESTIONS_ONLY=<regex on the shot name>. Writes JPEGs next to the page; LOOK at each one before using it.
// The outlines / labels come from the lab hook `highlight(ids, label, opts)` (app/lab/highlight.ts).
// Then: python3 ../docs/engineering/questions/tools/compass.py (Q3 compass on q03-2022-top.jpg); option diagrams:
// python3 ../docs/engineering/questions/tools/diagrams.py; page: node deploy/questions-html.mjs.
import { test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openLab, labFrames } from './lab-helpers.ts';

const OUT = path.resolve(import.meta.dirname, '../../docs/engineering/questions');
const ONLY = process.env.QUESTIONS_ONLY ? new RegExp(process.env.QUESTIONS_ONLY) : null;

type Box = { min: number[]; max: number[] };
type Mark = { ids: string[]; label?: string; opts?: { color?: string; width?: number; height?: number; single?: boolean; lift?: number } };
/** Camera: explicit [pos, target]; `top` straight down over the marks (span m across); `eye` from an offset of the marks' centre. */
type Cam = { at: [number[], number[]] } | { top: number; centre?: number[] } | { eye: number[]; look?: number[] } | { preset: string };
type Shot = {
  name: string;
  scenario: string;
  /** Advance the scenario: run until these sequence steps complete, or n ticks. */
  until?: string[];
  ticks?: number;
  marks: Mark[];
  cam: Cam;
};

// Scene-file lookups (public/engine/campus-<year>.json obstacle rows: id, kind, cx, cz, hx, hz, yaw, y0, y1, …).
type Row = [string, string, number, number, number, number, number, number, number];
const rows = (year: number): Row[] => JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, `../public/engine/campus-${year}.json`), 'utf8')).obstacles;
const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;
/** Base ids (without `.up`) + `*`, so the ground band and the upper band of one part both outline. */
function pick(year: number, prefix: string, pred: (r: Row) => boolean): string[] {
  const ids = rows(year).filter((r) => r[0].startsWith(prefix) && pred(r)).map((r) => r[0].replace(/\.up$/, '') + '*');
  if (!ids.length) throw Error(`no ${prefix} rows match in ${year}`);
  return [...new Set(ids)];
}
const BLUE = { color: '#1f6fff', width: 0.04 };
const HOUSES_2022 = (w = 0.1) => ['chiba', 'east-house', 'kitchen', 'west-house'].map((id) => ({ ids: [id], label: ({ chiba: 'Chiba', 'east-house': 'east house', kitchen: 'kitchen', 'west-house': 'west house' } as Record<string, string>)[id], opts: { color: '#1f6fff', width: w, height: 0.3, lift: 0.2 } }));
const ORANGE = '#ff8a00';

const SHOTS: Shot[] = [
  // Q3 north: the model's map (compass drawn afterwards by the page generator's caption; see index.html)
  { name: 'q03-2022-top', scenario: 'year-2022', marks: HOUSES_2022(0.12), cam: { top: 52, centre: [0, 0, 0] } },
  // Q2 trailers inside Chiba
  {
    name: 'q02-2023-eye',
    scenario: 'year-2023',
    marks: [{ ids: ['rv-8', 'rv-9'], label: 'trailer parked under the roof?' }, { ids: ['chiba'], label: 'Chiba', opts: { color: '#1f6fff', height: 5.2, width: 0.05 } }],
    cam: { eye: [6, 4.5, 34], look: [0, 1.5, 0] },
  },
  { name: 'q02-2023-top', scenario: 'year-2023', marks: [{ ids: ['rv-8', 'rv-9'], label: 'trailer' }, { ids: ['chiba'], label: 'Chiba', opts: { color: '#1f6fff', height: 5.2, width: 0.1 } }], cam: { top: 64, centre: [0, 0, 16] } },
  {
    name: 'q02-2024-eye',
    scenario: 'year-2024',
    marks: [{ ids: ['rv-9', 'rv-10'], label: 'trailer parked under the roof?' }, { ids: ['chiba'], label: 'Chiba', opts: { color: '#1f6fff', height: 5.2, width: 0.05 } }],
    cam: { eye: [6, 4.5, 34], look: [0, 1.5, 0] },
  },
  { name: 'q02-2024-top', scenario: 'year-2024', marks: [{ ids: ['rv-9', 'rv-10'], label: 'trailer' }, { ids: ['chiba'], label: 'Chiba', opts: { color: '#1f6fff', height: 5.2, width: 0.1 } }], cam: { top: 64, centre: [0, 0, 16] } },
  // Q1 2022 south-west corner: the west-house table in the gap
  {
    name: 'q01-2022-eye',
    scenario: 'year-2022',
    marks: [
      { ids: ['west-house-table-*'], label: 'table closing the corner?', opts: { single: true, width: 0.04 } },
    ],
    cam: { eye: [3.2, 1.8, 11], look: [-0.5, 0.6, -1] },
  },
  { name: 'q01-2022-top', scenario: 'year-2022', marks: [{ ids: ['west-house-table-*'], label: 'table', opts: { single: true, width: 0.06 } }, ...HOUSES_2022(0.06)], cam: { top: 30, centre: [-4, 0, 3] } },
  // Q9 / Q10 / Q8 decks: a 4 ft x 15 ft strip on the beams (Kit drawing, 2022 east house)
  {
    name: 'q09-2022-deck-eye',
    scenario: 'year-2022',
    marks: [
      { ids: ['east-house-plywood-deck-sheet-141763ed*'], label: 'deck strip, 4 ft × 15 ft', opts: { width: 0.03, lift: 1.2 } },
      { ids: pick(2022, 'east-house-12-foot-orange-beam', (r) => (near(r[2], 6.314) || near(r[2], 10.886)) && near(r[3], -3.486) && near(r[8], 2.54)), /* W51: Cahuilla +5 m in z (pinwheel shift −2) */ label: 'beam', opts: { ...BLUE, lift: 0.5 } },
    ],
    cam: { eye: [6.0, 4.0, 4.0], look: [-0.8, 2.3, 0] },
  },
  // Q12 stair: treads outlined, first step, rail posts inside the end frame
  {
    name: 'q12-2022-stair-eye',
    scenario: 'year-2022',
    marks: [
      { ids: ['east-house-stair-tread-*'], label: 'stair: 8 treads, no side boards drawn', opts: { single: true, width: 0.03, lift: 1.2 } },
      { ids: ['east-house-stair-tread-42ee66fc*'], label: 'first step 55 cm up', opts: { color: ORANGE, width: 0.04, lift: 0.1 } },
    ],
    cam: { eye: [-8.5, 2.3, 3.5], look: [0, 1.0, -0.5] },
  },
  // Q13 solar: the modules over the roof
  {
    name: 'q13-2022-solar-eye',
    scenario: 'year-2022',
    marks: [{ ids: ['east-house-solar-panel-*'], label: 'solar modules: what held them up?', opts: { single: true, width: 0.03, lift: 0.6 } }],
    cam: { eye: [-11, 10, 7], look: [0, 4.4, 0] },
  },
  // Q11 walls: panels outside the beam line (east side)
  {
    name: 'q11-2022-wall-eye',
    scenario: 'year-2022',
    marks: [
      { ids: pick(2022, 'east-house-plywood-wall', (r) => near(r[2], 10.886) && near(r[4], 0.027, 0.005)), label: 'wall panels (drawn outside the beams)', opts: { single: true, width: 0.03, lift: 0.4 } },
      { ids: pick(2022, 'east-house-12-foot-orange-beam', (r) => near(r[2], 10.886) && near(r[8], 2.54)), label: 'beam line', opts: { ...BLUE, single: true, lift: 2.4 } },
    ],
    cam: { eye: [9, 3.2, 9], look: [0, 1.4, -2] },
  },
  // Q19 roof: sheets straight on the top beams
  {
    name: 'q19-2022-roof-eye',
    scenario: 'year-2022',
    marks: [
      { ids: pick(2022, 'east-house-plywood-deck-sheet', (r) => near(r[8], 4.892)).slice(0, 3), label: 'roof sheets straight on the top beams', opts: { single: true, width: 0.03, lift: 0.9 } },
      { ids: pick(2022, 'east-house-12-foot-orange-beam', (r) => near(r[8], 4.817) && near(r[2], 10.886)), label: 'top beam', opts: { ...BLUE, single: true, lift: 0.3 } },
    ],
    cam: { eye: [8, 8.5, 9], look: [0, 4.2, -2] },
  },
  // Q6 beam heights: one frame line of the east house, three levels
  {
    name: 'q06-2022-beams-eye',
    scenario: 'year-2022',
    marks: [
      { ids: ['east-house-12-foot-orange-beam-0e197289*'], label: 'low beam 22 cm', opts: { width: 0.04, lift: 0.1 } },
      { ids: ['east-house-12-foot-orange-beam-6b514974*'], label: 'middle beam 2.48 m', opts: { width: 0.04, lift: 0.1 } },
      { ids: ['east-house-12-foot-orange-beam-91b67b6d*'], label: 'top beam 4.76 m', opts: { width: 0.04, lift: 0.1 } },
    ],
    cam: { eye: [-9, 2.6, 3.5], look: [0, 2.2, 0] },
  },
  // Q7 stock: the year-build pile yard at the start
  { name: 'q07-yard', scenario: 'year-build-2022', marks: [{ ids: ['@piles'] }], cam: { eye: [1, 10, 14], look: [-6, 0, -1] } },
  // Q14 upper floors: the top beam passed up the frame bracing
  { name: 'q14-relay', scenario: 'year-build-2022', ticks: 11912, marks: [{ ids: ['@held'], label: 'top beam passed up by hand' }], cam: { eye: [-7, 3.5, 7], look: [0, 3, 0] } },
  // W44 site-axis cards (A3 follow-ups). Top-downs: screen up = world −Z, right = +X; the side-by-side with the
  // drone still and the north arrows is drawn afterwards by ../docs/engineering/questions/tools/axis.py.
  // Q20 2022 mirrored: the four houses' pinwheel
  { name: 'q20-2022-top', scenario: 'year-2022', marks: HOUSES_2022(0.14), cam: { top: 34, centre: [0, 0, 0] } },
  { name: 'q20-2022-eye', scenario: 'year-2022', marks: HOUSES_2022(0.08), cam: { at: [[20, 11, 24], [0, 0.5, 0]] } },
  // Q21 2024: kitchen and trailer ring south of Chiba in the model
  ...(['top', 'eye'] as const).map((k): Shot => ({
    name: `q21-2024-${k}`,
    scenario: 'year-2024',
    marks: [
      { ids: ['chiba'], label: 'Chiba', opts: { color: '#1f6fff', height: 5.2, width: k === 'top' ? 0.14 : 0.06 } },
      { ids: ['kitchen'], label: 'kitchen', opts: { color: ORANGE, height: 4, width: k === 'top' ? 0.14 : 0.06 } },
      { ids: Array.from({ length: 18 }, (_, i) => `rv-${i + 1}`), label: 'trailer ring', opts: { single: true, width: k === 'top' ? 0.12 : 0.05, height: 3 } },
    ],
    cam: k === 'top' ? { top: 74, centre: [0, 0, 20] } : { at: [[-78, 16, 21], [0, 1.5, 20]] },
  })),
  // Q22 2026: which way is north (Chiba outlined; the arrows are drawn by axis.py)
  { name: 'q22-2026-top', scenario: 'year-2026', marks: [{ ids: ['chiba'], label: 'Chiba', opts: { color: '#1f6fff', height: 6, width: 0.2 } }], cam: { top: 96, centre: [12, 0, -4] } },
  { name: 'q22-2026-eye', scenario: 'year-2026', marks: [{ ids: ['chiba'], label: 'Chiba', opts: { color: '#1f6fff', height: 6, width: 0.07 } }], cam: { eye: [34, 3.5, 30], look: [0, 3, 0] } },
];

type Hook = {
  runScenario(n: string, o?: { paused?: boolean }): unknown;
  backdropReady: boolean;
  step(n: number): unknown;
  runUntilSteps(ids: string[], status?: string, max?: number): { reached: boolean };
  highlight(ids: string[], label?: string, opts?: Mark['opts']): { found: string[]; missing: string[]; box: Box };
  clearHighlights(): void;
  camera(p: number[], t: number[]): void;
  cameraPreset(k: string): void;
  heldItems(): { id: string; def: string }[];
  yearBuild(): { piles: { id: string; def: string }[] } | null;
};
/** Friendly names for pile kinds (fixture defs). */
function pileLabel(def: string) {
  if (/cut/.test(def)) return 'cutting station';
  if (/ply/.test(def)) return 'plywood stack';
  if (/upright|frame/.test(def)) return 'frames lying flat';
  if (/beam/.test(def)) return 'beam bundle';
  if (/2x|lumber|timber/.test(def)) return 'lumber';
  return def.replace(/-/g, ' ');
}
/** Expand page-side tokens: `@held` (the item in someone's hands), `@piles` (one mark per pile kind). */
async function expand(page: Page, marks: Mark[]): Promise<Mark[]> {
  const out: Mark[] = [];
  for (const m of marks) {
    if (m.ids[0] === '@held') {
      // in someone's hands, else a part being set in place (support `held`)
      const cs = await page.evaluate(() => (window.__marsEngine as unknown as { components(): { id: string; support?: string }[] }).components());
      const held = [...(await page.evaluate(() => (window.__marsEngine as unknown as Hook).heldItems())), ...cs.filter((c) => c.support === 'held')];
      if (!held.length) throw Error('@held: nothing is held at this tick');
      out.push({ ...m, ids: [held[0].id] });
    } else if (m.ids[0] === '@piles') {
      const yb = await page.evaluate(() => (window.__marsEngine as unknown as Hook).yearBuild());
      const groups = new Map<string, string[]>();
      for (const p of yb!.piles) {
        const k = pileLabel(p.def);
        groups.set(k, [...(groups.get(k) ?? []), p.id]);
      }
      const colors = ['#ff2a2a', '#1f6fff', '#ff8a00', '#9b30ff', '#00a86b'];
      // label one pile of each kind (a label over the group centroid can land on something else); outline them all
      [...groups].forEach(([label, ids], i) => {
        const opts = { width: 0.04, color: colors[i % colors.length], lift: 0.15 };
        out.push({ ids: [ids[0]], label: `${label} (${ids.length} in the yard)`, opts });
        if (ids.length > 1) out.push({ ids: ids.slice(1), opts });
      });
    } else out.push(m);
  }
  return out;
}

async function take(page: Page, s: Shot) {
  await page.evaluate((n) => (window.__marsEngine as unknown as Hook).runScenario(n, { paused: true }), s.scenario);
  await page.waitForFunction(() => (window.__marsEngine as unknown as Hook).backdropReady, null, { timeout: 90_000 });
  if (s.until) {
    const r = await page.evaluate((ids) => (window.__marsEngine as unknown as Hook).runUntilSteps(ids, 'completed', 400_000), s.until);
    if (!r.reached) throw Error(`${s.name}: steps ${s.until.join(', ')} not reached`);
  }
  if (s.ticks) await page.evaluate((n) => (window.__marsEngine as unknown as Hook).step(n), s.ticks);
  const boxes: Box[] = [];
  for (const m of await expand(page, s.marks)) {
    const r = await page.evaluate((mm) => (window.__marsEngine as unknown as Hook).highlight(mm.ids, mm.label, mm.opts), m);
    if (r.missing.length) throw Error(`${s.name}: highlight missing ${r.missing.join(', ')}`);
    boxes.push(r.box);
  }
  const c = [0, 1, 2].map((k) => (boxes[0].min[k] + boxes[0].max[k]) / 2); // the first mark is the subject
  let pos: number[], target: number[];
  if ('preset' in s.cam) {
    const k = s.cam.preset;
    await page.evaluate((kk) => (window.__marsEngine as unknown as Hook).cameraPreset(kk), k);
    await labFrames(page, 6);
    await page.locator('.lab-stage').screenshot({ path: path.join(OUT, `${s.name}.jpg`), type: 'jpeg', quality: 86 });
    return;
  }
  if ('at' in s.cam) [pos, target] = s.cam.at;
  else if ('top' in s.cam) {
    const t = s.cam.centre ?? [c[0], 0, c[2]];
    pos = [t[0], s.cam.top * 1.21, t[2] + 0.01];
    target = [t[0], 0, t[2]];
  } else {
    pos = [c[0] + s.cam.eye[0], s.cam.eye[1], c[2] + s.cam.eye[2]];
    target = s.cam.look ? [c[0] + s.cam.look[0], s.cam.look[1], c[2] + s.cam.look[2]] : [c[0], c[1], c[2]];
  }
  await page.evaluate(([p, t]) => (window.__marsEngine as unknown as Hook).camera(p, t), [pos, target]);
  await labFrames(page, 6);
  await page.locator('.lab-stage').screenshot({ path: path.join(OUT, `${s.name}.jpg`), type: 'jpeg', quality: 86 });
}

test.describe('question captures', () => {
  test.skip(process.env.QUESTIONS_CAPTURE !== '1', 'capture-only: set QUESTIONS_CAPTURE=1');
  test('capture every question picture', async ({ page }) => {
    test.setTimeout(1_200_000);
    await openLab(page);
    await page.addStyleTag({ content: '.lab { grid-template-columns: 1fr 0 !important } .lab-perf, .lab-hud, .lab-banners, .lab-verdict { display: none !important }' });
    await labFrames(page, 3);
    for (const s of SHOTS) if (!ONLY || ONLY.test(s.name)) await take(page, s);
  });
});
