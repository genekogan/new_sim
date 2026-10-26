import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { readJson } from '../../lib/jsonl.mjs';
import { reviewRun } from '../reviewer.mjs';
import { developRun, finalizeSpec, HEADER } from '../developer.mjs';
import { copyRuns, fakeReviewer } from './helpers.mjs';

const SPEC = `# Spec\n\n**Issue** — card claims arrival.\n\n**Likely cause** — x.\n\n**Owning area** — client CLI\n\n**Approach**\n- y\n\n**Predeclared bar** — 3/3.\n\n\`\`\`json\n{"lane":"team/lanes/arrival-truth.md","rows":["r3"],"state":"OPEN","liveObserved":"claimed arrival","bar":"0 W"}\n\`\`\`\n`;

test('finalizeSpec: header first, lane brief kept as DRAFT, missing brief and re-scoring flagged', () => {
  const a = finalizeSpec(SPEC, { id: 'I-1' });
  assert.equal(a.body.split('\n')[0], HEADER); assert.equal(a.laneBrief.state, 'DRAFT'); assert.equal(a.laneBrief.lane, 'team/lanes/arrival-truth.md'); assert.equal(a.rescored, false);
  const b = finalizeSpec(`DRAFT — NOT IMPLEMENTED\nThis should be scored W not P.`, { id: 'I-2' });
  assert.equal(b.body.split('\n').filter((l) => l.includes('NOT IMPLEMENTED')).length, 1);
  assert.equal(b.laneBrief, null); assert.match(b.body, /harness: the lane brief JSON was missing/); assert.equal(b.rescored, true);
});

test('developRun: one call per issue and feature request, read-only tools scoped to the server root, only this module writes', async () => {
  const { main } = copyRuns(); await reviewRun({ runDir: main, call: fakeReviewer(), log: () => {} });
  const root = mkdtempSync(join(tmpdir(), 'pt-root-')); execFileSync('git', ['init', '-q', root]); writeFileSync(join(root, 'a.txt'), 'x');
  const calls = [];
  const idx = await developRun({ runDir: main, serverRoot: root, call: async (a) => { calls.push(a); return { text: SPEC, wallMs: 3, exit: 0 }; }, log: () => {} });
  assert.equal(calls.length, 3, '2 issues + 1 feature request');
  for (const c of calls) { assert.equal(c.cwd, root); assert.deepEqual(c.allowedTools, [`Read(${root}/**)`, `Grep(${root}/**)`, `Glob(${root}/**)`]); }
  assert.match(calls[0].prompt, /First line exactly: DRAFT — NOT IMPLEMENTED/); assert.match(calls[0].prompt, /oracleFailures/);
  assert.match(calls.at(-1).prompt, /Design and scope/);
  assert.deepEqual(idx.map((x) => x.id), ['I-1', 'I-2', 'F-1']);
  assert.ok(idx.every((x) => x.laneBrief && !x.serverRootTouched));
  assert.equal(readFileSync(join(main, 'specs/I-2.md'), 'utf8').split('\n')[0], HEADER);
  assert.equal(readJson(join(main, 'specs/index.json')).length, 3);
  const touched = await developRun({ runDir: main, serverRoot: root, only: ['I-1'], call: async () => { writeFileSync(join(root, 'b.txt'), 'oops'); return { text: SPEC }; }, log: () => {} });
  assert.equal(touched[0].serverRootTouched, true);
});
