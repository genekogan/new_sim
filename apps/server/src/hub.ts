// WebSocket hub: many clients, one world. On join: welcome + snapshot (or a
// replay of missed batches). Then batches every 500 ms and a heartbeat every
// 5 s carrying the view hash so each client can verify its replica.
import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';
import { PROTO, publicEvent,stationHelloCapabilitiesV1Schema,negotiateStationContractV1,
  type StationLiveContract,type BrainCall, type ClientMsg, type Me, type ServerMsg, type ServerStats } from '@sim/protocol';
import type { Auth } from './auth.ts';
import type { Brain } from './brain.ts';
import type { Db } from './db.ts';
import { type WorldHost } from './world.ts';
import type { Souls } from './souls.ts';
import type {CandidateStationV1} from './station.ts';
import type {CandidateStationV2} from './station-v2.ts';

const clientMsg = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello'), proto: z.number(), token: z.string().max(4000).optional(), since: z.number().optional(), epoch: z.string().max(40).optional(),
    stationContracts:stationHelloCapabilitiesV1Schema.shape.stationContracts }),
  z.object({ t: z.literal('resync'), reason: z.string().max(200) }),
  z.object({ t: z.literal('ping'), n: z.number() }),
]);
const MAX_PER_IP = 30, MAX_CLIENTS = 2000;
type Client = { ws: WebSocket; me: Me | null; ready: boolean; alive: boolean; joinedAt: number; resyncs: number; sent: number; ip: string; msgs: number; windowStart: number; lastHello: number; lastSnapshot: number; stationContract:StationLiveContract|null };
/** What anyone may see of the server's numbers: spend is for admins. */
const publicStats = (st: ServerStats): ServerStats => ({ ...st, brain: { mode: st.brain.mode, callsToday: st.brain.callsToday, inflight: st.brain.inflight, jevMsAvg: st.brain.jevMsAvg } });
const MAX_BUFFERED = 1_000_000;

export class Hub {
  wss: WebSocketServer;
  clients = new Set<Client>();
  brain!: Brain;
  startedAt = Date.now();
  /** Changes with every start of the process: a client may resume only from batches this process sent. */
  epoch = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  build = 'dev';
  private lastTakeTick = -1;
  host: WorldHost; auth: Auth; db: Db;
  private lifecycleSouls?:Souls;
  private station?:CandidateStationV1;
  private stationV2?:CandidateStationV2;

