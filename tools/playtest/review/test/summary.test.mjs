import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { reviewRun } from '../reviewer.mjs';
import { reportRun } from '../report.mjs';
import { buildSummary, sipsThumb } from '../summary.mjs';
import { copyRuns, fakeReviewer, MAIN } from './helpers.mjs';

const hasSips = (() => { try { execFileSync('sips', ['--help'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const thumb = hasSips ? sipsThumb : (src, dst) => copyFileSync(src, dst);

async function summary() {
  const r = copyRuns(); await reviewRun({ runDir: r.main, call: fakeReviewer(), log: () => {} }); reportRun(r.main);
  mkdirSync(join(r.main, 'specs'), { recursive: true });
  writeFileSync(join(r.main, 'specs', 'I-1.md'), '# Draft\n\n**Issue**\n\nCard says Pip arrived at the library while she stands still\n');
  writeFileSync(join(r.main, 'COORDINATOR-NOTES.md'), 'Harness caveat: the shots under /home/someone/sim/.local/playtest/runs/x/shots were late. Second sentence.\n');
  const night = join(dirname(r.runs), 'NIGHT.md');
  writeFileSync(night, '# Playtest night log — 2026-10-24/25\n\n## 06:30 memory, not CPU\n\nThe laptop is memory-bound: 46 of 48 GB used. Speed measures in every report tonight are "under load" and relative.\n\n## Open harness items\n\nWake latency under load; god oracles minimal.\n\n## 09:20 last entry\n\nQuiet machine now.\n');
  const out = join(dirname(r.runs), 'site', 'index.html'); const assets = join(dirname(r.runs), 'site', 'assets');
  const res = buildSummary({ runsRoot: r.runs, outFile: out, assetsDir: assets, nightLog: night, thumb });
  return { ...r, res, html: readFileSync(out, 'utf8'), assets };
}

test('summary renders every section in order from the fixture run', async () => {
  const { html, res } = await summary();
  assert.equal(res.runs, 1, 'only the run with evidence and a ledger counts');
  const order = ['Playtest, first night', 'id="basics"', 'id="egregious"', 'id="wanted"', 'id="issues"', 'id="drafts"', 'id="runs"', 'id="harness"'];
  let at = -1; for (const h of order) { const i = html.indexOf(h); assert.ok(i > at, `${h} present and in order`); at = i; }
  assert.match(html, /memory-bound: 46 of 48 GB/); assert.match(html, /under load/);
  assert.match(html, /Harness caveat: the shots under runs\/x\/shots were late\./, 'coordinator note first sentence, path scrubbed');
  assert.ok(!html.includes('Second sentence'));
  assert.match(html, /Wake latency under load\./); assert.match(html, /God oracles minimal\./);
  assert.match(html, /<td data-l="W" class="n">/);
  assert.match(html, /Greet animals|say hi to the duck/);
  assert.match(html, /O4<\/th>/);
  assert.match(html, new RegExp(`href="\\.\\./runs/${MAIN}/REPORT\\.md"`));
  assert.match(html, new RegExp(`href="\\.\\./runs/booklet/${MAIN}\\.html"`));
  assert.match(html, new RegExp(`href="\\.\\./runs/${MAIN}/specs/I-1\\.md"`));
  assert.ok(Buffer.byteLength(html) < 300 * 1024);
});

test('no absolute paths in the page outside Developer-draft links; thumbnails are relative jpgs in assets', async () => {
  const { html, assets } = await summary();
  const drafts = html.slice(html.indexOf('id="drafts"'), html.indexOf('id="runs"'));
  const outside = html.replace(drafts, '');
  assert.ok(!/\/Users\//.test(outside), 'no /Users path outside drafts');
  assert.ok(!/(src|href)="\/(?!\/)/.test(outside), 'no absolute src/href');
  assert.ok(!/data:image/.test(html), 'no base64 images');
  assert.ok(!/<(script|link)\b/.test(html), 'self-contained');
  const imgs = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(imgs.length >= 1, 'the egregious failure has a thumbnail');
  for (const s of imgs) { assert.match(s, /^assets\/[\w.-]+\.jpg$/); assert.ok(existsSync(join(assets, s.slice('assets/'.length)))); }
  assert.ok(readdirSync(assets).every((f) => f.endsWith('.jpg')));
});
