// Claude Code headless seat turns (`claude -p … --output-format stream-json --verbose`) and the terminal-like chat render.
// DESIGN §4.1. One session per seat: first turn --session-id, then --resume.
import { run } from '../../lib/proc.mjs';

export const DEFAULT_ALLOWED = ['Bash(node eden.mjs:*)', 'Bash(node eden-agent.mjs:*)', 'Bash(curl:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(mkdir:*)',
  'Bash(pwd:*)', 'Bash(test:*)', 'Read(./**)', 'Write(./**)', 'Edit(./**)'];

let effortSupport = null;
/** Whether the installed CLI accepts --effort (checked once from `claude --help`). */
export async function supportsEffort() {
  if (effortSupport !== null) return effortSupport;
  const r = await run('claude', ['--help'], { maxWallMs: 20000 });
  effortSupport = /--effort\b/.test(r.stdout + r.stderr);
  return effortSupport;
}

export function buildArgs({ sessionId, resume, model, effort, text, allowedTools = DEFAULT_ALLOWED, effortOk = false }) {
  const args = ['-p', text, '--model', model, resume ? '--resume' : '--session-id', sessionId, '--setting-sources', 'project', '--strict-mcp-config',
    '--mcp-config', '{"mcpServers":{}}', '--output-format', 'stream-json', '--verbose'];
  if (effort && effortOk) args.push('--effort', effort);
  if (allowedTools.length) args.push('--allowedTools', ...allowedTools);
  return args;
}

export function parseLine(line) { if (!line.trim()) return null; try { return JSON.parse(line); } catch { return { type: 'unparsed', raw: line.slice(0, 2000) }; } }

/** From a turn's stream: {usage:{inputTokens, cachedTokens, cacheCreationTokens, outputTokens, costUsd}, finalText, sessionId, toolCalls}. */
export function summarize(stream) {
  const result = stream.findLast((e) => e?.type === 'result') ?? null;
  const u = result?.usage ?? {};
  const usage = result ? { inputTokens: u.input_tokens ?? 0, cachedTokens: u.cache_read_input_tokens ?? 0, cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0, costUsd: result.total_cost_usd ?? null } : null;
  const lastText = stream.filter((e) => e?.type === 'assistant').flatMap((e) => e.message?.content ?? []).filter((c) => c.type === 'text').at(-1)?.text ?? null;
  const sessionId = result?.session_id ?? stream.find((e) => e?.session_id)?.session_id ?? null;
  return { usage, finalText: result?.result ?? lastText, sessionId, toolCalls: toolCalls(stream), resultSubtype: result?.subtype ?? null, isError: result?.is_error ?? null };
}

/** [{id, name, cmd, input, result, isError, ms}] pairing tool_use with tool_result; ms from harness receive stamps (_rx) when present. */
export function toolCalls(stream) {
  const calls = new Map();
  for (const e of stream) {
    if (e?.type === 'assistant') for (const c of e.message?.content ?? []) if (c.type === 'tool_use') calls.set(c.id, { id: c.id, name: c.name, cmd: c.input?.command ?? c.input?.file_path ?? null, input: c.input, result: null, isError: null, ms: null, _t0: e._rx ?? null });
    if (e?.type === 'user') for (const c of e.message?.content ?? []) if (c.type === 'tool_result' && calls.has(c.tool_use_id)) {
      const k = calls.get(c.tool_use_id); k.result = resultText(c.content); k.isError = !!c.is_error; if (k._t0 != null && e._rx != null) k.ms = e._rx - k._t0;
    }
  }
  return [...calls.values()].map(({ _t0, ...k }) => k);
}
const resultText = (content) => typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => c.text ?? '').join('\n') : String(content ?? '');

const toolLabel = (c) => {
  const i = c.input ?? {};
  const arg = i.command ?? i.file_path ?? i.pattern ?? i.url ?? i.description ?? '';
  return `${c.name}(${String(arg).replace(/\s+/g, ' ').slice(0, 160)})`;
};
const firstLine = (s) => { const l = String(s ?? '').split('\n').find((x) => x.trim()) ?? ''; return l.length > 160 ? l.slice(0, 157) + '…' : l; };

/** renderChat(streamEvents) → markdown, as a terminal shows it. A `{type:"harness_user", text}` event marks what the human typed. */
export function renderChat(stream) {
  const out = [], results = new Map();
  for (const e of stream) if (e?.type === 'user') for (const c of e.message?.content ?? []) if (c.type === 'tool_result') results.set(c.tool_use_id, c);
  for (const e of stream) {
    if (e?.type === 'harness_user') out.push(`> ${String(e.text).split('\n').join('\n> ')}`);
    else if (e?.type === 'assistant') for (const c of e.message?.content ?? []) {
      if (c.type === 'text' && c.text.trim()) out.push(`⏺ ${c.text.trim()}`);
      else if (c.type === 'tool_use') { const r = results.get(c.id); out.push(`⏺ ${toolLabel(c)}\n  ⎿  ${r ? (r.is_error ? 'Error: ' : '') + firstLine(resultText(r.content)) : '(no result)'}`); }
    }
    else if (e?.type === 'result' && e.subtype !== 'success') out.push(`⏺ [turn ended: ${e.subtype}]`);
    else if (e?.type === 'harness_timeout') out.push(`⏺ [turn killed after ${e.maxWallSec}s]`);
  }
  return out.join('\n\n') + '\n';
}

/** turn({cwd, sessionId, resume, model, effort, text, allowedTools, maxWallSec}) → {stream, usage, finalText, sessionId, exit, wallMs, timedOut, toolCalls, effortApplied} */
export async function turn({ cwd, sessionId, resume = false, model = 'haiku', effort = null, text, allowedTools = DEFAULT_ALLOWED, maxWallSec = 240 }) {
  const effortOk = effort ? await supportsEffort() : false;
  const args = buildArgs({ sessionId, resume, model, effort, text, allowedTools, effortOk });
  const env = { ...process.env }; delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT;
  const stream = [{ type: 'harness_user', text, _rx: Date.now() }];
  const r = await run('claude', args, { cwd, env, maxWallMs: maxWallSec * 1000, onStdoutLine: (l) => { const e = parseLine(l); if (e) { e._rx = Date.now(); stream.push(e); } } });
  if (r.timedOut) stream.push({ type: 'harness_timeout', maxWallSec, _rx: Date.now() });
  if (r.code !== 0 && r.stderr) stream.push({ type: 'harness_stderr', text: r.stderr.slice(-2000), _rx: Date.now() });
  const s = summarize(stream);
  return { stream, usage: s.usage, finalText: s.finalText, sessionId: s.sessionId ?? sessionId, exit: r.code, wallMs: r.wallMs, timedOut: r.timedOut, toolCalls: s.toolCalls, effortApplied: effort ? effortOk : null };
}
export const name = 'claude-headless';
