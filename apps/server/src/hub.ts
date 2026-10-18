// WebSocket hub: many clients, one world. On join: welcome + snapshot (or a
// replay of missed batches). Then batches every 500 ms and a heartbeat every
// 5 s carrying the view hash so each client can verify its replica.
import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';
import {randomUUID} from 'node:crypto';
import { PROTO, publicEvent,TAKE_BOUNDARY_WIRE_V1,stringifyTakeBoundaryWireV1,TAKE_ENTITIES_WIRE_V1,TakeEntitiesEncoderV1,TAKE_CHUNKS_WIRE_V1,TakeChunksEncoderV1,kernelRestV1,stationHelloCapabilitiesV1Schema,negotiateStationContractV1,meLiveDescriptorV1Schema,meLiveViewV1Schema,
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
    stationContracts:stationHelloCapabilitiesV1Schema.shape.stationContracts,takeTransport:z.literal(TAKE_BOUNDARY_WIRE_V1).optional(),
    // an unknown later contract is not an error: the peer simply gets the full table
    takeEntities:z.string().max(40).optional(),takeChunks:z.string().max(40).optional() }),
  z.object({ t: z.literal('resync'), reason: z.string().max(200) }),
  z.object({ t: z.literal('ping'), n: z.number() }),
]);
const MAX_PER_IP = 30, MAX_CLIENTS = 2000;
type Client = { ws: WebSocket; me: Me | null; ready: boolean; alive: boolean; joinedAt: number; resyncs: number; sent: number; ip: string; msgs: number; windowStart: number; lastHello: number; lastSnapshot: number; stationContract:StationLiveContract|null;
  authUserId?:string|null;helloGeneration?:number;meScope?:{contract:'me-live/1';connectionId:string;userId:string|null;revision:number;worldId:string;epoch:string};publishedMe?:string;takeTransport?:typeof TAKE_BOUNDARY_WIRE_V1;
  /** take-entities-ref/1 peers: the id of the last entity table this socket was sent (null: none yet). */
  takeEntities?:{last:number|null};
  /** take-chunk-ref/1 peers: the id of the last take this socket was sent (null: none yet) and the last kernel view sent
   *  without its tick (kernelRestV1). */
  takeChunks?:{last:number|null;kernel?:string};
  /** Set by a join until the first takes message with a chunk is written: that one is never dropped for backpressure. */
  awaitingTakes?:boolean;joinSend?:boolean };
/** What anyone may see of the server's numbers: spend is for admins. */
const publicStats = (st: ServerStats): ServerStats => ({ ...st, brain: { mode: st.brain.mode, callsToday: st.brain.callsToday, inflight: st.brain.inflight, jevMsAvg: st.brain.jevMsAvg } });
const MAX_BUFFERED = 1_000_000;

/** Live viewers never read a take's static physics (entityPhysicsV1: every building's floors, walls and stairs; they
 *  draw geometry from /v1/scene). On a built world it is ~3 MB of JSON per one-second chunk (Eden 2026), so the live
 *  stream leaves it out; recorded takes (TAKES_PERSIST) and HTTP history keep the full chunk. */
export function viewerChunk<T>(chunk: T): T {
  const c = chunk as { take?: { finalState?: Record<string, unknown> } };
  const state = c?.take?.finalState; if (!state || state.entityPhysicsV1 === undefined) return chunk;
  const { entityPhysicsV1: _omit, ...rest } = state;
  return { ...c, take: { ...c.take, finalState: rest } } as T;
}
/** P2 (E-life): an HTTP take history reply (/v1/takes, /v1/take) as the live stream sends it, without each chunk's static
 *  physics; `full` (the `?physics=1` query) keeps the canonical chunks for tools that replay from them. */
/** The join's display log (the `log` message; clients only show it, the replica comes from the snapshot or batches): a
 *  world-edit event's payload is the commit's derived physics and assets (the Eden 2026 genesis batch: 4.1 MB). Its result
 *  is already in the world the client receives; the row keeps its seq, tick, author and identity, GET /v1/log the rest. */
