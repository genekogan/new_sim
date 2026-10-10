#!/usr/bin/env node
// Start one local entity world for development or tests, with the right environment:
// fake minds, dev auth, its own data dir, and Mars/Eden assets served from disk (no upstream
// proxy, which hangs offline and starves the browser's connection pool).
//
//   node tools/god-skill/dev-world.mjs <slug> <port> [--data <dir>] [--genesis <file>] [--fresh]
//
// Returns when /healthz answers; prints the URL. Lanes use ports from their range (33 §8).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, openSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export async function startWorld({ slug, port, data, genesis, fresh = false, log } = {}) {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(slug ?? '')) throw new Error('slug: lowercase letters, digits, dashes');
  const dataDir = resolve(data ?? `${root}/.lane/data-${slug}`);
  if (fresh) rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  const marsWeb = resolve(root, '.lane/mars-web');
  const env = { ...process.env, WORLD_KEY: slug, WORLD_ID: `${slug}-1`, ENGINE: 'mars', PORT: String(port), DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', DATA_DIR: dataDir, PUBLIC_URL: `http://127.0.0.1:${port}`, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), ...(genesis ? { GENESIS_FILE: resolve(genesis) } : {}) };
  const out = log ? openSync(log, 'a') : 'ignore';
  const child = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, env, stdio: ['ignore', out, out], detached: !!log });
  const base = `http://127.0.0.1:${port}/w/${slug}`;
  for (let i = 0; i < 300; i++) { try { const r = await fetch(`${base}/healthz`); if (r.ok) return { child, base, dataDir }; } catch { /* booting */ } await new Promise((r) => setTimeout(r, 100)); }
  child.kill(); throw new Error(`world ${slug} did not come up on :${port}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [slug, port, ...rest] = process.argv.slice(2);
  const flag = (k) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : undefined; };
  const { child, base } = await startWorld({ slug, port: Number(port), data: flag('data'), genesis: flag('genesis'), fresh: rest.includes('--fresh'), log: `${root}/.lane/${slug}.log` });
  child.unref();
  console.log(`${base}?dev=1  (pid ${child.pid}, log .lane/${slug}.log)`);
  process.exit(0);
}
