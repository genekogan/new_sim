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