export function joinLogEvent<T extends {kind:string;payload?:unknown}>(e:T):T{
  if(e.kind!=='world-edit'||!e.payload||typeof e.payload!=='object')return e;
  const p=e.payload as {contract?:unknown;seq?:unknown;hash?:unknown};
  return {...e,payload:{contract:p.contract,seq:p.seq,hash:p.hash,omitted:'physics and assets (in the world state; GET /v1/log for the full event)'}};
}
export function publicTakes<T>(value: T, full = false): T {
  const v = value as { chunks?: unknown[] };
  return !full && Array.isArray(v?.chunks) ? { ...v, chunks: v.chunks.map((k) => viewerChunk(k)) } as T : value;
}
export class Hub {
  wss: WebSocketServer;
  /** Other WebSocket endpoints on this server (EVENTS-v1 /v1/edge/events/ws); each returns true when it took the upgrade. */
  upgradeHandlers: ((req: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => boolean)[] = [];
  clients = new Set<Client>();
  brain!: Brain;
  startedAt = Date.now();
  /** Changes with every start of the process: a client may resume only from batches this process sent. */
  epoch = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  build = 'dev';
  private lastTakeTick = -1;
  /** take-entities-ref/1: one table registry for every peer that announced it (see packages/protocol take-entities-wire). */
  readonly takeEntities = new TakeEntitiesEncoderV1();
  readonly takeChunks = new TakeChunksEncoderV1();
  /** Take recordings (take_chunks) are a pose-keyframe cache, off by default (TAKES_PERSIST=1 turns them on).
   * The engine's in-memory live buffer still feeds new viewers; the event log rebuilds a world. */
  persistTakes = process.env.TAKES_PERSIST === '1';
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
      if (!req.url?.startsWith('/ws')) { for (const h of this.upgradeHandlers) { try { if (h(req, socket, head)) return; } catch { /* a handler fault falls through */ } } socket.destroy(); return; }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnect(ws, req));
    });
    host.listeners.push({
      onClockUnavailable:()=>{for(const c of this.clients){c.ready=false;c.ws.close(1013,'world unavailable');}},
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
          const scene=ref&&!db.hasRenderSceneCapture(host.worldId,ref.hash)?host.engine.takeScene?.(ref.hash):undefined;
          if(this.persistTakes)db.saveTake(host.worldId,chunk,scene);
          else if(scene)db.saveRenderSceneCapture(host.worldId,scene);
        }
        this.lastTakeTick = chunks.at(-1)!.toTick;
        if (chunks.length) this.broadcast({t: 'takes', serverTick: tick, chunks: chunks.map(viewerChunk)});
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
    const c: Client = { ws, me: null, ready: false, alive: true, joinedAt: Date.now(), resyncs: 0, sent: 0, ip, msgs: 0, windowStart: Date.now(), lastHello: 0, lastSnapshot: 0,stationContract:null,authUserId:null,helloGeneration:0 };
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
      const generation=c.helloGeneration;
      if(this.lifecycleSouls)void pending.catch(error=>{if(this.clients.has(c)&&c.helloGeneration===generation)this.privateViewFailed(c,error);});
      else void pending;
    });
  }

  private async onMessage(c: Client, m: ClientMsg) {
    if(!this.host.clockAvailable){c.ready=false;c.ws.close(1013,'world unavailable');return;}
    if (m.t === 'ping') return this.send(c, { t: 'pong', n: m.n, serverTime: Date.now() });
    // joining and resyncing each build a full view of the world: once every few seconds per socket is plenty
    const now = Date.now();
    if (m.t === 'resync') { if (now - c.lastSnapshot < 2_000) return; c.lastSnapshot = now; }
    if (m.t === 'hello') { if (now - c.lastHello < 3_000) return; c.lastHello = now; c.lastSnapshot = now; }
    if (m.t === 'resync') { c.resyncs++; return this.send(c, { t: 'snapshot', reason: `resync: ${String(m.reason).slice(0, 80)}`, ...this.host.snapshotView() }); }
    if (m.t === 'hello') {
      const generation=(c.helloGeneration??0)+1;c.helloGeneration=generation;
      c.ready=false;c.me=null;c.authUserId=null;c.meScope=undefined;c.publishedMe=undefined;c.takeTransport=undefined;c.takeEntities=undefined;c.takeChunks=undefined;c.awaitingTakes=false;
      if (m.proto !== PROTO) { this.send(c, { t: 'welcome', build: this.build, proto: PROTO, worldId: this.host.worldId, rulesVersion: this.host.engine.rulesVersion, schema: this.host.engine.schema, dt: this.host.engine.dt, clockRate: this.host.clockRate, serverTick: this.host.engine.world.tick, you: null, serverTime: Date.now(), epoch: this.epoch }); return this.send(c, { t: 'error', code: 'proto', message: `server speaks protocol ${PROTO}` }); }
      const u = await this.auth.userFromToken(m.token).catch(() => null);
      if(!this.clients.has(c)||c.helloGeneration!==generation||c.ws.readyState!==1||!this.host.clockAvailable)return;
      c.authUserId=u&&(!this.lifecycleSouls||this.db.user(u.id))?u.id:null;
      c.me = u ? this.lifecycleSouls?this.currentMe(u.id):this.auth.me(u) : null;
      c.takeTransport=m.takeTransport===TAKE_BOUNDARY_WIRE_V1?TAKE_BOUNDARY_WIRE_V1:undefined;
      c.takeEntities=m.takeEntities===TAKE_ENTITIES_WIRE_V1?{last:null}:undefined;
      c.takeChunks=m.takeChunks===TAKE_CHUNKS_WIRE_V1?{last:null}:undefined;
      c.stationContract=negotiateStationContractV1(m.stationContracts?{stationContracts:m.stationContracts}:{},
        [...(this.station?['station-live/1' as const]:[]),...(this.stationV2?['station-live/2' as const]:[])]);
      const e = this.host.engine;
      if(!this.welcomeClient(c))return;
      // resume from the ring buffer if the client only missed a little; otherwise a full snapshot
      const ring = this.host.ring;
      // the join set is bounded (one per hello, hellos at most every 3 s) and is never dropped for backpressure
      c.joinSend=true;c.awaitingTakes=true;
      try{
      const canResume = typeof m.since === 'number' && m.epoch === this.epoch && ring.length > 0 && m.since >= ring[0].seq - 1 && m.since <= this.host.currentBatchSeq;
      if (canResume) for (const b of ring) { if (b.seq > m.since!) this.send(c, { t: 'batch', ...b, log: b.log.map(publicEvent) }); }
      else this.send(c, { t: 'snapshot', reason: typeof m.since === 'number' ? 'too far behind; full snapshot' : 'join', ...this.host.snapshotView() });
      this.send(c, { t: 'log', events: this.db.tailEvents(this.host.worldId, 150).map(e=>joinLogEvent(publicEvent(e))) });
      this.send(c, { t: 'kernel', view: this.host.kernelView() });
      this.send(c, { t: 'plays', plays: this.host.recentPlays.slice(-60) });
      this.send(c, { t: 'talk', lines: this.db.recentTalk(40) });
      if (this.brain.camera) this.send(c, { t: 'camera', line: this.brain.camera });
      if (this.brain.ticker.length) this.send(c, { t: 'ticker', lines: this.brain.ticker.slice(-20) });
      for (const v of this.brain.narratives.values()) this.send(c, { t: 'narrative', view: v });
      if (c.me) this.send(c, { t: 'brain', calls: this.db.brainCalls(40, { soulIds: c.me.role === 'admin' ? null : c.me.souls }) });
      this.send(c, { t: 'stats', stats: c.me?.role === 'admin' ? this.stats() : publicStats(this.stats()) });
      this.send(c, {t: 'takes', serverTick: e.world.tick, chunks: (e.takeChunks?.(e.world.tick - 40) ?? []).map(viewerChunk)});
      for (const extra of this.joinMessages) { try { for (const x of extra()) this.send(c, x as ServerMsg); } catch { /* optional standing state */ } }
      this.sendStation(c);
      }finally{c.joinSend=false;}
      c.ready = c.ws.readyState===1&&c.helloGeneration===generation;
    }
  }
  private welcomeClient(c:Client){
    const h=this.host,e=h.engine;
    if(!this.refreshAuthority(c,false))return false;
    if(this.lifecycleSouls)c.meScope={...meLiveDescriptorV1Schema.parse({contract:'me-live/1',connectionId:randomUUID(),userId:c.authUserId??c.me?.userId??null,revision:1}),worldId:h.worldId,epoch:this.epoch};
    const sent=this.send(c,{t:'welcome',build:this.build,proto:PROTO,worldId:h.worldId,rulesVersion:e.rulesVersion,schema:e.schema,dt:e.dt,
      clockRate:h.clockRate,serverTick:e.world.tick,you:c.me,serverTime:Date.now(),epoch:this.epoch,paused:h.paused,
      ...(this.lifecycleSouls?{privateMe:{contract:'me-live/1' as const,connectionId:c.meScope!.connectionId,userId:c.meScope!.userId,revision:1 as const}}:{}),
      ...(this.station||this.stationV2?{stationContract:c.stationContract}:{}),...(c.takeTransport?{takeTransport:c.takeTransport}:{}),...(c.takeEntities?{takeEntities:TAKE_ENTITIES_WIRE_V1}:{}),...(c.takeChunks?{takeChunks:TAKE_CHUNKS_WIRE_V1}:{})});
    if(sent)c.publishedMe=JSON.stringify(c.me);return sent;
  }
  private sendStation(c:Client){
    if(c.stationContract==='station-live/2'&&this.stationV2)this.send(c,{t:'station-v2',view:this.stationV2.view()});
    else if(c.stationContract==='station-live/1'&&this.station)this.send(c,{t:'station',view:this.station.view()});
  }

  private send(c: Client, m: ServerMsg, takeStrings?:Map<ServerMsg,Record<string,string>>) {
    if(!this.host.clockAvailable){c.ready=false;c.ws.close(1013,'world unavailable');return;}
    if (c.ws.readyState !== 1) return false;
    // slow clients lose messages while over 1 MB is queued, but never their own join set nor the first take after it
    if (c.ws.bufferedAmount > MAX_BUFFERED&&!c.joinSend&&!(m.t==='takes'&&c.awaitingTakes)){if(m.t==='me'||m.t==='welcome'&&m.privateMe){c.ready=false;c.ws.close(1013,'private view backpressure');}return false;}
    const current=this.privateMessage(c,m);if(!current)return false;
    // All existing public/private recipient projection runs before packing.
    let s:string,nextTable:number|null|undefined,nextTake:number|null|undefined;
    try{
      const mode=current.t==='takes'&&c.takeTransport?'wire':'raw';
      // take-chunk-ref/1 first leaves out what repeats the peer's last take; the other transports then pack what is left
      const chunks=current.t==='takes'&&c.takeChunks?this.takeChunks.encode(current,c.takeChunks.last):null;
      const stream=(chunks?chunks.stream:current) as ServerMsg;
      const entities=stream.t==='takes'&&c.takeEntities?this.takeEntities.encode(stream,c.takeEntities.last):null;
      const key=(entities?`${mode}|${c.takeEntities!.last}`:mode)+(chunks?`|c${c.takeChunks!.last}`:''),cached=takeStrings?.get(current)??{};
      const inner=(v:unknown)=>mode==='wire'?stringifyTakeBoundaryWireV1(v):JSON.stringify(v);
      s=cached[key]??(()=>{
        const packed=entities?JSON.stringify({t:'take-entities',contract:TAKE_ENTITIES_WIRE_V1,ids:entities.envelope.ids}).slice(0,-1)+',"payload":'+inner(entities.envelope.payload)+'}':inner(stream);
        return chunks?JSON.stringify({t:'take-chunks',contract:TAKE_CHUNKS_WIRE_V1,ids:chunks.ids,same:chunks.same}).slice(0,-1)+',"payload":'+packed+'}':packed;
      })();
      if(takeStrings){cached[key]=s;takeStrings.set(current,cached);}
      if(entities)nextTable=entities.last;
      if(chunks)nextTake=chunks.last;
    }catch{
      // A broken fact must not become a different raw message or stop the host.
      c.ready=false;c.ws.send(JSON.stringify({t:'error',code:'takes.transport-invalid',message:'The take transport cannot be encoded exactly.'}));c.ws.close(1011,'invalid take transport');return false;
    }
    s=this.kernelWire(c,current,s);
    c.sent += s.length; c.ws.send(s);
    if(nextTable!==undefined&&c.takeEntities)c.takeEntities.last=nextTable;
    if(nextTake!==undefined&&c.takeChunks)c.takeChunks.last=nextTake;
    if(current.t==='takes'&&current.chunks.length)c.awaitingTakes=false;
    return true;
  }
  /** No new private lifecycle fields are added to WS. Me retains its existing
   * shape but only usable identities; canonical public bodies/takes stay intact. */
  private currentMe(userId:string):Me|null{
    const user=this.db.user(userId);if(!user)return null;
    const me=this.auth.me(user),souls=this.lifecycleSouls;if(!souls)return me;
    return {...me,souls:souls.invited(user)?souls.ownedRows(user.id).filter(row=>row.world_id===this.host.worldId&&souls.controlReady(row)).map(row=>row.id):[]};
  }
  private privateViewFailed(c:Client,error:unknown){
    // Preserve corrupt evidence for operator reconciliation. Neither an old Me
    // nor a normal arrival refusal may stand in for failed authority verification.
    c.me=null;c.ready=false;
    console.error('[hub] private view invariant failed',error);
    this.send(c,{t:'error',code:'private-view-unavailable',message:'Private view unavailable; reconnect after operator repair.'});
    c.ws.close(1011,'private view unavailable');
  }
  private refreshAuthority(c:Client,publish=true):boolean{
    if(c.ready&&c.meScope&&(c.meScope.worldId!==this.host.worldId||c.meScope.epoch!==this.epoch)){
      c.ready=false;c.me=null;c.authUserId=null;this.send(c,{t:'error',code:'private-scope-differs',message:'Reconnect for current world authority.'});c.ws.close(1012,'private scope changed');return false;
    }
    const subject=c.authUserId===undefined?c.me?.userId:c.authUserId;
    if(this.lifecycleSouls&&subject){
      try{c.me=this.currentMe(subject);
        if(publish&&c.ready&&c.meScope&&c.publishedMe!==JSON.stringify(c.me)){
          const view=meLiveViewV1Schema.parse({...c.meScope,worldId:this.host.worldId,epoch:this.epoch,revision:c.meScope.revision+1,me:c.me});
          if(!this.send(c,{t:'me',view}))return false;c.meScope.revision=view.revision;c.publishedMe=JSON.stringify(c.me);
        }
        // A deleted identity may keep watching public motion. Its old accepted
        // subject must not silently revive if a row reappears; fresh hello only.
        if(c.ready&&c.me===null)c.authUserId=null;
      }
      catch(error){this.privateViewFailed(c,error);return false;}
    }
    return true;
  }
  private privateMessage(c:Client,m:ServerMsg):ServerMsg|null{
    if(m.t==='me'){
      const s=c.meScope,v=m.view;if(!this.lifecycleSouls||!c.ready||!s||s.worldId!==this.host.worldId||s.epoch!==this.epoch||c.authUserId!==s.userId||v.worldId!==s.worldId||v.epoch!==s.epoch||v.connectionId!==s.connectionId||v.userId!==s.userId||v.revision!==s.revision+1)return null;
      c.me=s.userId?this.currentMe(s.userId):null;return {t:'me',view:meLiveViewV1Schema.parse({...v,me:c.me})};
    }
    if(!this.lifecycleSouls)return m;
    if(m.t==='welcome'){if(!this.refreshAuthority(c,false))return null;return {...m,you:c.me};}
    if(m.t==='stats'){if(!this.refreshAuthority(c))return null;return c.me?.role==='admin'?m:{...m,stats:publicStats(m.stats)};}
    if(m.t==='brain'){
      if(!this.refreshAuthority(c)||!c.me)return null;
      const calls=m.calls.filter(call=>c.me!.role==='admin'||(!!call.soulId&&c.me!.souls.includes(call.soulId)));
      return calls.length?{t:'brain',calls}:null;
    }
    return m;
  }
  /** Standing public state a viewer needs on join (e.g. the edge fade roster); public messages only. */
  readonly joinMessages: (() => unknown[])[] = [];
  broadcast(m: ServerMsg, filter?: (c: Client) => boolean) {
    if(m.t==='me')throw new Error('Private Me must be published directly to its bound connection');
    if(m.t==='takes'){
      // Cache only serialized strings for this broadcast, after each recipient's
      // public/private projection. No mutable fact survives across messages.
      const strings=new Map<ServerMsg,Record<string,string>>();
      for(const c of this.clients){if(!c.ready||c.ws.readyState!==1||filter&&!filter(c))continue;this.send(c,m,strings);}
      return;
    }
    if(this.lifecycleSouls&&(m.t==='brain'||m.t==='stats')){
      for(const c of this.clients){
        if(!c.ready||c.ws.readyState!==1)continue;
        if(!this.refreshAuthority(c)||filter&&!filter(c))continue;this.send(c,m);
      }
      return;
    }
    const s = JSON.stringify(m),rest=m.t==='kernel'?kernelRestV1(m.view):undefined;
    for (const c of this.clients) { if (!c.ready || c.ws.readyState !== 1 || (filter && !filter(c))) continue; if (c.ws.bufferedAmount > MAX_BUFFERED) continue;
      const out=this.kernelWire(c,m,s,rest);c.sent += out.length; c.ws.send(out); }
  }
  /** take-chunk-ref/1 peers: a kernel view that differs from the last one this socket was sent only in its tick (the hub
   *  re-broadcasts it every 200 ticks: old Eden ~208 KB each) travels as {t:'kernel-tick',tick}. Call only right before
   *  ws.send(result): it records what the peer now has. */
  private kernelWire(c:Client,m:ServerMsg,s:string,rest?:string|null):string{
    if(m.t!=='kernel'||!c.takeChunks)return s;
    const r=rest===undefined?kernelRestV1(m.view):rest;
    if(r!==null&&r===c.takeChunks.kernel)return JSON.stringify({t:'kernel-tick',tick:m.view.tick});
    c.takeChunks.kernel=r??undefined;return s;
  }
  /** Model calls go to admins, and to the owner of the Soul a call is about. World-level calls (narrator, director) are admin only. */
  brainCall(call: BrainCall) { this.broadcast({ t: 'brain', calls: [call] }, (c) => !!c.me && (c.me.role === 'admin' || (!!call.soulId && c.me.souls.includes(call.soulId)))); }
  refreshMe(userId: string) { for (const c of this.clients) if ((c.authUserId===undefined?c.me?.userId:c.authUserId) === userId) { if(this.lifecycleSouls)this.refreshAuthority(c);else{const u = this.db.user(userId); if (u) c.me = this.auth.me(u);} } }

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
