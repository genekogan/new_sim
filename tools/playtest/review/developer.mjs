// Developer (spec §2.7, §12): a DRAFT spec per issue and feature request. Reads the server root (Read/Grep/Glob only),
// never edits; this module is the only writer (specs/<id>.md + specs/index.json). Nothing here is implemented.
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { callModel as realCall, lastJson } from '../lib/claude-p.mjs';
import { readJson, writeJson } from '../lib/jsonl.mjs';
import { run as runProc } from '../lib/proc.mjs';
import { providerPolicy } from '../lib/provider-policy.mjs';
import { loadRun, projectEvidence } from './run.mjs';
import { runOracles } from './oracles.mjs';
import { REPO_ROOT } from '../../lib/paths.mjs';

export const DEFAULT_SERVER_ROOT = process.env.PLAYTEST_SERVER_ROOT ?? REPO_ROOT;
export const HEADER = 'DRAFT — NOT IMPLEMENTED';
export const AREAS = ['server', 'client CLI', 'skill text', 'world content', 'engine rule', 'UI'];

export const DEVELOPER_ROLE = `You are the developer who picks up one issue (or feature request) raised by QA from a playtest of Eden Sim.
You have read-only access to the source tree in your working directory (Read, Grep, Glob). You may not edit anything,
run anything, or write files: your whole answer is the text of a draft spec, which will be saved for you.
You answer the issue as written. You must not re-score it (no H/P/M/W), rewrite it, or change the test or its rubric.
Be concrete and brief: name files and functions you actually read; say what you are unsure of.`;

export function specPrompt(item, kind, packs) {
  return [
    `# ${kind === 'issue' ? 'Issue' : 'Feature request'} ${item.id}`, '', '```json', JSON.stringify(item, null, 1), '```', '',
    'Evidence for the request(s) it came from (times in seconds since the request was sent), with oracle failures:', '```json', JSON.stringify(packs), '```', '',
    'Write a draft spec in Markdown with exactly these parts:',
    `1. First line exactly: ${HEADER}`,
    '2. **Issue** — the issue restated in one line (do not change its meaning).',
    '3. **Likely cause** — what in the source most likely produces this, with the files/functions you read; say how sure you are.',
    `4. **Owning area** — one of: ${AREAS.join(' | ')} (more than one only if truly shared).`,
    kind === 'issue' ? '5. **Approach** — the change you would make, in a few bullets.' : '5. **Design and scope** — a design and its scope, or a reasoned decline.',
    '6. **Predeclared bar** — the measurable result that would close it (rerun the repro scenario; counts, budgets, zero-W).',
    '7. **Lane brief** — a fenced ```json block, one object: {"lane":"team/lanes/<slug>.md","rows":["<request ids>"],"state":"DRAFT","liveObserved":"what the playtest observed","bar":"the predeclared bar"}',
  ].join('\n');
}

export function validLaneBrief(b) { return !!b && typeof b.lane === 'string' && Array.isArray(b.rows) && typeof b.liveObserved === 'string' && typeof b.bar === 'string'; }

/** Shape the model's text into the saved spec: header first, lane brief checked, re-scoring flagged. */
export function finalizeSpec(text, item) {
  let body = String(text ?? '').trim().replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/, '$1');
  const lines = body.split('\n'); const i = lines.findIndex((l) => l.includes('NOT IMPLEMENTED'));
  if (i >= 0 && i < 3) lines.splice(i, 1);
  body = `${HEADER}\n\n${lines.join('\n').trim()}\n`;
  const brief = lastJson(body);
  const rescored = /\b(fidelity|re-?scor\w*|scor\w*)\b[^.\n]{0,40}\b(H|P|M|W)\b(?!\w)/.test(body.replace(/^.*\*\*Issue\*\*.*$/m, ''));
  if (!validLaneBrief(brief)) body += `\n> harness: the lane brief JSON was missing or did not have lane/rows/liveObserved/bar.\n`;
  return { body, laneBrief: validLaneBrief(brief) ? { ...brief, state: 'DRAFT' } : null, rescored, id: item.id };
}

const gitState = async (root) => (await runProc('git', ['-C', root, 'status', '--porcelain'], { maxWallMs: 20000 })).stdout;

/** developRun({runDir, serverRoot}) → step 6. `call` injectable for tests. `only` limits to some ids. */
export async function developRun({ runDir, serverRoot = DEFAULT_SERVER_ROOT, model, call = realCall, maxWallSec = 600, only = null, log = (m) => process.stderr.write(m + '\n') }) {
  const run = loadRun(runDir);
  if (providerPolicy(run.scenario).deterministic) return { skipped: 'deterministic review: no model developer', specs: [] };
  model = model ?? run.scenario?.review?.developerModel ?? 'opus';
  const items = [...readJson(join(runDir, 'issues.json'), []).map((x) => ({ kind: 'issue', item: x })), ...readJson(join(runDir, 'feature-requests.json'), []).map((x) => ({ kind: 'feature', item: x }))].filter((x) => !only || only.includes(x.item.id));
  mkdirSync(join(runDir, 'specs'), { recursive: true });
  const allowedTools = [`Read(${serverRoot}/**)`, `Grep(${serverRoot}/**)`, `Glob(${serverRoot}/**)`];
  const index = [];
  for (const { kind, item } of items) {
    const packs = (item.requestIds ?? []).map((rid) => run.evidence.find((e) => e.requestId === rid)).filter(Boolean).map((ev) => ({ ...projectEvidence(run, ev, 4000), oracleFailures: runOracles(ev, { run }).filter((o) => o.status === 'fail').map(({ id, detail }) => ({ id, detail })) }));
    const before = await gitState(serverRoot);
    log(`develop ${item.id}: calling ${model} in ${serverRoot}`);
    const res = await call({ tools: 'Read,Grep,Glob', model, prompt: specPrompt(item, kind, packs), appendSystem: DEVELOPER_ROLE, cwd: serverRoot, allowedTools, maxWallSec });
    const after = await gitState(serverRoot);
    const spec = finalizeSpec(res.text, item);
    writeFileSync(join(runDir, 'specs', `${item.id}.md`), spec.body);
    index.push({ id: item.id, kind, title: item.title, file: `specs/${item.id}.md`, laneBrief: spec.laneBrief, rescored: spec.rescored, serverRootTouched: before !== after, model, wallMs: res.wallMs, exit: res.exit, timedOut: res.timedOut, usage: res.usage });
  }
  writeJson(join(runDir, 'specs/index.json'), index);
  return index;
}
