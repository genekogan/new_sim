// Folder state (.eden-god.json: world URL, god token, current group) and the HTTP client.
// Never print the token.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const STATE = '.eden-god.json';
export const load = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {});
export const save = (patch) => { const s = { ...load(), ...patch }; for (const k of Object.keys(s)) if (s[k] === undefined) delete s[k]; writeFileSync(STATE, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 }); return s; };
export const need = (s, k, hint) => { if (!s[k]) throw new Error(`${k} missing. ${hint}`); return s[k]; };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function call(path, { body, method, as = 'god', timeoutMs = Number(process.env.EDEN_GOD_TIMEOUT_MS ?? 180_000) } = {}) {
  const s = load(), url = need(s, 'world', 'Run: node eden-god.mjs register <world-url>') + path, headers = { 'content-type': 'application/json' };
  if (as === 'god' && s.token) headers.authorization = `Bearer ${s.token}`;
  if (as === 'owner' && s.identity) headers.authorization = `Bearer ${s.identity}`;
  const t0 = Date.now();
  let r; try { r = await fetch(url, { method: method ?? (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) }); }
  catch (e) { const slow = /timeout|abort/i.test(String(e.message)); return { status: 0, data: { ok: false, code: slow ? 'slow' : 'unreachable', message: slow ? `the world did not answer within ${Math.round(timeoutMs / 1000)} s (a busy server). An edit may still have landed: run \`history 3\` before you retry.` : String(e.message) } }; }
  const text = await r.text(); let data;
  if (process.env.EDEN_GOD_TRACE) console.error(`[trace] ${method ?? (body ? 'POST' : 'GET')} ${path} ${r.status} ${Date.now() - t0} ms ${body ? JSON.stringify(body).slice(0, 160) : ''}`); try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 400) }; }
  return { status: r.status, data };
}
export const ok = (r, what) => { if (r.status >= 200 && r.status < 300) return r.data; throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`); };
export const num = (v) => { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`not a number: ${v}`); return n; };
export const r2 = (v) => Math.round(v * 100) / 100;
