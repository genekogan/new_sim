// Provision a local dev world from a server root (the SOUL3 integration worktree) and describe it in world.json.
// DESIGN §4.1. Only world.kind "dev" is supported at this stage; fork/template-eden2/live are refused.
import { resolve, join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { sha256 } from '../lib/hash.mjs';
import { writeJson } from '../lib/jsonl.mjs';
import { sleep } from '../lib/clock.mjs';

export const RESERVED_KINDS = ['fork', 'template-eden2', 'live'];
export function assertKind(kind = 'dev') {
  if (kind === 'dev') return;
  if (RESERVED_KINDS.includes(kind)) throw new Error(`world.kind "${kind}" is reserved and not implemented at this stage; use "dev"`);
  throw new Error(`unknown world.kind "${kind}"`);
}

/** The environment §0 fixes for a dev world served from serverRoot. */
export function worldEnv(serverRoot) {
  const root = resolve(serverRoot);
  return {
    INVITE_REQUIRED: '0',
    EDGE_CONTROLLER_CLI_FILE: join(root, 'tools/world-launcher/soul/eden.mjs'),
    EDGE_CLI_FILE: join(root, 'tools/world-launcher/soul/eden-agent.mjs'),
    WEB_DIR: join(root, 'apps/web/dist'),
    // Not in DESIGN §0 but required: without these the world serves the 1.9 eden-agent.mjs guide (skill 1.9.5)
    // even though /eden.mjs is 2.0, and a seat following instructions.md would never touch eden.mjs.
    EDGE_SKILL_FILE: join(root, 'tools/world-launcher/soul/skill.md'),
    EDGE_INSTRUCTIONS_FILE: join(root, 'tools/world-launcher/soul/instructions.md'),
  };
}

export async function healthz(base) {
  try { const r = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(5000) }); return r.ok ? await r.json() : { ok: false, status: r.status }; }
  catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
}

async function served(base, path) {
  try {
    const r = await fetch(`${base}/${path}`, { signal: AbortSignal.timeout(10000) });
    const text = await r.text();
    const html = /^\s*<!doctype html/i.test(text);
    return r.ok && !html ? { ok: true, bytes: text.length, sha256: sha256(text), text } : { ok: false, status: r.status, html };
  } catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** startWorld({serverRoot, slug, port, genesis, dataDir, log, fresh}) → {base, pid, build, healthz, child, dataDir} */
export async function startWorld({ serverRoot, slug, port, genesis, dataDir, log, fresh = true, kind = 'dev' }) {
  assertKind(kind);
  const root = resolve(serverRoot);
  const devWorld = join(root, 'tools/god-skill/dev-world.mjs');
  if (!existsSync(devWorld)) throw new Error(`no dev-world.mjs under ${root}`);
  const env = worldEnv(root);
  for (const [k, v] of Object.entries(env)) if (k !== 'INVITE_REQUIRED' && !existsSync(v)) throw new Error(`${k} missing: ${v}`);
  if (log) mkdirSync(resolve(log, '..'), { recursive: true });
  const mod = await import(pathToFileURL(devWorld).href);
  // dev-world.mjs spreads process.env synchronously before its first await; set the §0 env only around the call.
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  let started;
  try {
    started = await mod.startWorld({ slug, port, data: dataDir ? resolve(dataDir) : undefined, genesis: genesis ? resolve(root, genesis) : undefined, fresh, log: log ? resolve(log) : undefined });
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  started.child.unref();
  const h = await healthz(started.base);
  return { base: started.base, pid: started.child.pid, build: h.build ?? null, healthz: h, child: started.child, dataDir: started.dataDir };
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** SIGTERM the world's process group (dev-world spawns it detached when logging), wait, SIGKILL after graceMs. */
export async function stopWorld({ pid, graceMs = 10000 }) {
  if (!pid) return { stopped: false, reason: 'no pid' };
  const kill = (sig) => { try { process.kill(-pid, sig); } catch { try { process.kill(pid, sig); } catch { /* gone */ } } };
  kill('SIGTERM');
  const end = Date.now() + graceMs;
  while (alive(pid) && Date.now() < end) await sleep(200);
  if (alive(pid)) { kill('SIGKILL'); await sleep(300); }
  return { stopped: !alive(pid) };
}

/** world.json: {kind, base, slug, port, pid, build, skill:{version, sha256}, cli:{eden.mjs, eden-agent.mjs, eden-god.mjs}, startedAt} */
export async function describeWorld({ base, slug, port, pid, build, kind = 'dev', startedAt }) {
  const [skill, eden, agent, god, instr] = await Promise.all(['skill.md', 'eden.mjs', 'eden-agent.mjs', 'god/eden-god.mjs', 'instructions.md'].map((p) => served(base, p)));
  const skillVersion = skill.ok ? (skill.text.match(/^\s*version:\s*"?([^"\s]+)/m)?.[1] ?? null) : null;
  const cliVersion = eden.ok ? (eden.text.match(/const VERSION = "([^"]+)"/)?.[1] ?? null) : null;
  return {
    kind, base, slug, port, pid, build,
    skill: { version: skillVersion, sha256: skill.sha256 ?? null },
    cli: { 'eden.mjs': eden.sha256 ?? null, 'eden.mjs.version': cliVersion, 'eden-agent.mjs': agent.sha256 ?? null, 'eden-god.mjs': god.sha256 ?? null },
    instructions: { sha256: instr.sha256 ?? null, mentionsEdenMjs: instr.ok ? /eden\.mjs/.test(instr.text.replace(/eden-agent\.mjs/g, '')) : null },
    startedAt,
  };
}

/** Convenience used by the smoke and playtest.mjs: start + describe + write world.json. */
export async function provision({ runDir, serverRoot, world }) {
  const startedAt = new Date().toISOString();
  const w = await startWorld({ serverRoot, slug: world.slug, port: world.port, genesis: world.genesis, kind: world.kind, dataDir: join(runDir, 'server', 'data'), log: join(runDir, 'server', 'world.log') });
  writeJson(join(runDir, 'server', 'healthz-before.json'), w.healthz);
  const desc = await describeWorld({ ...w, slug: world.slug, port: world.port, kind: world.kind ?? 'dev', startedAt });
  writeJson(join(runDir, 'world.json'), desc);
  return { ...desc, child: w.child };
}
