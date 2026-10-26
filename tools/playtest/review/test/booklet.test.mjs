import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname, resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { reviewRun } from '../reviewer.mjs';
import { reportRun } from '../report.mjs';
import { buildBooklet, esc, md2html } from '../booklet.mjs';
import { readJsonl } from '../../lib/jsonl.mjs';
import { copyRuns, fakeReviewer, MAIN, PREV } from './helpers.mjs';

async function booklet() {
  const r = copyRuns(); await reviewRun({ runDir: r.main, call: fakeReviewer(), log: () => {} }); reportRun(r.main);
  const out = buildBooklet({ runsRoot: r.runs });
  return { ...r, out, index: readFileSync(out.index, 'utf8'), page: readFileSync(join(out.outDir, `${MAIN}.html`), 'utf8') };
}

test('index lists the runs newest first with scorecard, chips and the egregious strip', async () => {
  const { index, out, runs } = await booklet();
  assert.equal(out.outDir, join(runs, 'booklet'));
  assert.ok(index.includes(`href="${MAIN}.html"`)); assert.ok(index.includes(`href="${PREV}.html"`));
  assert.ok(index.indexOf(MAIN) < index.indexOf(PREV), 'newest first');
  assert.match(index, /Egregious failures/); assert.match(index, /Harness caveats/);
  assert.match(index, /class="chip fH">H 1</); assert.match(index, /class="chip fP">P 1</);
  assert.match(index, /walk \d+%/);
  assert.match(index, /no-progress fail/); assert.ok(index.includes('&quot;go to the library&quot;') || index.includes('"go to the library"'));
});

test('run page tells the whole story: setup, every request, every persona thought, chips, drafts, raw links', async () => {
  const { page, main } = await booklet();
  for (const h of ['id="setup"', 'id="play"', 'id="review"', 'id="drafts"', 'id="harness"', 'id="raw"']) assert.ok(page.includes(h), h);
  for (const t of ['sit down', 'say hi to the duck', 'go to the library']) assert.ok(page.includes(esc(t)), t);
  for (const t of readJsonl(join(main, 'personas/pip/turns.jsonl'))) assert.ok(page.includes(esc(t.decision.thought)), t.decision.thought);
  assert.match(page, /class="chip fH"/); assert.match(page, /class="chip fM"/);
  assert.match(page, /class="chip o-pass"/); assert.match(page, /class="chip o-fail"/);
  assert.match(page, /Make me a Soul in this world/); assert.match(page, /Pip is here, standing in the plaza/);
  assert.ok(page.indexOf('glance 1') < page.indexOf('id="r1"') && page.indexOf('id="r1"') < page.indexOf('id="r3"'), 'timeline in order');
  assert.match(page, /href="\.\.\/[^"]+\/REPORT\.md"/);
});

test('every src/href is relative to the booklet folder and resolves to a file', async () => {
  const { page, index, out } = await booklet();
  for (const html of [page, index]) {
    const refs = [...html.matchAll(/(?:src|href)="([^"#]+)/g)].map((m) => m[1]).filter((u) => !/^https?:/.test(u));
    assert.ok(refs.length > 5);
    for (const u of refs) { assert.ok(!u.startsWith('/') && !u.startsWith('file:'), u); assert.ok(existsSync(resolve(out.outDir, u)), u); }
  }
  assert.match(page, /src="\.\.\/20261024-120000-fixture-newcomer-1\/personas\/pip\/shown\/1\.png"/);
  assert.match(page, /src="\.\.\/20261024-120000-fixture-newcomer-1\/shots\/pip\/185000\.png"/);
});

test('md2html: headings, bold, lists, fences, tables', () => {
  const h = md2html('# T\n\n**b** and `c`\n\n- one\n- two\n\n```json\n{"a":1}\n```\n\n| x | y |\n|---|---|\n| 1 | 2 |');
  assert.match(h, /<h3>T<\/h3>/); assert.match(h, /<strong>b<\/strong>/); assert.match(h, /<code>c<\/code>/);
  assert.match(h, /<ul><li>one<\/li><li>two<\/li><\/ul>/); assert.match(h, /<pre class="mono">\{&quot;a&quot;:1\}<\/pre>/);
  assert.match(h, /<th>x<\/th>/); assert.match(h, /<td>2<\/td>/);
});
