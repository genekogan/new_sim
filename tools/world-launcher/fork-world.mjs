// A fork of an old world (eden, mars, littlemartians) as a world-launcher child (lane FORKS, 2026-10-11).
// The old worlds keep main's (e8) path: the same entry points as the laptop writers (tools/core/edge-server.mjs for
// Eden, tools/core/multiworld/world-server.mjs for Mars/LM) and the same option mapping as Codex's runner
// (successor-world-run.mjs; eden2 copy tools/world-launcher/deploy/old-worlds/run-world.mjs), but served under the
// launcher's base (<base>/w/<key>) on a launcher child port, from this release's code, with the launcher's build id.
//
//   node --experimental-transform-types [--env-file=<clerk.env>] tools/world-launcher/fork-world.mjs <fork.json>
//
// <fork.json> is Codex's descriptor without the per-process fields (input, dataDir, port, build, webDir, publicOrigin,
// cliFile, inputManifestSHA256, accountRegistryPath): those come from the launcher's env (PORT, DATA_DIR, WEB_DIR,
// PUBLIC_URL, WORLD_PATH, BUILD_ID, EDGE_CLI_FILE, ACCOUNT_REGISTRY_PATH). Relative paths in it resolve against this
// release. Gates: Clerk + an account registry, accepted history never shrinks, Soul rows unchanged by boot.
// Minds: none in the world (edge driver, fake brain, no model keys): $0 model spend.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const FORK_KEYS = Object.freeze(['eden', 'mars', 'littlemartians']);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const check = (v, m) => { if (!v) throw Error(m); };
const hash = (s) => createHash('sha256').update(s).digest('hex');

/** The entry-point options for one fork: the descriptor, with the launcher's per-process settings laid over it. */
export function forkOptions(d, env, root = ROOT) {
  const key = d.worldKey ?? 'eden';
  check(FORK_KEYS.includes(key), `not a forkable old world: ${key}`);
  check(typeof d.worldId === 'string' && d.worldId, 'descriptor: worldId required');
  const wp = env.WORLD_PATH ?? '', m = wp.match(/^(\/[a-z][a-z0-9-]{0,31})?\/w\/([a-z][a-z0-9-]{0,31})$/);
  check(m && m[2] === key, `WORLD_PATH ${wp} is not <base>/w/${key}`);
  // At the root only on the launcher that took the original worlds over (--old-worlds-root sets SIM_FORK_ROOT=1): the
  // laptop no longer serves them there. Any other launcher keeps its forks under its base.
  check(m[1] || env.SIM_FORK_ROOT === '1', 'a fork runs under a launcher base (e.g. /worlds), never at the root the old release serves');
  const at = (p) => (typeof p === 'string' && p ? (isAbsolute(p) ? p : join(root, p)) : undefined);
  for (const f of ['input', 'dataDir', 'port', 'build', 'webDir', 'publicOrigin', 'inputManifestSHA256', 'accountRegistryPath']) check(!(f in d), `descriptor field ${f} comes from the launcher; remove it`);
  const publicOrigin = (env.PUBLIC_URL ?? '').replace(/\/+$/, '');
  check(/^https?:\/\/[^/]+$/.test(publicOrigin), 'PUBLIC_URL (origin) required');
  return {
    ...d, worldKey: key, input: root, dataDir: resolve(env.DATA_DIR ?? ''), port: Number(env.PORT), build: env.BUILD_ID || 'dev',
    webDir: env.WEB_DIR ? resolve(env.WEB_DIR) : undefined, publicOrigin, basePath: m[1] ?? '', launcherChild: true,
    marsWebDir: at(d.marsWebDir) ?? (env.MARS_WEB_DIR ? resolve(env.MARS_WEB_DIR) : undefined),
    placeData: at(d.placeData), authoredBoundariesFile: at(d.authoredBoundariesFile), activitySpots: at(d.activitySpots),
    skillFile: at(d.skillFile), instructionsFile: at(d.instructionsFile),
    cliFile: env.EDGE_CLI_FILE ? resolve(env.EDGE_CLI_FILE) : at(d.cliFile),
    controllerCliFile: env.EDGE_CONTROLLER_CLI_FILE ? resolve(env.EDGE_CONTROLLER_CLI_FILE) : at(d.controllerCliFile),
  };
}

