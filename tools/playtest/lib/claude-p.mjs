// One model call through the signed-in Claude Code CLI (subscription), never the API.
import { run } from './proc.mjs';
import { randomUUID } from 'node:crypto';
const DEFAULT_TOOLS = [];
/** callModel({model, prompt, cwd, allowedTools, sessionId, resume, maxWallSec, appendSystem}) → {text, json, usage, sessionId, wallMs, exit, timedOut, raw} */
export async function callModel({ model = 'opus', prompt, cwd = process.cwd(), allowedTools = DEFAULT_TOOLS, sessionId = null, resume = false, maxWallSec = 300, appendSystem = null, effort = null }) {
  const sid = sessionId ?? randomUUID();
  const args = ['-p', prompt, '--model', model, resume ? '--resume' : '--session-id', sid, '--setting-sources', 'project', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--output-format', 'json'];
  if (allowedTools.length) args.push('--allowedTools', ...allowedTools); else args.push('--tools', '');
  if (appendSystem) args.push('--append-system-prompt', appendSystem);
  if (effort) args.push('--effort', effort);
  // Input fidelity: a seat, persona, reviewer or developer must never inherit this repo's or the user's CLAUDE.md.
  const env = { ...process.env, CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1' }; delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT;
  const r = await run('claude', args, { cwd, env, maxWallMs: maxWallSec * 1000 });
  let parsed = null; try { parsed = JSON.parse(r.stdout); } catch { /* not json */ }
  const text = parsed?.result ?? r.stdout;
  return { text, json: lastJson(text), usage: parsed?.usage ?? null, costUsd: parsed?.total_cost_usd ?? null, sessionId: parsed?.session_id ?? sid, wallMs: r.wallMs, exit: r.code, timedOut: r.timedOut, raw: parsed ?? { stdout: r.stdout.slice(-2000), stderr: r.stderr.slice(-2000) } };
}
/** The last balanced {...} JSON object in a text (models often wrap JSON in prose or fences). */
export function lastJson(text) {
  if (typeof text !== 'string') return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/g);
  const candidates = fence ? fence.map((f) => f.replace(/```(?:json)?\s*/, '').replace(/```$/, '')) : [];
  candidates.push(text);
  for (const c of candidates.reverse()) { const end = c.lastIndexOf('}'); for (let i = c.lastIndexOf('{', end); i >= 0; i = c.lastIndexOf('{', i - 1)) { try { return JSON.parse(c.slice(i, end + 1)); } catch { /* keep looking */ } } }
  return null;
}
