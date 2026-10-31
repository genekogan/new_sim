import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRun } from '../run.mjs';
import { reviewRun } from '../reviewer.mjs';
import { buildStory, renderStoryHtml, storyLines, writeStory } from '../story.mjs';
import { copyRuns, fakeReviewer, FIX, MAIN } from './helpers.mjs';

// A retained real run (not in the repo), e.g. …/playtest/runs/20261025-104004-newcomer-opus-1-4119.
const REAL = process.env.PLAYTEST_REAL_RUN ?? '';
const all = (s) => Object.values(s.seats).flatMap((x) => x.moments);
const says = (run) => Object.entries(run.personas).flatMap(([seat, p]) => p.turns.filter((t) => t.decision?.say?.text).map((t) => ({ seat, text: t.decision.say.text })));

function invariants(run, story, max) {
  const ms = all(story);
  assert.ok(ms.length >= 1, 'has moments');
  const protectedCount = says(run).length + run.evidence.length + Object.keys(run.personas).length;
  assert.ok(ms.filter((m) => m.kind !== 'gap').length <= Math.max(max, protectedCount), `within bounds: ${ms.length}`);
  for (const s of says(run)) assert.ok(ms.some((m) => m.seat === s.seat && (m.persona?.said ?? '').includes(s.text)), `request send kept: ${s.text}`);
  for (const x of Object.values(story.seats)) x.moments.forEach((m, i, a) => i && assert.ok(m.t >= a[i - 1].t, 'per-seat times monotonic'));
  story.merged.forEach((m, i, a) => i && assert.ok(m.t >= a[i - 1].t, 'merged times monotonic'));
  const hasShots = Object.keys(run.personas).some((p) => existsSync(join(run.runDir, 'personas', p, 'shown'))) || run.shotsIndex.length;
  if (hasShots) for (const m of ms) assert.ok(m.shot, `moment at ${m.t} has a shot`);
  for (const m of ms.filter((x) => x.shot)) { assert.ok(!m.shot.startsWith('/') && !m.shot.includes('..'), `relative: ${m.shot}`); assert.ok(existsSync(join(run.runDir, m.shot)), `exists: ${m.shot}`); }
}

test('fixture run: bounds, sends never dropped, monotonic times, shots on every moment, relative paths', async () => {
  const r = copyRuns(); await reviewRun({ runDir: r.main, call: fakeReviewer(), log: () => {} });
  const run = loadRun(r.main);
  for (const max of [30, 6, 3]) invariants(run, buildStory(run, { maxMoments: max }), max);
  const s = buildStory(run, { maxMoments: 3 });
  for (const ev of run.evidence) assert.ok(all(s).some((m) => (m.verdicts ?? [m.verdict]).some((v) => v?.requestId === ev.requestId)), `verdict for ${ev.requestId} survives`);
  assert.ok(all(s).some((m) => m.verdict?.fidelity === 'M' && m.verdict.issueId), 'issue linked on the M verdict');
});

test('long quiet stretches get one gap frame from their middle', () => {
  const run = loadRun(join(FIX, MAIN));
  const s = buildStory(run, { maxMoments: 3, gapSec: 20 });
  const gaps = all(s).filter((m) => m.kind === 'gap');
  assert.ok(gaps.length >= 1, 'gap inserted'); assert.match(gaps[0].title, /^nothing visible happened for \d+ s$/); assert.ok(gaps[0].shot);
  assert.equal(all(buildStory(run, { maxMoments: 30, gapSec: 10_000 })).filter((m) => m.kind === 'gap').length, 0);
});

test('html fragment uses paths relative to relTo; standalone page inlines thumbnails and stays small', () => {
  const r = copyRuns(); const run = loadRun(r.main); const story = buildStory(run);
  const frag = renderStoryHtml(story, run, { relTo: join(r.runs, 'booklet') });
  assert.match(frag, /class="st-film"/); assert.match(frag, /src="\.\.\/20261024-120000-fixture-newcomer-1\/personas\/pip\/shown\/\d+\.png"/);
  assert.ok(!/src="\//.test(frag), 'no absolute image paths');
  const lines = storyLines(story, run); assert.equal(lines.length, story.merged.length); for (const l of lines) assert.match(l, /^\d+:\d\d · \S/);
  const w = writeStory(r.main, { run });
  const html = readFileSync(w.path, 'utf8');
  assert.ok(w.bytes < 4_000_000); assert.match(html, /data:image\/jpeg;base64,/); assert.ok(!html.includes(r.main), 'no absolute run paths');
  assert.ok(existsSync(join(r.main, 'story.json')));
});

test('real Opus Newcomer run (when present): ≤ 30 moments plus gaps, every request send kept', { skip: !existsSync(REAL) }, () => {
  const run = loadRun(REAL); const s = buildStory(run);
  invariants(run, s, 30);
  assert.ok(s.merged.filter((m) => m.kind !== 'gap').length <= 30);
  assert.ok(s.merged.some((m) => m.verdict?.fidelity === 'W'), 'W verdicts on the timeline');
});