async function main() {
  const path = process.argv[2]; check(path, 'usage: fork-world.mjs <fork.json>');
  const d = forkOptions(JSON.parse(readFileSync(path, 'utf8')), process.env);
  check(process.env.AUTH_PROVIDER === 'clerk' && process.env.ACCOUNT_REGISTRY_PATH, 'a fork signs in with Clerk and its own account registry (AUTH_PROVIDER, ACCOUNT_REGISTRY_PATH)');
  check(process.env.BRAIN_MODE === 'fake' && !process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.TYPESAFE_API_KEY, 'a fork runs no model (fake brain, no keys)');
  const key = d.worldKey;
  // load the entry point's code first: under a release handover (SIM_STANDBY=1) the process waits here, nothing opened
  const entryFile = join(d.input, key === 'eden' ? 'tools/core/edge-server.mjs' : 'tools/core/multiworld/world-server.mjs');
  const entry = await import(pathToFileURL(entryFile).href);
  const { standby, rehearseRestore } = await import(pathToFileURL(join(ROOT, 'apps/server/src/standby.ts')).href);
  await standby(async () => {   // the server modules the entry point loads while it boots (same env, so the same config)
    const mods = ['db', 'world', 'auth', 'brain', 'souls', 'hub', 'http', 'mcp', 'living', 'world-request-path', 'edge/ledger/ledger', ...(key === 'eden' ? ['eden-bootstrap', 'intent-control'] : [])];
    // (lane Z1b) and every other module the entry point load()s while it boots (config.ts stays with the entry point,
    // which imports it with its own DATA_DIR): ~0.1 s of /w/eden's pause was module loading after the go
    const lazy = [...readFileSync(entryFile, 'utf8').matchAll(/load\('([^']+\.ts)'\)/g)].map((m) => m[1]).filter((m) => !m.endsWith('/config.ts'));
    for (const m of new Set([...mods.map((x) => `apps/server/src/${x}.ts`), 'packages/engine-mars/src/index.ts', ...lazy])) {
      try { await import(pathToFileURL(join(d.input, m)).href); } catch (e) { console.log(`[standby] not preloaded: ${m}: ${e.message}`); }
    }
    // (lane Z1b) Eden rehearses its restore as a /worlds world does (standby.ts rehearseRestore): the engine factory the
    // entry point builds, over a READ-ONLY connection (SQLite refuses writes; closed before the go: one writer), and the
    // restored engine's static navigation grids kept for the boot. Mars and Little Martians take over in ~1 s warm.
    if (key === 'eden') {
      const dbPath = join(d.dataDir, 'sim.db'), ro = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const { Db } = await import(pathToFileURL(join(d.input, 'apps/server/src/db.ts')).href), { edenHistoryFactory } = await import(pathToFileURL(join(d.input, 'apps/server/src/eden-bootstrap.ts')).href);
        const view = Object.assign(Object.create(Db.prototype), { db: ro, path: dbPath });   // a Db's reads on the read-only connection
        rehearseRestore(dbPath, d.worldId, await edenHistoryFactory(view, d.worldId, { lifeV1: true, newcomerResourcesV1: true, sleepSnapshotV1: true, groundV1: true, lectureV1: true }));
      } catch (e) { console.log(`[standby] restore rehearsal skipped: ${e.message}`); }
      finally { ro.close(); }
    }
  });
  const goAt = performance.now();
  const souls = (db) => db.prepare('SELECT id,entity_id,retired_at FROM souls WHERE world_id=? ORDER BY id').all(d.worldId);
  const cold = new DatabaseSync(join(d.dataDir, 'sim.db'), { readOnly: true });
  const before = { events: cold.prepare('SELECT count(*) n, max(seq) m FROM events WHERE world_id=?').get(d.worldId), soulsSHA256: hash(JSON.stringify(souls(cold))) };
  cold.close();
  check(before.events.n > 0, `no history for ${d.worldId} in ${d.dataDir}: a fork starts from a copy, never empty`);
  console.log(JSON.stringify({ phase: 'pre-boot', fork: key, worldId: d.worldId, ...before }));
  let app;
  const close = () => app.close();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { if (!app) process.exit(1); void close().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); }); });
  if (key === 'eden') {
    const { openEdgeServerV1 } = entry; const f = d.flags ?? {};
    app = await openEdgeServerV1({ ...d, accountAuth: true, seedObjects: d.objects, localBudget: 0, autonomous: false, quiesceThought: true, officeStairGuards: f.officeStairGuards ?? false, ambient: d.ambient !== false, humanRest: f.humanRest ?? true, provisions: f.provisions ?? true, sequences: f.sequences ?? true, floorGoals: f.floorGoals ?? true, kitchen: f.kitchen ?? true, shore: f.shore ?? true, foodDeliveryId: f.foodDeliveryId, quietLandingCourtesy: f.quietLandingCourtesy ?? true, social: f.social ?? true, approachRetention: f.approachRetention ?? true, closedGoals: f.closedGoals ?? true, activateExpansion: f.activateExpansion ?? true });
  } else {
    check(d.accountAuth === true && d.authMode === 'configured' && d.seedCast === false && d.nativeCast === false && d.runtimePolicies === false && d.nativeLifecycleV1 === true, 'native create/cast/policy settings differ from the old world');
    const { openWorldServer } = entry;
    app = await openWorldServer(d);
    check(app.lifecycleFact?.alreadyAccepted === true && app.souls.lifecycle, 'existing native lifecycle not preserved');
  }
  try {
    check(app.cfg.authProvider === 'clerk' && app.auth.ready && !app.auth.devAuth && app.host.worldId === d.worldId, 'configured authority/readiness differs');
    // (lane Z1b) counted, not read: loading every event (~35k on Eden) blocked the first /healthz ~0.1 s
    const events = app.db.db.prepare('SELECT count(*) n, max(seq) m FROM events WHERE world_id=?').get(d.worldId); check(events.n >= before.events.n, 'accepted history shrank during boot');
    check(hash(JSON.stringify(souls(app.db.db))) === before.soulsSHA256, 'current or retired Souls changed during boot');
    console.log(JSON.stringify({ phase: 'ready', fork: key, worldId: d.worldId, url: app.cfg.publicUrl, port: d.port, build: d.build, pid: process.pid, events: events.n, maxSeq: events.m ?? undefined, activeSouls: app.db.liveSouls(d.worldId).length, readyAtUTC: new Date().toISOString() }));
    if (process.env.SIM_STANDBY === '1') console.log(`[boot] ready ${((performance.now() - goAt) / 1000).toFixed(2)} s after the standby go`);
  } catch (error) { await close(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => { console.error('fork refused:', e.message); process.exit(1); });
}