  constructor(server: Server, host: WorldHost, auth: Auth, db: Db,lifecycleSouls?:Souls,station?:CandidateStationV1,stationV2?:CandidateStationV2) {
    this.host = host; this.auth = auth; this.db = db;
    if(station){if(station.host!==host)throw new Error('station must belong to selected Hub host');this.station=station;}
    if(stationV2){if(stationV2.host!==host)throw new Error('V2 station must belong to selected Hub host');this.stationV2=stationV2;}
    // Internal opt-in only; production bootstrap does not supply this adapter.
    if(lifecycleSouls){
      if(!lifecycleSouls.lifecycle||lifecycleSouls.host!==host||lifecycleSouls.db!==db)throw new Error('Lifecycle WS views require the installed candidate on this host/DB');
      this.lifecycleSouls=lifecycleSouls;
    }
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: {threshold: 1024, clientNoContextTakeover: true, serverNoContextTakeover: true, concurrencyLimit: 4} });
    server.on('upgrade', (req, socket, head) => {
      if (!req.url?.startsWith('/ws')) { socket.destroy(); return; }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnect(ws, req));
    });
    host.listeners.push({
      onApplied: e => { if (e.kind === 'rules' && e.payload?.recovery) { this.lastTakeTick=host.engine.world.tick; this.epoch=`${Date.now().toString(36)}-repair`; for (const c of this.clients) c.ws.close(1012, 'world restored; reconnect'); }
        if(e.kind==='station-rules-era-v1'){
          for(const c of this.clients){if(!c.ready)continue;
            if(c.stationContract==='station-live/1')this.welcomeClient(c);
            this.send(c,{t:'snapshot',reason:'recorded physical checkpoint',...host.snapshotView()});
          }
        }
        if(['station-epoch-v1','station-cue-v1','station-anchor-v1','station-rules-era-v1','station-cue-v2','station-anchor-v2'].includes(e.kind))
          for(const c of this.clients)if(c.ready)this.sendStation(c); },
      afterTick: tick => {
        const chunks = host.engine.takeChunks?.(this.lastTakeTick) ?? [];
        if (!chunks.length) return;
        for (const chunk of chunks) {
          const ref=(chunk.take as {renderSceneRef?:{hash:string}}).renderSceneRef;
          db.saveTake(host.worldId,chunk,ref&&!db.hasRenderSceneCapture(host.worldId,ref.hash)?host.engine.takeScene?.(ref.hash):undefined);
        }
        this.lastTakeTick = chunks.at(-1)!.toTick;
        if (chunks.length) this.broadcast({t: 'takes', serverTick: tick, chunks});
      },
      onBatch: (b) => this.broadcast({ t: 'batch', ...b, log: b.log.map(publicEvent) }),
      onHeartbeat: (h) => this.broadcast({ t: 'heartbeat', ...h, clients: this.clients.size }),
      onKernel: (view) => this.broadcast({ t: 'kernel', view }),
      onPlay: (p) => this.broadcast({ t: 'plays', plays: [p] }),
    });
    setInterval(() => this.sweep(), 15_000).unref();
    setInterval(() => { const full = this.stats(); this.broadcast({ t: 'stats', stats: full }, (c) => c.me?.role === 'admin'); this.broadcast({ t: 'stats', stats: publicStats(full) }, (c) => c.me?.role !== 'admin'); }, 2_000).unref();
    // a socket that never introduces itself is not a viewer
    setInterval(() => { const now = Date.now(); for (const c of this.clients) if (!c.ready && now - c.joinedAt > 15_000) { c.ws.close(1008, 'no hello'); this.clients.delete(c); } }, 5_000).unref();
  }

  private onConnect(ws: WebSocket, req: IncomingMessage) {
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
    let sameIp = 0; for (const x of this.clients) if (x.ip === ip) sameIp++;
    if (this.clients.size >= MAX_CLIENTS || sameIp >= MAX_PER_IP) { ws.close(1013, 'too many connections'); return; }
    const c: Client = { ws, me: null, ready: false, alive: true, joinedAt: Date.now(), resyncs: 0, sent: 0, ip, msgs: 0, windowStart: Date.now(), lastHello: 0, lastSnapshot: 0,stationContract:null };
    this.clients.add(c);
    ws.on('pong', () => (c.alive = true));
    ws.on('close', () => this.clients.delete(c));
    ws.on('error', () => this.clients.delete(c));
    ws.on('message', (data) => {
      // inbound messages are validated and rate limited (20 per 10 s is far more than a well-behaved client sends)
      const now = Date.now(); if (now - c.windowStart > 10_000) { c.windowStart = now; c.msgs = 0; }
      if (++c.msgs > 20) { ws.close(1008, 'too many messages'); return; }
      let raw: unknown; try { raw = JSON.parse(String(data)); } catch { return; }
      const p = clientMsg.safeParse(raw); if (!p.success) return;
      const pending=this.onMessage(c,p.data as ClientMsg);
      if(this.lifecycleSouls)void pending.catch(error=>this.privateViewFailed(c,error));
      else void pending;
    });
  }

  private async onMessage(c: Client, m: ClientMsg) {
    if (m.t === 'ping') return this.send(c, { t: 'pong', n: m.n, serverTime: Date.now() });
    // joining and resyncing each build a full view of the world: once every few seconds per socket is plenty
    const now = Date.now();
    if (m.t === 'resync') { if (now - c.lastSnapshot < 2_000) return; c.lastSnapshot = now; }
    if (m.t === 'hello') { if (now - c.lastHello < 3_000) return; c.lastHello = now; c.lastSnapshot = now; }
    if (m.t === 'resync') { c.resyncs++; return this.send(c, { t: 'snapshot', reason: `resync: ${String(m.reason).slice(0, 80)}`, ...this.host.snapshotView() }); }
    if (m.t === 'hello') {
      if (m.proto !== PROTO) { this.send(c, { t: 'welcome', build: this.build, proto: PROTO, worldId: this.host.worldId, rulesVersion: this.host.engine.rulesVersion, schema: this.host.engine.schema, dt: this.host.engine.dt, clockRate: this.host.clockRate, serverTick: this.host.engine.world.tick, you: null, serverTime: Date.now(), epoch: this.epoch }); return this.send(c, { t: 'error', code: 'proto', message: `server speaks protocol ${PROTO}` }); }
      const u = await this.auth.userFromToken(m.token).catch(() => null);
      c.me = u ? this.lifecycleSouls?this.currentMe(u.id):this.auth.me(u) : null;
      c.stationContract=negotiateStationContractV1(m.stationContracts?{stationContracts:m.stationContracts}:{},
        [...(this.station?['station-live/1' as const]:[]),...(this.stationV2?['station-live/2' as const]:[])]);
      const e = this.host.engine;
      this.welcomeClient(c);
      // resume from the ring buffer if the client only missed a little; otherwise a full snapshot
      const ring = this.host.ring;
      const canResume = typeof m.since === 'number' && m.epoch === this.epoch && ring.length > 0 && m.since >= ring[0].seq - 1 && m.since <= this.host.currentBatchSeq;
      if (canResume) for (const b of ring) { if (b.seq > m.since!) this.send(c, { t: 'batch', ...b, log: b.log.map(publicEvent) }); }
      else this.send(c, { t: 'snapshot', reason: typeof m.since === 'number' ? 'too far behind; full snapshot' : 'join', ...this.host.snapshotView() });
      this.send(c, { t: 'log', events: this.db.tailEvents(this.host.worldId, 150).map(publicEvent) });
      this.send(c, { t: 'kernel', view: this.host.kernelView() });
      this.send(c, { t: 'plays', plays: this.host.recentPlays.slice(-60) });
      this.send(c, { t: 'talk', lines: this.db.recentTalk(40) });
      if (this.brain.camera) this.send(c, { t: 'camera', line: this.brain.camera });
      if (this.brain.ticker.length) this.send(c, { t: 'ticker', lines: this.brain.ticker.slice(-20) });
      for (const v of this.brain.narratives.values()) this.send(c, { t: 'narrative', view: v });
      if (c.me) this.send(c, { t: 'brain', calls: this.db.brainCalls(40, { soulIds: c.me.role === 'admin' ? null : c.me.souls }) });
      this.send(c, { t: 'stats', stats: c.me?.role === 'admin' ? this.stats() : publicStats(this.stats()) });
      this.send(c, {t: 'takes', serverTick: e.world.tick, chunks: e.takeChunks?.(e.world.tick - 40) ?? []});
      this.sendStation(c);
      c.ready = true;
    }
  }
  private welcomeClient(c:Client){
    const h=this.host,e=h.engine;
    this.send(c,{t:'welcome',build:this.build,proto:PROTO,worldId:h.worldId,rulesVersion:e.rulesVersion,schema:e.schema,dt:e.dt,
      clockRate:h.clockRate,serverTick:e.world.tick,you:c.me,serverTime:Date.now(),epoch:this.epoch,paused:h.paused,
      ...(this.station||this.stationV2?{stationContract:c.stationContract}:{})});
  }
  private sendStation(c:Client){
    if(c.stationContract==='station-live/2'&&this.stationV2)this.send(c,{t:'station-v2',view:this.stationV2.view()});
    else if(c.stationContract==='station-live/1'&&this.station)this.send(c,{t:'station',view:this.station.view()});
  }

  private send(c: Client, m: ServerMsg) {
    if (c.ws.readyState !== 1) return;
    if (c.ws.bufferedAmount > MAX_BUFFERED) return; // slow client: skip; the heartbeat will make it resync
    const current=this.privateMessage(c,m);if(!current)return;
    const s = JSON.stringify(current); c.sent += s.length; c.ws.send(s);
  }
  /** No new private lifecycle fields are added to WS. Me retains its existing
   * shape but only usable identities; canonical public bodies/takes stay intact. */
  private currentMe(userId:string):Me|null{
    const user=this.db.user(userId);if(!user)return null;
    const me=this.auth.me(user),souls=this.lifecycleSouls;if(!souls)return me;
    return {...me,souls:souls.invited(user)?this.db.soulsOf(user.id).filter(row=>row.world_id===this.host.worldId&&souls.controlReady(row)).map(row=>row.id):[]};
  }
  private privateViewFailed(c:Client,error:unknown){
    // Preserve corrupt evidence for operator reconciliation. Neither an old Me
    // nor a normal arrival refusal may stand in for failed authority verification.
    c.me=null;c.ready=false;
    console.error('[hub] private view invariant failed',error);
    this.send(c,{t:'error',code:'private-view-unavailable',message:'Private view unavailable; reconnect after operator repair.'});
    c.ws.close(1011,'private view unavailable');
  }
  private refreshAuthority(c:Client):boolean{
    if(this.lifecycleSouls&&c.me){
      try{c.me=this.currentMe(c.me.userId);}
      catch(error){this.privateViewFailed(c,error);return false;}
    }
    return true;
  }
  private privateMessage(c:Client,m:ServerMsg):ServerMsg|null{
    if(!this.lifecycleSouls)return m;
    if(m.t==='welcome'){if(!this.refreshAuthority(c))return null;return {...m,you:c.me};}
    if(m.t==='stats'){if(!this.refreshAuthority(c))return null;return c.me?.role==='admin'?m:{...m,stats:publicStats(m.stats)};}
    if(m.t==='brain'){
      if(!this.refreshAuthority(c)||!c.me)return null;
      const calls=m.calls.filter(call=>c.me!.role==='admin'||(!!call.soulId&&c.me!.souls.includes(call.soulId)));
      return calls.length?{t:'brain',calls}:null;
    }
    return m;
  }
  broadcast(m: ServerMsg, filter?: (c: Client) => boolean) {
    if(this.lifecycleSouls&&(m.t==='brain'||m.t==='stats')){
      for(const c of this.clients){
        if(!c.ready||c.ws.readyState!==1)continue;
        if(!this.refreshAuthority(c)||filter&&!filter(c))continue;this.send(c,m);
      }
      return;
    }
    const s = JSON.stringify(m);
    for (const c of this.clients) { if (!c.ready || c.ws.readyState !== 1 || (filter && !filter(c))) continue; if (c.ws.bufferedAmount > MAX_BUFFERED) continue; c.sent += s.length; c.ws.send(s); }
  }
  /** Model calls go to admins, and to the owner of the Soul a call is about. World-level calls (narrator, director) are admin only. */
  brainCall(call: BrainCall) { this.broadcast({ t: 'brain', calls: [call] }, (c) => !!c.me && (c.me.role === 'admin' || (!!call.soulId && c.me.souls.includes(call.soulId)))); }
  refreshMe(userId: string) { for (const c of this.clients) if (c.me?.userId === userId) { if(this.lifecycleSouls)this.refreshAuthority(c);else{const u = this.db.user(userId); if (u) c.me = this.auth.me(u);} } }

  private sweep() {
    for (const c of this.clients) { if (!c.alive) { c.ws.terminate(); this.clients.delete(c); continue; } c.alive = false; try { c.ws.ping(); } catch { /* closed */ } }
  }

  stats(): ServerStats {
    const h = this.host, ms = h.tickMs;
    return {
      tick: h.engine.world.tick, tickMsAvg: ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0, tickMsMax: ms.length ? Math.max(...ms) : 0,
      clients: this.clients.size, entities: Object.keys(h.engine.world.entities).length, souls: h.minds.size, liveActions: h.engine.runtime.liveIds().length,
      seq: h.seq, logEvents: h.seq, lastSnapshotTick: h.lastSnapshotTick, snapshotMs: h.snapshotMs, build: this.build, dbBytes: this.db.bytes(), uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      brain: { mode: this.brain.mode, callsToday: this.brain.callsToday, costToday: this.brain.spentToday, budget: this.brain.budget, inflight: this.brain.inflight.size, jevMsAvg: this.brain.jevMsAvg },
    };
  }
  clientList() { return [...this.clients].map((c) => ({ user: c.me?.short ?? 'anon', role: c.me?.role ?? null, joinedAt: c.joinedAt, resyncs: c.resyncs, sentBytes: c.sent, buffered: c.ws.bufferedAmount })); }
}
