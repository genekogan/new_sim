import { writeFileSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWorld } from '../../god-skill/dev-world.mjs';
const exec = promisify(execFile);
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'); // this checkout, whichever worktree
export const MARS_TWO_TEMPLATE = resolve(ROOT, 'worlds/templates/mars-two.json');
export const PATCH = resolve(ROOT, 'tools/mars-rotation/patch.mjs');
export const delay = (ms) => new Promise((r) => setTimeout(r, ms));
export async function boot({ slug = 'mars-rot', port, template, out, noGenesis }) {
  mkdirSync(out, { recursive: true, mode: 0o700 });
  Object.assign(process.env, { WEB_DIR: `${ROOT}/apps/web/dist`, MARS_WEB_DIR: `${ROOT}/.lane/mars-web`, BRAIN_MODE: 'fake', INVITE_REQUIRED: '0', SOUL_LIFECYCLE: '1', MIND_DRIVER: 'edge', ENABLE_WORLD_ENGINE: '1', HOST: '127.0.0.1', TAKES_PERSIST: '0', ARCHIVE_TAKES: '0' });
  const w = await startWorld({ slug, port, data: resolve(out, 'data'), genesis: template, fresh: true, log: resolve(out, 'server.log') });
  const base = w.base;
  const ctx = { base, child: w.child, god: '', soul: '', cliDir: resolve(out, 'soul-cli') };
  mkdirSync(ctx.cliDir, { recursive: true, mode: 0o700 });
  ctx.api = async (path, { as = 'god', body } = {}) => {
    const auth = as === 'god' ? ctx.god : as === 'soul' ? ctx.soul : as === 'public' ? '' : `dev:${as}`;
    const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
    const d = await r.json(); if (!r.ok) throw Error(`API ${path}: ${r.status} ${d.code ?? d.error ?? ''}`); return d;
  };
  ctx.query = (b) => ctx.api('/v1/god/query', { body: b });
  ctx.god = (await ctx.api('/v1/god/mint', { as: 'admin', body: { label: 'mars rotation proof' } })).token;
  return ctx;
}
export async function addSoul(ctx, name = 'Walker') {
  const s = (await ctx.api('/v1/souls', { as: 'walker', body: { name, description: 'A scripted visitor; no LLM mind.' } })).soul;
  const pr = await ctx.api(`/v1/souls/${s.id}/pair`, { as: 'walker', body: {} });
  const pd = await ctx.api('/v1/agent/pair', { as: 'public', body: { code: pr.code, agent: 'mars rotation proof' } });
  ctx.soul = pd.token; ctx.soulRec = s;
  writeFileSync(resolve(ctx.cliDir, '.eden-agent.json'), JSON.stringify({ world: ctx.base, identity: 'walker', soul: s.id, token: pd.token, mode: 'edge' }), { mode: 0o600 });
  for (let i = 0; i < 200; i++) { const o = await ctx.api('/v1/edge/observe', { as: 'soul' }).catch(() => null); if (o?.self?.position) return o; await delay(250); }
  throw Error('soul never arrived');
}
export async function cliAct(ctx, capability, params) {
  let stdout; try { ({ stdout } = await exec(process.execPath, [`${ROOT}/tools/edge-skill/eden-agent.mjs`, 'act', capability, ...(params ? [JSON.stringify(params)] : [])], { cwd: ctx.cliDir, timeout: 45000, env: { ...process.env, EDEN_AGENT_NO_DASHBOARD: '1', BRAIN_MODE: 'fake' } })); } catch (e) { stdout = e.stdout || ''; if (!stdout.includes('{')) return { accepted: false, code: 'cli-exit', reason: String(e.stderr || e.message).slice(0, 300) }; }
  return JSON.parse(stdout.slice(stdout.indexOf('{')));
}
export async function follow(ctx, capability, { params, timeout = 150000, seated, onSample } = {}) {
  const acted = await cliAct(ctx, capability, params);
  if (!acted.accepted) return { capability, accepted: false, code: acted.code, reason: acted.reason };
  const id = acted.receipt?.id; const t0 = Date.now(); let last, phase, code;
  while (Date.now() - t0 < timeout) {
    const o = await ctx.api('/v1/edge/observe', { as: 'soul' }); last = o.self; await onSample?.(last);
    const r = (await ctx.api(`/v1/edge/receipts/${encodeURIComponent(id)}`, { as: 'soul' })).receipt; phase = r?.phase; code = r?.code ?? r?.reason;
    if (['failed', 'replaced', 'cancelled'].includes(phase)) return { capability, accepted: true, phase, code, end: last?.position };
    if (seated ? last.activity === 'sit' : phase === 'completed') break;
    await delay(250);
  }
  const w = (await ctx.query({ where: [last.position[0], last.position[2]] })).where;
  return { capability, accepted: true, phase, code, ok: seated ? last.activity === 'sit' : phase === 'completed', end: last.position, activity: last.activity, room: w?.room ?? null, ms: Date.now() - t0 };
}
export async function stop(ctx) {
  if (ctx.child && ctx.child.exitCode === null) { try { process.kill(-ctx.child.pid, 'SIGTERM'); } catch { ctx.child.kill('SIGTERM'); } await delay(2500); }
}
