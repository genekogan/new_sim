// Production mode for the world launcher (lane P3): what changes when the launcher serves
// sim.eden.art from eden2 instead of a laptop. Plain functions, no I/O beyond reading
// /proc/meminfo and renaming a log; launcher.mjs and children.mjs call them.
//
//   - slugs never collide with the worlds the existing release serves (EXISTING_WORLDS);
//   - a world cap (registered) and a running cap, plus a free-memory floor, so eden2 stays healthy;
//   - children get edge minds, fake brain, no model keys, and either dev auth (staging on
//     localhost only) or Clerk from the --auth-env file, which children load by path
//     (`node --env-file=<path>`, added by children.mjs defaultCommand; P1).
import { existsSync, readFileSync, renameSync, statSync } from 'node:fs';
import { freemem } from 'node:os';
import { isAbsolute } from 'node:path';

/**
 * World keys the existing release answers under /w/<key> on sim.eden.art (the laptop proxy
 * `tools/core/multiworld/proxy.mjs` KEYS, and the server's KNOWN_WORLD_KEYS). Caddy keeps
 * `/w/<key>*` for that release, so a launcher slug may neither equal nor start with one of them.
 */
export const EXISTING_WORLDS = Object.freeze(['eden', 'mars', 'littlemartians', 'toy']);

/** True when a slug could be routed to the existing release by a `/w/<key>*` path glob. */
export const shadowsExisting = (slug) => EXISTING_WORLDS.some((k) => slug === k || slug.startsWith(k));

/** Free memory the kernel could hand out now, in MB (Linux MemAvailable; elsewhere os.freemem()). */
export function memAvailableMb() {
  try {
    const m = readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)\s+kB/m);
    if (m) return Math.round(Number(m[1]) / 1024);
  } catch { /* not Linux */ }
  return Math.round(freemem() / 2 ** 20);
}

/**
 * Normalise and check the launcher's production settings. Throws with a reason a human can act on.
 * @param {{ devAuth?: boolean, publicOrigin?: string, authEnvFile?: string, maxWorlds?: number, maxRunning?: number,
 *           minFreeMb?: number, worldHeapMb?: number, range?: [number, number] }} cfg
 */
export function productionSettings(cfg, origin) {
  const devAuth = cfg.devAuth ?? !cfg.authEnvFile;
  const publicOrigin = (cfg.publicOrigin ?? origin).replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/.test(publicOrigin)) throw new Error(`launcher: public origin must be scheme://host[:port], got ${publicOrigin}`);
  if (devAuth && publicOrigin.startsWith('https://')) throw new Error('launcher: dev auth on a public https origin is refused (staging stays on localhost)');
  if (devAuth && cfg.authEnvFile) throw new Error('launcher: choose dev auth or an auth env file, not both');
  if (!devAuth && !cfg.authEnvFile) throw new Error('launcher: without dev auth an --auth-env file is required (the Clerk settings)');
  if (cfg.authEnvFile && (!isAbsolute(cfg.authEnvFile) || !existsSync(cfg.authEnvFile))) throw new Error(`launcher: auth env file must be an existing absolute path: ${cfg.authEnvFile}`);
  const range = cfg.range ?? [0, -1];
  const ports = range[1] - range[0] + 1;
  const maxRunning = cfg.maxRunning ?? ports;
  const maxWorlds = cfg.maxWorlds ?? 200;
  for (const [k, v] of Object.entries({ maxRunning, maxWorlds })) if (!Number.isInteger(v) || v < 1) throw new Error(`launcher: ${k} must be a positive integer`);
  if (ports > 0 && maxRunning > ports) throw new Error(`launcher: maxRunning ${maxRunning} exceeds the ${ports} child ports`);
  return {
    devAuth, publicOrigin, authEnvFile: cfg.authEnvFile ?? null, maxWorlds, maxRunning,
    minFreeMb: cfg.minFreeMb ?? 0, worldHeapMb: cfg.worldHeapMb ?? 0,
  };
}

/**
 * Wrap a child command with the production settings. The env is the child's whole environment
 * (children never inherit the launcher's), so what is set here is final; the --auth-env file
 * (passed by defaultCommand as `node --env-file`) only fills names this env leaves unset.
 */
export function decorateCommand({ cmd, args, env }, s) {
  const out = { ...env };
  // $0 model spend, always: the world runs no Soul or god mind; owners' agents do (/v1/edge, /v1/god).
  Object.assign(out, { MIND_DRIVER: 'edge', BRAIN_MODE: 'fake', ANTHROPIC_API_KEY: '', TYPESAFE_API_KEY: '', OPENAI_API_KEY: '' });
  if (s.devAuth) out.DEV_AUTH = '1'; else out.DEV_AUTH = '0';
  out.PUBLIC_URL = s.publicOrigin;
  if (s.worldHeapMb) out.NODE_OPTIONS = `--max-old-space-size=${s.worldHeapMb}`;
  return { cmd, args, env: out };
}

/** Keep one previous child log (`<slug>.log.1`) once the current one passes maxBytes. */
export function rotateLog(file, maxBytes = 20 * 2 ** 20) {
  try { if (statSync(file).size > maxBytes) renameSync(file, `${file}.1`); } catch { /* no log yet */ }
}
