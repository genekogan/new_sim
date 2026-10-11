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
  check(m[1], 'a fork runs under a launcher base (e.g. /worlds), never at the root the old release serves');
  const at = (p) => (typeof p === 'string' && p ? (isAbsolute(p) ? p : join(root, p)) : undefined);
  for (const f of ['input', 'dataDir', 'port', 'build', 'webDir', 'publicOrigin', 'inputManifestSHA256', 'accountRegistryPath']) check(!(f in d), `descriptor field ${f} comes from the launcher; remove it`);
  const publicOrigin = (env.PUBLIC_URL ?? '').replace(/\/+$/, '');
  check(/^https?:\/\/[^/]+$/.test(publicOrigin), 'PUBLIC_URL (origin) required');
  return {
    ...d, worldKey: key, input: root, dataDir: resolve(env.DATA_DIR ?? ''), port: Number(env.PORT), build: env.BUILD_ID || 'dev',
    webDir: env.WEB_DIR ? resolve(env.WEB_DIR) : undefined, publicOrigin, basePath: m[1],
    marsWebDir: at(d.marsWebDir) ?? (env.MARS_WEB_DIR ? resolve(env.MARS_WEB_DIR) : undefined),
    placeData: at(d.placeData), authoredBoundariesFile: at(d.authoredBoundariesFile), activitySpots: at(d.activitySpots),
    skillFile: at(d.skillFile), instructionsFile: at(d.instructionsFile),
    cliFile: env.EDGE_CLI_FILE ? resolve(env.EDGE_CLI_FILE) : at(d.cliFile),
  };
}

async function main() {
  const path = process.argv[2]; check(path, 'usage: fork-world.mjs <fork.json>');
  const d = forkOptions(JSON.parse(readFileSync(path, 'utf8')), process.env);
  check(process.env.AUTH_PROVIDER === 'clerk' && process.env.ACCOUNT_REGISTRY_PATH, 'a fork signs in with Clerk and its own account registry (AUTH_PROVIDER, ACCOUNT_REGISTRY_PATH)');
  check(process.env.BRAIN_MODE === 'fake' && !process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.TYPESAFE_API_KEY, 'a fork runs no model (fake brain, no keys)');
  const key = d.worldKey;
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
    const { openEdgeServerV1 } = await import(pathToFileURL(join(d.input, 'tools/core/edge-server.mjs')).href); const f = d.flags ?? {};
    app = await openEdgeServerV1({ ...d, accountAuth: true, seedObjects: d.objects, localBudget: 0, autonomous: false, quiesceThought: true, officeStairGuards: f.officeStairGuards ?? false, ambient: d.ambient !== false, humanRest: f.humanRest ?? true, provisions: f.provisions ?? true, sequences: f.sequences ?? true, floorGoals: f.floorGoals ?? true, kitchen: f.kitchen ?? true, shore: f.shore ?? true, foodDeliveryId: f.foodDeliveryId, quietLandingCourtesy: f.quietLandingCourtesy ?? true, social: f.social ?? true, approachRetention: f.approachRetention ?? true, closedGoals: f.closedGoals ?? true, activateExpansion: f.activateExpansion ?? true });
  } else {
    check(d.accountAuth === true && d.authMode === 'configured' && d.seedCast === false && d.nativeCast === false && d.runtimePolicies === false && d.nativeLifecycleV1 === true, 'native create/cast/policy settings differ from the old world');
    const { openWorldServer } = await import(pathToFileURL(join(d.input, 'tools/core/multiworld/world-server.mjs')).href);
    app = await openWorldServer(d);
    check(app.lifecycleFact?.alreadyAccepted === true && app.souls.lifecycle, 'existing native lifecycle not preserved');
  }
  try {
    check(app.cfg.authProvider === 'clerk' && app.auth.ready && !app.auth.devAuth && app.host.worldId === d.worldId, 'configured authority/readiness differs');
    const events = app.db.events(d.worldId); check(events.length >= before.events.n, 'accepted history shrank during boot');
    check(hash(JSON.stringify(souls(app.db.db))) === before.soulsSHA256, 'current or retired Souls changed during boot');
    console.log(JSON.stringify({ phase: 'ready', fork: key, worldId: d.worldId, url: app.cfg.publicUrl, port: d.port, build: d.build, pid: process.pid, events: events.length, maxSeq: events.at(-1)?.seq, activeSouls: app.db.liveSouls(d.worldId).length, readyAtUTC: new Date().toISOString() }));
  } catch (error) { await close(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => { console.error('fork refused:', e.message); process.exit(1); });
}
