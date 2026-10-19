// Folder state (.eden-god.json: world URL, god token, current group) and the HTTP client.
// Never print the token.
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { acquireLock, holder } from './locks.mjs';
import { fetchWithRetry } from './retry.mjs';
import { wireFetch } from './wire.mjs';
import { noticeOwnerInbox, noticeInboxHeader } from './inbox-notice.mjs';

export const STATE = '.eden-god.json';
const read = (file) => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
export const claimFile = (id) => {
  if (!/^c_[0-9a-f]{8}$/.test(id)) throw new Error('EDEN_GOD_CLAIM must be c_ followed by eight hexadecimal digits');
  return `.eden-god.claim-${id}.json`;
};
/** WD7 slice 3: EDEN_GOD_HELPER names a helper file (world + the helper's own scoped token + its claim). */
export const helperFile = (id) => `.eden-god.helper-${claimFile(id).slice('.eden-god.claim-'.length, -'.json'.length)}.json`;
function helperState() {
  const file = process.env.EDEN_GOD_HELPER; if (!file) return null;
  if (!existsSync(file)) throw new Error(`EDEN_GOD_HELPER names a missing file: ${file}`);
  const s = read(file), cid = s.helper?.claim;
  if (!cid) throw new Error(`${file} is not a helper file (no helper.claim)`);
  if (process.env.EDEN_GOD_CLAIM && process.env.EDEN_GOD_CLAIM !== cid) throw new Error(`EDEN_GOD_CLAIM=${process.env.EDEN_GOD_CLAIM} differs from the helper file's claim ${cid}`);
  return s;
}
/** The claim this process works under: EDEN_GOD_CLAIM, or the helper file's claim. */
export const activeClaim = () => process.env.EDEN_GOD_CLAIM || helperState()?.helper.claim;
export function atomicWrite(file, text) {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try { writeFileSync(temp, text, { mode: 0o600, flag: 'wx' }); renameSync(temp, file); }
  finally { try { unlinkSync(temp); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
}
export function load() {
  // A helper never reads the lead's credentials: its world and token come from the helper file.
  const s = helperState() ?? read(STATE), cid = activeClaim();
  if (!cid) return s;
  // Credentials belong to the lead's file. A new claim starts at its own first
  // step; subsequent progress/group/warnings live only in the claim file.
  const local = read(claimFile(cid)), b = s.build;
  const merged = { ...s, group: undefined, build: b ? { id: b.id, claim: cid, n: 1, label: b.steps?.[0] ?? 'step 1', steps: b.steps } : undefined, ...local };
  if (merged.build) { const { lease, ...build } = merged.build; merged.build = { ...build, claim: cid }; }
  return merged;
}
export function withStateLock(run) {
  const cid = activeClaim(), file = cid ? claimFile(cid) : STATE;
  const release = acquireLock(`${file}.lock`, { label: 'claim/step state', reentrant: true });
  try { const out = run(); if (out?.then) return out.finally(release); release(); return out; }
  catch (e) { release(); throw e; }
}
export function save(patch) { return withStateLock(() => saveUnlocked(patch)); }
function saveUnlocked(patch) {
  const cid = activeClaim(), file = cid ? claimFile(cid) : STATE;
  const s = { ...read(file), ...patch };
  for (const k of Object.keys(s)) if (s[k] === undefined) delete s[k];
  // A null build is a claim-file tombstone: do not inherit the lead again.
  if (cid && Object.hasOwn(patch, 'build') && !patch.build) s.build = null;
  atomicWrite(file, JSON.stringify(s, null, 2) + '\n');
  return load();
}
const context = new AsyncLocalStorage();
export const withDeadline = (deadlineAt, signal, run) => context.run({ ...context.getStore(), deadlineAt, signal }, run);
export const OUTPUT_SUFFIX = Symbol('build output suffix');
export const withoutBuild = (run) => context.run({ ...context.getStore(), noBuild: true }, run);
export function withBuildOptions(flags, run) {
  const ctx = { noBuild: !!flags['no-build'] };
  return context.run(ctx, () => {
    const finish = (out) => {
      if (ctx.suffix && !flags.json) {
        if (typeof out === 'string') return `${out} ${ctx.suffix}`;
        if (out && typeof out === 'object') Object.defineProperty(out, OUTPUT_SUFFIX, { value: ctx.suffix, configurable: true });
      }
      return out;
    };
    const out = run();
    return out?.then ? out.then(finish) : finish(out);
  });
}
// Keep ids through 24 chars; longer ids and labels get an explicit ASCII ellipsis.
// At most 47 ASCII bytes including the separating space/newline (999/24 steps).
export function buildSuffix(echo, b = load().build) {
  if (!echo) return '';
  const step = echo.step ?? {}, of = b?.id === echo.id ? b.steps?.length : undefined;
  const n = `${step.n ?? b?.n ?? 1}${of ? '/' + of : ''}`;
  const short = (s, max) => s.length > max ? s.slice(0, max - 3) + '...' : s;
  const id = short(String(echo.id), 24), label = short(String(step.label ?? b?.label ?? '').replace(/[^\x20-\x7e]/g, '?'), 12);
  return `[${id} ${n}${label ? ' ' + label : ''}]`;
}
export function buildHeader(b = load().build, server) {
  if (!b) return '';
  return `build ${b.id} ${b.n}/${b.steps?.length ?? '?'} ${b.label} (${server?.status ?? b.status ?? 'active'}, ${b.claim ? `claim: ${b.part ?? b.claim}` : 'lead: you'})`;
}
export const need = (s, k, hint) => { if (!s[k]) throw new Error(`${k} missing. ${hint}`); return s[k]; };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EDIT_PATHS = new Set(['/v1/god/act', '/v1/god/env', '/v1/god/land', '/v1/god/strike', '/v1/god/undo', '/v1/god/redo', '/v1/god/answer']);

/** The build/group fields a god batch request carries (the lead's build step, the current group). Exported so a
 *  request that asks the server to run dryruns for it (G2: place/move repairs) can say what those dryruns carry. */
export function decorate(s, pathname, verb, body, { as = 'god', noBuild = false } = {}) {
  const batchPath = ['/v1/god/act', '/v1/god/preview', '/v1/god/dryrun'].includes(pathname);
  const revertPath = ['/v1/god/undo', '/v1/god/redo'].includes(pathname);
  const sealed = body && Object.hasOwn(body, 'preview');
  const worldOnly = Array.isArray(body?.ops) && body.ops.every((o) => ['world', 'answer'].includes(o.op));
  const carries = as === 'god' && verb !== 'GET' && (batchPath || revertPath) && !sealed && !noBuild && !context.getStore()?.noBuild && !worldOnly;
  if (carries) {
    body = { ...body };
    if (!body.build && s.build) { const b = s.build; body.build = { id: b.id, ...(b.claim ? { claim: b.claim } : { lease: b.lease }), step: b.n, label: b.label }; }
    if (batchPath && body.group === undefined && s.group) body.group = s.group;
  } else if (batchPath && !sealed && body?.group === undefined && s.group && !s.build) body = { ...body, group: s.group };
  return body;
}
const READ_POSTS = new Set(['/v1/god/query', '/v1/god/dryrun', '/v1/god/preview', '/v1/god/verify-use']);
let writes = 0;
/** How many possibly-writing requests this process has sent (mirror.mjs: a check stays good until the next one). */
export const writesSent = () => writes;
export async function call(path, { body, method, as = 'god', noBuild = false, timeoutMs = Number(process.env.EDEN_GOD_TIMEOUT_MS ?? 180_000) } = {}) {
  const s = load(), world = need(s, 'world', 'Run: node eden-god.mjs register <world-url>'), headers = { 'content-type': 'application/json' };
  if (as === 'god' && s.token) headers.authorization = `Bearer ${s.token}`;
  if (as === 'owner' && s.identity) headers.authorization = `Bearer ${s.identity}`;
  headers['x-eden-god-holder'] = JSON.stringify(holder('eden-god CLI'));
  const verb = method ?? (body ? 'POST' : 'GET'), pathname = path.split('?')[0];
  const revertPath = ['/v1/god/undo', '/v1/god/redo'].includes(pathname);
  body = decorate(s, pathname, verb, body, { as, noBuild });
  if (verb !== 'GET' && !READ_POSTS.has(pathname)) writes++; // G2: the mirror's in-command freshness ends at any write
  // A new command is a new request, even if its input batch carried an old ref.
  // Keep the serialized bytes for the transport retry; never re-create the payload.
  const clientRef = as === 'god' && verb !== 'GET' && EDIT_PATHS.has(pathname) ? randomUUID() : undefined;
  const payload = body || clientRef ? JSON.stringify(clientRef ? { ...body, clientRef } : body) : undefined;
  const recoverable = clientRef && pathname === '/v1/god/act' && verb === 'POST';
  const retryBudget = { waited: 0, retries: 0 };
  async function send(requestPath, requestMethod, requestBody, attemptMs = timeoutMs) {
    const t0 = Date.now();
    // Each 429 retry gets its own attemptMs signal (as release 1's recursive send did), capped by the
    // command's one deadline and cancelled with it (the look deadline runs through withDeadline).
    const store = context.getStore();
    const r = await fetchWithRetry(world + requestPath, { method: requestMethod, headers, body: requestBody, timeoutMs: attemptMs, deadlineAt: store?.deadlineAt, signal: store?.signal }, { fetch: wireFetch }, retryBudget);
    if (headers.authorization && !requestPath.startsWith('/v1/god/inbox/')) noticeInboxHeader(r.headers);
    // Reading a response can also lose the connection after the edit committed.
    const text = await r.text(); let data;
    if (process.env.EDEN_GOD_TRACE) console.error(`[trace] ${requestMethod} ${requestPath} ${r.status} ${Date.now() - t0} ms ${requestBody?.slice(0, 160) ?? ''}`);
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 400) }; }
    return { status: r.status, data };
  }
  const finish = (r) => {
    const b = body?.build, data = r.data;
    if (headers.authorization && !pathname.startsWith('/v1/god/inbox/')) noticeOwnerInbox(data);
    // env.mjs formats only the applied environment. Surface the server's shared-clock
    // warning here as well, including sky's world-state act, without another call.
    if (as === 'god' && ['/v1/god/env', '/v1/god/act'].includes(pathname)) {
      for (const w of data?.warnings ?? []) {
        if (typeof w === 'string' && /^env\.shared-clock\b/.test(w)) console.error(w);
        else if (w?.code === 'env.shared-clock') console.error(`${w.code}: ${w.detail ?? w.message ?? ''}`);
      }
    }
    if (as === 'god' && pathname === '/v1/god/preview' && data?.accepted && data.id && b?.claim && b.done) {
      // The commit must send only {preview}. Keep just the local completion
      // intent so a sealed claim done:true can clear its own file on success.
      const previews = Object.entries(load().buildPreviews ?? {}).slice(-19);
      save({ buildPreviews: { ...Object.fromEntries(previews), [data.id]: { id: b.id, claim: b.claim } } });
    }
    if (as !== 'god' || !(pathname === '/v1/god/act' || revertPath) || !data?.accepted) return r;
    if (b && !data.build && !s.buildEchoWarned) {
      console.error('this server does not record builds; progress is not shown');
      save({ buildEchoWarned: true });
    }
    if (data.build) {
      const ctx = context.getStore();
      if (ctx) ctx.suffix = buildSuffix(data.build, s.build);
      const current = load().build;
      if (current?.id === data.build.id) {
        const sealedDone = body?.preview && load().buildPreviews?.[body.preview];
        const claimDone = current.claim && ((b?.done && b.claim === current.claim) || (sealedDone?.id === current.id && sealedDone.claim === current.claim));
        if (['done', 'abandoned'].includes(data.build.status) || claimDone) save({ build: undefined, group: undefined, buildPreviews: undefined });
        else save({ build: { ...current, status: data.build.status } });
      }
    }
    return r;
  };
  const lost = (e) => {
    const slow = /timeout|abort/i.test(`${e?.name} ${e?.message}`);
    const detail = slow ? `the world did not answer within ${Math.round(timeoutMs / 1000)} s` : String(e?.message ?? e);
    const advice = recoverable ? ` Check \`request ${clientRef}\` before issuing a new edit; its outcome is unresolved.` : clientRef ? ' This endpoint has no receipt recovery; verify the world before issuing it again.' : '';
    return { status: 0, data: { ok: false, code: slow ? 'slow' : 'unreachable', ...(clientRef ? { clientRef } : {}), message: detail + advice } };
  };
  let failure, response;
  try { response = await send(path, verb, payload); } catch (e) { failure = e; }
  if (response) return finish(response);
  if (!recoverable) return lost(failure);

  // Only /act is bound durably to clientRef. A lookup failure is not proof the
  // edit is absent, so resend only after a definite 404, and at most once.
  const lookup = async () => send(`/v1/god/requests/${encodeURIComponent(clientRef)}`, 'GET', undefined, Math.min(timeoutMs, 10_000));
  const receiptResult = (r) => r.status === 200 && r.data?.result?.accepted === true ? { status: 200, data: { ...r.data.result, replayed: true, ...(r.data.inbox ? { inbox: r.data.inbox } : {}) } } : null;
  let receipt;
  try { receipt = await lookup(); } catch { return lost(failure); }
  const recovered = receiptResult(receipt);
  if (recovered) return finish(recovered);
  if (receipt.status !== 404) return lost(failure);
  try { response = await send(path, verb, payload); } catch (e) { failure = e; }
  if (response) return finish(response);
  // If the one resend also lost its response, a final read may still resolve it.
  try { receipt = await lookup(); } catch { return lost(failure); }
  return finish(receiptResult(receipt) ?? lost(failure));
}
/** CE8: tell the owner's viewer where the build lead is looking. One tiny POST that callers never await; it never
 *  throws, prints or retries, and is skipped without a lead build (claims, --no-build, EDEN_GOD_ATTENTION=off). */
export const ATTENTION_TIMEOUT_MS = 1000;
export function attention(at, eye) {
  try {
    const s = load(), b = s.build, point = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
    if (!s.world || !s.token || !b?.id || !b.lease || context.getStore()?.noBuild || /^(0|off|false|no)$/i.test(process.env.EDEN_GOD_ATTENTION ?? '') || !point(at)) return Promise.resolve(false);
    const body = JSON.stringify({ lease: b.lease, at: at.map(r2), ...(point(eye) ? { eye: eye.map(r2) } : {}) });
    return wireFetch(`${s.world}/v1/god/builds/${encodeURIComponent(b.id)}/attention`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${s.token}` }, body, signal: AbortSignal.timeout(ATTENTION_TIMEOUT_MS) })
      .then(async (r) => r.ok && (await r.json().catch(() => null))?.ok === true, () => false);
  } catch { return Promise.resolve(false); }
}
export const ok = (r, what) => { if (r.status >= 200 && r.status < 300) return r.data; throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`); };
export const num = (v) => { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`not a number: ${v}`); return n; };
export const r2 = (v) => Math.round(v * 100) / 100;
