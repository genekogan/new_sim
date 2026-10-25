import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as claude from './claude-headless.mjs';
import * as codex from './codex-headless.mjs';
const fx = (n) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8').split('\n').map(claude.parseLine).filter(Boolean);

test('claude: usage, final text and tool calls from a recorded stream-json turn', () => {
  const s = claude.summarize(fx('claude-turn.jsonl'));
  assert.deepEqual(s.usage, { inputTokens: 4, cachedTokens: 29235, cacheCreationTokens: 6909, outputTokens: 281, costUsd: 0.0018150500000000001 });
  assert.equal(s.finalText, 'done');
  assert.equal(s.sessionId, 'fa03feea-e4e7-4932-ad65-2420c2310b82');
  assert.deepEqual(s.toolCalls.map((c) => [c.cmd, c.result.split('\n')[0], c.isError]), [['ls -la', 'total 8', false], ['cat a.txt', 'hi', false]]);
});

test('claude: renderChat shows user text, collapsed tool lines with first result line, final message', () => {
  const md = claude.renderChat([{ type: 'harness_user', text: 'sit down\nplease' }, ...fx('claude-turn.jsonl')]);
  assert.match(md, /^> sit down\n> please/);
  assert.match(md, /⏺ Bash\(ls -la\)\n {2}⎿ {2}total 8/);
  assert.match(md, /⏺ Bash\(cat a\.txt\)\n {2}⎿ {2}hi/);
  assert.match(md, /⏺ done\n$/);
  assert.ok(!/thinking|signature|rate_limit/.test(md));
});

test('claude: a killed or failed turn is visible in the render', () => {
  const md = claude.renderChat([{ type: 'harness_user', text: 'x' }, { type: 'harness_timeout', maxWallSec: 240 }, { type: 'result', subtype: 'error_max_turns' }]);
  assert.match(md, /turn killed after 240s/); assert.match(md, /turn ended: error_max_turns/);
});

test('claude: args use --session-id first, --resume after; effort only when supported', () => {
  const a = claude.buildArgs({ sessionId: 'u1', resume: false, model: 'haiku', effort: 'medium', text: 'hi', effortOk: false });
  assert.deepEqual(a.slice(0, 6), ['-p', 'hi', '--model', 'haiku', '--session-id', 'u1']);
  assert.ok(!a.includes('--effort')); assert.ok(a.includes('--strict-mcp-config')); assert.equal(a[a.indexOf('--mcp-config') + 1], '{"mcpServers":{}}');
  const b = claude.buildArgs({ sessionId: 'u1', resume: true, model: 'haiku', effort: 'medium', text: 'hi', effortOk: true });
  assert.equal(b[4], '--resume'); assert.equal(b[b.indexOf('--effort') + 1], 'medium');
  assert.ok(b.slice(b.indexOf('--allowedTools')).includes('Bash(node eden.mjs:*)'));
});

test('codex: per-turn usage increments from cumulative thread usage', () => {
  const t1 = codex.summarize(fx('codex-turn.jsonl'));
  assert.equal(t1.threadId, '01a1710e-412b-7133-afbe-554144dd5c93');
  assert.equal(t1.finalText, 'done');
  assert.deepEqual(t1.toolCalls.map((c) => c.cmd), ['ls -la', 'cat a.txt']);
  assert.equal(t1.usage.inputTokens, 38506); assert.equal(t1.usage.outputTokens, 71);
  const t2 = codex.summarize(fx('codex-resume.jsonl'), t1.cumulative);
  assert.equal(t2.usage.inputTokens, 57896 - 38506); assert.equal(t2.usage.cachedTokens, 50560 - 31360); assert.equal(t2.usage.outputTokens, 5);
  assert.equal(t2.finalText, 'hi');
});

test('codex: render, shell-wrapper stripping and resume args', () => {
  assert.equal(codex.bareCommand("/bin/zsh -lc 'node eden.mjs act '\\''sit down'\\'''"), "node eden.mjs act 'sit down'");
  const md = codex.renderChat([{ type: 'harness_user', text: 'hello' }, ...fx('codex-turn.jsonl')]);
  assert.match(md, /^> hello/); assert.match(md, /⏺ Bash\(ls -la\)\n {2}⎿ {2}total 8/); assert.match(md, /⏺ done\n$/);
  const a = codex.buildArgs({ threadId: 'T', resume: true, model: null, effort: null, text: 'go' });
  assert.deepEqual([a[0], a[1], a.at(-2), a.at(-1)], ['exec', 'resume', 'T', 'go']);
  assert.ok(a.includes('--json') && a.includes('--ignore-user-config') && a.includes('--skip-git-repo-check'));
  const b = codex.buildArgs({ threadId: null, resume: false, model: 'gpt-6.1-sol', effort: 'medium', text: 'go' });
  assert.equal(b[1], '--ignore-user-config'); assert.equal(b[b.indexOf('-m') + 1], 'gpt-6.1-sol'); assert.ok(b.includes('model_reasoning_effort="medium"'));
});
