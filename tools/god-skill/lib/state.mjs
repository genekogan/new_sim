// Folder state (.eden-god.json: world URL, god token, current group) and the HTTP client.
// Never print the token.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export const STATE = '.eden-god.json';
export const load = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {});
export const save = (patch) => { const s = { ...load(), ...patch }; for (const k of Object.keys(s)) if (s[k] === undefined) delete s[k]; writeFileSync(STATE, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 }); return s; };
export const need = (s, k, hint) => { if (!s[k]) throw new Error(`${k} missing. ${hint}`); return s[k]; };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EDIT_PATHS = new Set(['/v1/god/act', '/v1/god/env', '/v1/god/land', '/v1/god/strike', '/v1/god/undo', '/v1/god/redo', '/v1/god/answer']);

export async function call(path, { body, method, as = 'god', timeoutMs = Number(process.env.EDEN_GOD_TIMEOUT_MS ?? 180_000) } = {}) {
  const s = load(), world = need(s, 'world', 'Run: node eden-god.mjs register <world-url>'), headers = { 'content-type': 'application/json' };
  if (as === 'god' && s.token) headers.authorization = `Bearer ${s.token}`;
  if (as === 'owner' && s.identity) headers.authorization = `Bearer ${s.identity}`;
  const verb = method ?? (body ? 'POST' : 'GET'), pathname = path.split('?')[0];
  // A new command is a new request, even if its input batch carried an old ref.
  // Keep the serialized bytes for the transport retry; never re-create the payload.
  const clientRef = as === 'god' && verb !== 'GET' && EDIT_PATHS.has(pathname) ? randomUUID() : undefined;
  const payload = body || clientRef ? JSON.stringify(clientRef ? { ...body, clientRef } : body) : undefined;
  const recoverable = clientRef && pathname === '/v1/god/act' && verb === 'POST';
  async function send(requestPath, requestMethod, requestBody, deadline = timeoutMs) {
    const t0 = Date.now();
    const r = await fetch(world + requestPath, { method: requestMethod, headers, body: requestBody, signal: AbortSignal.timeout(deadline) });
    // Reading a response can also lose the connection after the edit committed.
    const text = await r.text(); let data;
    if (process.env.EDEN_GOD_TRACE) console.error(`[trace] ${requestMethod} ${requestPath} ${r.status} ${Date.now() - t0} ms ${requestBody?.slice(0, 160) ?? ''}`);
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 400) }; }
    return { status: r.status, data };
  }
  const lost = (e) => {
    const slow = /timeout|abort/i.test(`${e?.name} ${e?.message}`);
    const detail = slow ? `the world did not answer within ${Math.round(timeoutMs / 1000)} s` : String(e?.message ?? e);
    const advice = recoverable ? ` Check \`request ${clientRef}\` before issuing a new edit; its outcome is unresolved.` : clientRef ? ' This endpoint has no receipt recovery; verify the world before issuing it again.' : '';
    return { status: 0, data: { ok: false, code: slow ? 'slow' : 'unreachable', ...(clientRef ? { clientRef } : {}), message: detail + advice } };
  };
  let failure;
  try { return await send(path, verb, payload); } catch (e) { failure = e; }
  if (!recoverable) return lost(failure);

  // Only /act is bound durably to clientRef. A lookup failure is not proof the
  // edit is absent, so resend only after a definite 404, and at most once.
  const lookup = async () => send(`/v1/god/requests/${encodeURIComponent(clientRef)}`, 'GET', undefined, Math.min(timeoutMs, 10_000));
  const receiptResult = (r) => r.status === 200 && r.data?.result?.accepted === true ? { status: 200, data: { ...r.data.result, replayed: true } } : null;
  let receipt;
  try { receipt = await lookup(); } catch { return lost(failure); }
  const recovered = receiptResult(receipt);
  if (recovered) return recovered;
  if (receipt.status !== 404) return lost(failure);
  try { return await send(path, verb, payload); } catch (e) { failure = e; }
  // If the one resend also lost its response, a final read may still resolve it.
  try { return receiptResult(await lookup()) ?? lost(failure); } catch { return lost(failure); }
}
export const ok = (r, what) => { if (r.status >= 200 && r.status < 300) return r.data; throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`); };
export const num = (v) => { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`not a number: ${v}`); return n; };
export const r2 = (v) => Math.round(v * 100) / 100;
