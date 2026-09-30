// WebSocket hub: many clients, one world. On join: welcome + snapshot (or a
// replay of missed batches). Then batches every 500 ms and a heartbeat every
// 5 s carrying the view hash so each client can verify its replica.
import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { PROTO, type BrainCall, type ClientMsg, type Me, type ServerMsg, type ServerStats } from '@sim/protocol';
import type { Auth } from './auth.ts';
import type { Brain } from './brain.ts';
import type { Db } from './db.ts';
import { WORLD_ID, type WorldHost } from './world.ts';

type Client = { ws: WebSocket; me: Me | null; ready: boolean; alive: boolean; joinedAt: number; resyncs: number; sent: number; ip: string };
const MAX_BUFFERED = 1_000_000;

export class Hub {
  wss: WebSocketServer;
  clients = new Set<Client>();
  brain!: Brain;
  startedAt = Date.now();
  host: WorldHost; auth: Auth; db: Db;

  constructor(server: Server, host: WorldHost, auth: Auth, db: Db) {
    this.host = host; this.auth = auth; this.db = db;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
    server.on('upgrade', (req, socket, head) => {
      if (!req.url?.startsWith('/ws')) { socket.destroy(); return; }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnect(ws, req));
    });
    host.listeners.push({
      onBatch: (b) => this.broadcast({ t: 'batch', ...b }),
      onHeartbeat: (h) => this.broadcast({ t: 'heartbeat', ...h, clients: this.clients.size }),
    });
    setInterval(() => this.sweep(), 15_000).unref();
    setInterval(() => this.broadcast({ t: 'stats', stats: this.stats() }), 2_000).unref();
  }

  private onConnect(ws: WebSocket, req: IncomingMessage) {
    const c: Client = { ws, me: null, ready: false, alive: true, joinedAt: Date.now(), resyncs: 0, sent: 0, ip: String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '') };
    this.clients.add(c);
    ws.on('pong', () => (c.alive = true));
    ws.on('close', () => this.clients.delete(c));
    ws.on('error', () => this.clients.delete(c));
    ws.on('message', (data) => { let m: ClientMsg; try { m = JSON.parse(String(data)); } catch { return; } void this.onMessage(c, m); });
  }

  private async onMessage(c: Client, m: ClientMsg) {
    if (m.t === 'ping') return this.send(c, { t: 'pong', n: m.n, serverTime: Date.now() });
    if (m.t === 'resync') { c.resyncs++; return this.send(c, { t: 'snapshot', reason: `resync: ${String(m.reason).slice(0, 80)}`, ...this.host.snapshotView() }); }
    if (m.t === 'hello') {
      if (m.proto !== PROTO) return this.send(c, { t: 'error', code: 'proto', message: `server speaks protocol ${PROTO}` });
      const u = await this.auth.userFromToken(m.token).catch(() => null);
      c.me = u ? this.auth.me(u) : null;
      const e = this.host.engine;
      this.send(c, { t: 'welcome', proto: PROTO, worldId: WORLD_ID, rulesVersion: e.rulesVersion, schema: e.schema, dt: e.dt, clockRate: this.host.clockRate, serverTick: e.world.tick, you: c.me, serverTime: Date.now() });
      // resume from the ring buffer if the client only missed a little; otherwise a full snapshot
      const ring = this.host.ring;
      const canResume = typeof m.since === 'number' && ring.length > 0 && m.since >= ring[0].seq - 1 && m.since <= this.host.currentBatchSeq;
      if (canResume) for (const b of ring) { if (b.seq > m.since!) this.send(c, { t: 'batch', ...b }); }
      else this.send(c, { t: 'snapshot', reason: typeof m.since === 'number' ? 'too far behind; full snapshot' : 'join', ...this.host.snapshotView() });
      this.send(c, { t: 'log', events: this.db.tailEvents(WORLD_ID, 150) });
      if (this.brain.camera) this.send(c, { t: 'camera', line: this.brain.camera });
      if (this.brain.ticker.length) this.send(c, { t: 'ticker', lines: this.brain.ticker.slice(-20) });
      for (const v of this.brain.narratives.values()) this.send(c, { t: 'narrative', view: v });
      if (c.me) this.send(c, { t: 'brain', calls: this.db.brainCalls(60) });
      this.send(c, { t: 'stats', stats: this.stats() });
      c.ready = true;
    }
  }

  private send(c: Client, m: ServerMsg) {
    if (c.ws.readyState !== 1) return;
    if (c.ws.bufferedAmount > MAX_BUFFERED) return; // slow client: skip; the heartbeat will make it resync
    const s = JSON.stringify(m); c.sent += s.length; c.ws.send(s);
  }
  broadcast(m: ServerMsg, filter?: (c: Client) => boolean) {
    const s = JSON.stringify(m);
    for (const c of this.clients) { if (!c.ready || c.ws.readyState !== 1 || (filter && !filter(c))) continue; if (c.ws.bufferedAmount > MAX_BUFFERED) continue; c.sent += s.length; c.ws.send(s); }
  }
  /** Brain internals go to signed-in clients only. */
  brainCall(call: BrainCall) { this.broadcast({ t: 'brain', calls: [call] }, (c) => !!c.me); }
  refreshMe(userId: string) { for (const c of this.clients) if (c.me?.userId === userId) { const u = this.db.user(userId); if (u) c.me = this.auth.me(u); } }

  private sweep() {
    for (const c of this.clients) { if (!c.alive) { c.ws.terminate(); this.clients.delete(c); continue; } c.alive = false; try { c.ws.ping(); } catch { /* closed */ } }
  }

  stats(): ServerStats {
    const h = this.host, ms = h.tickMs;
    return {
      tick: h.engine.world.tick, tickMsAvg: ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0, tickMsMax: ms.length ? Math.max(...ms) : 0,
      clients: this.clients.size, entities: Object.keys(h.engine.world.entities).length, souls: h.minds.size, liveActions: h.engine.runtime.liveIds().length,
      seq: h.seq, logEvents: h.seq, lastSnapshotTick: h.lastSnapshotTick, dbBytes: this.db.bytes(), uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      brain: { mode: this.brain.mode, callsToday: this.brain.callsToday, costToday: this.brain.spentToday, budget: this.brain.budget, inflight: this.brain.inflight.size, jevMsAvg: this.brain.jevMsAvg },
    };
  }
  clientList() { return [...this.clients].map((c) => ({ user: c.me?.short ?? 'anon', role: c.me?.role ?? null, joinedAt: c.joinedAt, resyncs: c.resyncs, sentBytes: c.sent, buffered: c.ws.bufferedAmount })); }
}
