// Codex headless seat turns (`codex exec --json`, thread resume via `codex exec resume <threadId>`) and the chat render.
// DESIGN §4.1. Codex reports cumulative thread usage on turn.completed; we store per-turn increments.
import { run } from '../../lib/proc.mjs';

/** Sandbox: workspace writes + network (the seat must reach the local world with curl/node). No approvals in exec. */
export const SANDBOX_CONFIG = ['-c', 'sandbox_mode="workspace-write"', '-c', 'sandbox_workspace_write.network_access=true', '-c', 'approval_policy="never"'];

export function buildArgs({ threadId, resume, model, effort, text }) {
  const common = ['--ignore-user-config', '--skip-git-repo-check', '--json', ...SANDBOX_CONFIG];
  if (model) common.push('-m', model);
  if (effort) common.push('-c', `model_reasoning_effort="${effort}"`);
  return resume && threadId ? ['exec', 'resume', ...common, threadId, text] : ['exec', ...common, text];
}

export function parseLine(line) { if (!line.trim()) return null; try { return JSON.parse(line); } catch { return { type: 'unparsed', raw: line.slice(0, 2000) }; } }

/** Strip the shell wrapper Codex records (`/bin/zsh -lc 'ls -la'` → `ls -la`). */
export function bareCommand(cmd) {
  const m = String(cmd ?? '').match(/^\S*\/(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/);
  return m ? m[2].replace(/'\\''/g, "'") : String(cmd ?? '');
}

/** cumulative usage of this turn → {cumulative, usage (increment over prev)} */
export function usageOf(stream, prev = null) {
  const done = stream.findLast((e) => e?.type === 'turn.completed');
  if (!done?.usage) return { cumulative: prev, usage: null };
  const c = { inputTokens: done.usage.input_tokens ?? 0, cachedTokens: done.usage.cached_input_tokens ?? 0, cacheCreationTokens: done.usage.cache_write_input_tokens ?? 0,
    outputTokens: (done.usage.output_tokens ?? 0), reasoningTokens: done.usage.reasoning_output_tokens ?? 0 };
  const p = prev ?? {};
  // If the counter went backwards (a fresh thread), the reported figure is already per-turn.
  const reset = (p.inputTokens ?? 0) > c.inputTokens;
  const usage = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, reset ? v : v - (p[k] ?? 0)]));
  usage.costUsd = null;
  return { cumulative: c, usage };
}

export function summarize(stream, prevCumulative = null) {
  const items = stream.filter((e) => e?.type === 'item.completed').map((e) => e.item);
  const finalText = items.filter((i) => i.type === 'agent_message').at(-1)?.text ?? null;
  const threadId = stream.find((e) => e?.type === 'thread.started')?.thread_id ?? null;
  const starts = new Map(stream.filter((e) => e?.type === 'item.started').map((e) => [e.item.id, e._rx]));
  const toolCalls = items.filter((i) => i.type === 'command_execution').map((i) => {
    const t1 = stream.find((e) => e?.type === 'item.completed' && e.item.id === i.id)?._rx;
    return { id: i.id, name: 'Bash', cmd: bareCommand(i.command), result: i.aggregated_output ?? '', isError: i.exit_code !== 0, exitCode: i.exit_code, ms: starts.get(i.id) != null && t1 != null ? t1 - starts.get(i.id) : null };
  });
  return { finalText, threadId, toolCalls, ...usageOf(stream, prevCumulative) };
}

const firstLine = (s) => { const l = String(s ?? '').split('\n').find((x) => x.trim()) ?? ''; return l.length > 160 ? l.slice(0, 157) + '…' : l; };
/** renderChat(stream) → markdown as Codex's terminal shows it (same conventions as the Claude render). */
export function renderChat(stream) {
  const out = [];
  for (const e of stream) {
    if (e?.type === 'harness_user') out.push(`> ${String(e.text).split('\n').join('\n> ')}`);
    else if (e?.type === 'item.completed' && e.item?.type === 'agent_message' && e.item.text?.trim()) out.push(`⏺ ${e.item.text.trim()}`);
    else if (e?.type === 'item.completed' && e.item?.type === 'command_execution') out.push(`⏺ Bash(${bareCommand(e.item.command).replace(/\s+/g, ' ').slice(0, 160)})\n  ⎿  ${e.item.exit_code ? `exit ${e.item.exit_code}: ` : ''}${firstLine(e.item.aggregated_output)}`);
    else if (e?.type === 'item.completed' && e.item?.type === 'file_change') out.push(`⏺ Edit(${(e.item.changes ?? []).map((c) => c.path).join(', ')})`);
    else if (e?.type === 'turn.failed' || e?.type === 'error') out.push(`⏺ [turn failed: ${e.error?.message ?? e.message ?? ''}]`);
    else if (e?.type === 'harness_timeout') out.push(`⏺ [turn killed after ${e.maxWallSec}s]`);
  }
  return out.join('\n\n') + '\n';
}

/** turn({cwd, sessionId (= threadId), resume, model, effort, text, maxWallSec, prevCumulative}) → same shape as claude-headless + {cumulative} */
export async function turn({ cwd, sessionId = null, resume = false, model = null, effort = null, text, maxWallSec = 240, prevCumulative = null }) {
  const args = buildArgs({ threadId: sessionId, resume, model, effort, text });
  const stream = [{ type: 'harness_user', text, _rx: Date.now() }];
  const r = await run('codex', args, { cwd, maxWallMs: maxWallSec * 1000, onStdoutLine: (l) => { const e = parseLine(l); if (e) { e._rx = Date.now(); stream.push(e); } } });
  if (r.timedOut) stream.push({ type: 'harness_timeout', maxWallSec, _rx: Date.now() });
  if (r.code !== 0 && r.stderr) stream.push({ type: 'harness_stderr', text: r.stderr.slice(-2000), _rx: Date.now() });
  const s = summarize(stream, prevCumulative);
  return { stream, usage: s.usage, cumulative: s.cumulative, finalText: s.finalText, sessionId: s.threadId ?? sessionId, exit: r.code, wallMs: r.wallMs, timedOut: r.timedOut, toolCalls: s.toolCalls, effortApplied: effort ? true : null };
}
export const name = 'codex-headless';
