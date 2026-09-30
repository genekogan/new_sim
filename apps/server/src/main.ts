import { createServer } from 'node:http';
import { join } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { toyFactory } from '@sim/engine-toy';
import { Auth } from './auth.ts';
import { Brain } from './brain.ts';
import { config } from './config.ts';
import { Db } from './db.ts';
import { buildApp } from './http.ts';
import { Hub } from './hub.ts';
import { handleMcp } from './mcp.ts';
import { Souls } from './souls.ts';
import { WORLD_ID, WorldHost } from './world.ts';

const NATIVES: { name: string; description: string }[] = [
  { name: 'Oda', description: 'a patient gardener who knows every bench and likes quiet mornings' },
  { name: 'Pim', description: 'a restless young musician who sings to anyone who will listen' },
  { name: 'Rowan', description: 'a curious wanderer who maps the edges of the ground and rarely sits still' },
  { name: 'Tamsin', description: 'a warm storyteller who keeps the campfire company and draws others in' },
  { name: 'Juno', description: 'a shy newcomer who watches from a distance before joining anything' },
  { name: 'Basil', description: 'a talkative kiosk regular who loves gossip and hates being alone' },
];

const db = new Db(join(config.dataDir, 'sim.db'));
const host = new WorldHost(db, toyFactory, config.worldSeed, config.snapshotEveryTicks);
const boot = host.boot();
console.log(`[world] ${WORLD_ID} booted from ${boot.from}, tick ${host.engine.world.tick}, replayed ${boot.replayed} events, ${host.minds.size} souls, rules ${host.engine.rulesVersion}`);

const auth = new Auth(config, db);
await auth.init().catch((e) => console.error('[auth] init failed:', e.message));

let hub!: Hub;
const brain = new Brain(host, db, config, {
  onCall: (c) => hub?.brainCall(c),
  onCamera: (line) => hub?.broadcast({ t: 'camera', line }),
  onTicker: (lines) => hub?.broadcast({ t: 'ticker', lines }),
  onNarrative: (view) => hub?.broadcast({ t: 'narrative', view }),
  clients: () => hub?.clients.size ?? 0,
});
const souls = new Souls(host, db, brain, config);

const server = createServer();
hub = new Hub(server, host, auth, db);
hub.brain = brain;
const app = buildApp({ cfg: config, db, host, auth, hub, brain, souls });
const listener = getRequestListener(app.fetch);
server.on('request', (req, res) => {
  if (req.url?.startsWith('/mcp')) { handleMcp(req, res, souls).catch((e) => { console.error('[mcp]', e); if (!res.headersSent) res.writeHead(500).end(); }); return; }
  void listener(req, res);
});

host.start();
if (config.seedNatives && db.liveSouls(WORLD_ID).length === 0) {
  for (const n of NATIVES) await souls.create('system', n, true);
  console.log(`[world] seeded ${NATIVES.length} native souls`);
}

server.listen(config.port, config.host, () => console.log(`[http] listening on http://${config.host}:${config.port} (public ${config.publicUrl}), brain ${brain.mode}, budget $${brain.budget}/day`));

let closing = false;
const shutdown = (sig: string) => {
  if (closing) return; closing = true;
  console.log(`[world] ${sig}: saving snapshot at tick ${host.engine.world.tick}`);
  host.stop();
  try { host.saveSnapshot(); } catch (e) { console.error('[world] snapshot failed', e); }
  server.close(); for (const c of hub.clients) c.ws.close(1001, 'server restarting');
  db.close(); process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// hourly on-box backup of the SQLite file
setInterval(() => { db.backupTo(join(config.dataDir, `backup-${new Date().toISOString().slice(0, 13).replace(/[-T:]/g, '')}.db`)).catch((e) => console.error('[backup]', e)); }, 3600_000).unref();
