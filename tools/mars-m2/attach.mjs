// Attach to a running local copy (tools/mars-m2/local-copy.mjs) with the same ctx shape as mars-rotation/proof/lib.mjs boot(),
// so its addSoul / follow / cliAct helpers drive a scripted CLI resident there. Local fake-mind worlds only.
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
export async function attach(out) {
  const c = JSON.parse(readFileSync(`${out}/copy.json`, 'utf8'));
  const ctx = { base: c.base, child: null, god: readFileSync(c.tokenFile, 'utf8').trim(), soul: '', cliDir: resolve(out, 'soul-cli-' + Date.now()) };
  mkdirSync(ctx.cliDir, { recursive: true, mode: 0o700 });
  ctx.api = async (path, { as = 'god', body } = {}) => {
    const auth = as === 'god' ? ctx.god : as === 'soul' ? ctx.soul : as === 'public' ? '' : `dev:${as}`;
    const r = await fetch(ctx.base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
    const d = await r.json(); if (!r.ok) throw Error(`API ${path}: ${r.status} ${d.code ?? d.error ?? ''}`); return d;
  };
  ctx.query = (b) => ctx.api('/v1/god/query', { body: b });
  return ctx;
}
/** lib.mjs addSoul with its own dev identity (souls are rate-limited per owner). */
export async function addSoulAs(ctx, identity, name) {
  const { writeFileSync } = await import('node:fs');
  const s = (await ctx.api('/v1/souls', { as: identity, body: { name, description: 'A scripted visitor; no LLM mind.' } })).soul;
  const pr = await ctx.api(`/v1/souls/${s.id}/pair`, { as: identity, body: {} });
  const pd = await ctx.api('/v1/agent/pair', { as: 'public', body: { code: pr.code, agent: 'lane M proof' } });
  ctx.soul = pd.token; ctx.soulRec = s;
  writeFileSync(resolve(ctx.cliDir, '.eden-agent.json'), JSON.stringify({ world: ctx.base, identity, soul: s.id, token: pd.token, mode: 'edge' }), { mode: 0o600 });
  for (let i = 0; i < 200; i++) { const o = await ctx.api('/v1/edge/observe', { as: 'soul' }).catch(() => null); if (o?.self?.position) return o; await new Promise((r) => setTimeout(r, 250)); }
  throw Error('soul never arrived');
}
