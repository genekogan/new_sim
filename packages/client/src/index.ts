// The client replica: a best-effort copy of the world built from a snapshot
// plus batches. Positions are computed locally from timed paths (the shared
// kinematics), so the server never streams per-tick poses. Each heartbeat
// carries the server's view hash; the replica recomputes its own at that tick
// and asks for a resync when they differ. Runs in browsers and in Node.
import type { Entity, Environment, PathCommit, PoseSample, Region } from '@sim/engine-contract';
import { samplePath, viewHashOf, viewRow, PROTO, type KernelView, type PlayView, type TalkLine, type Batch, type BrainCall, type CameraLine, type ClientMsg, type Heartbeat, type LogEvent, type Me, type NarrativeView, type PublicSoul, type ServerMsg, type ServerStats, type Snapshot, type TickerLine } from '@sim/protocol';

export class Replica {
  tick = 0;            // latest tick we have data through
  seq = -1;            // last batch seq applied
  entities: Record<string, Entity> = {};
  regions: Record<string, Region> = {};
  env: Environment | null = null;
  paths = new Map<string, PathCommit>();
  souls = new Map<string, PublicSoul>();
  ready = false;

  applySnapshot(s: Snapshot) {
    this.entities = s.entities; this.regions = s.regions; this.env = s.env; this.tick = s.tick; this.seq = s.seq;
    this.paths = new Map(s.paths.map((p) => [p.entity, p]));
    this.souls = new Map(s.souls.map((x) => [x.id, x]));
    this.ready = true;
  }

  /** Returns false if a batch was missed (gap in seq): the caller should resync. */
  applyBatch(b: Batch): boolean {
    if (!this.ready) return true;
    if (b.seq <= this.seq) return true;           // already have it (overlap after a snapshot)
    if (b.seq !== this.seq + 1) return false;      // gap
    for (const [tick, id, field, value] of b.changes) {
      if (id === '$env') { if (this.env && field === 'datetime') this.env = { ...this.env, datetime: value as string }; continue; }
      if (field === 'present') {
        if (value === null) { this.settle(id, tick); delete this.entities[id]; this.paths.delete(id); }
        else if (!this.entities[id]) this.entities[id] = structuredClone(value as Entity);
        continue;
      }
      const e = this.entities[id]; if (!e?.human) continue;
      if (field === 'activity') e.human.activity = value as string;
      else if (field === 'on') { if (value === null) delete e.human.on; else e.human.on = value as string; }
      else if (field === 'task') { if (value === null) delete e.human.task; else e.human.task = value as string; }
    }
    for (const p of b.paths) { this.settle(p.entity, p.startTick); this.paths.set(p.entity, p); }
    for (const s of b.souls) this.souls.set(s.id, s);
    for (const id of b.removedSouls) this.souls.delete(id);
    this.seq = b.seq; this.tick = b.toTick;
    return true;
  }

  /** Bake the position reached on the old path into the entity before replacing the path. */
  private settle(id: string, tick: number) {
    const p = this.paths.get(id), e = this.entities[id];
    if (p && e) { const s = samplePath(p.waypoints, tick); e.pose.p = [s[1] / 1000, 0, s[3] / 1000]; e.pose.yaw = s[4] / 1000; }
  }

  /** Where an entity is at a tick: on its path if it has one, else where it last stood. */
  poseAt(id: string, tick: number): PoseSample {
    const e = this.entities[id], p = this.paths.get(id);
    if (p && tick >= p.waypoints[0][0]) return samplePath(p.waypoints, tick);
    return [tick, Math.round(e.pose.p[0] * 1000), 0, Math.round(e.pose.p[2] * 1000), Math.round(e.pose.yaw * 1000)];
  }

  viewHash(tick: number): string {
    return viewHashOf(Object.keys(this.entities).filter((id) => this.entities[id].kind === 'human').map((id) => viewRow(this.entities[id], this.poseAt(id, tick))));
  }

  /** Check a heartbeat. 'ok', 'mismatch' (resync needed) or 'pending' (we have not received that tick yet). */
  check(h: Heartbeat): 'ok' | 'mismatch' | 'pending' {
    if (!this.ready || this.seq < h.seq) return 'pending';
    if (this.seq > h.seq) return 'ok'; // already moved on; the next heartbeat will check
    return this.viewHash(h.tick) === h.viewHash ? 'ok' : 'mismatch';
  }
}

export type ConnState = 'connecting' | 'open' | 'closed';
export type ConnStats = { state: ConnState; resyncs: number; reconnects: number; heartbeats: number; lastCheck: string; lastHash: string; myHash: string; bytesIn: number; msgsIn: number; rttMs: number; lastHeartbeatTick: number; snapshots: number };
export type Handlers = {
  onChange?(): void; onLog?(e: LogEvent[]): void; onBrain?(c: BrainCall[]): void; onCamera?(l: CameraLine): void; onTicker?(l: TickerLine[]): void;
  onNarrative?(v: NarrativeView): void; onStats?(s: ServerStats): void; onKernel?(v: KernelView): void; onPlays?(p: PlayView[]): void; onTalk?(l: TalkLine[]): void; onWelcome?(me: Me | null, w: Extract<ServerMsg, { t: 'welcome' }>): void;
};
type WSLike = { send(s: string): void; close(): void; readyState: number; onopen: any; onmessage: any; onclose: any; onerror: any };

/** Connection with automatic reconnect (resuming from the last batch seq) and heartbeat-driven resync. */
export class Connection {
  replica = new Replica();
  stats: ConnStats = { state: 'connecting', resyncs: 0, reconnects: 0, heartbeats: 0, lastCheck: '-', lastHash: '', myHash: '', bytesIn: 0, msgsIn: 0, rttMs: 0, lastHeartbeatTick: 0, snapshots: 0 };
  welcome: Extract<ServerMsg, { t: 'welcome' }> | null = null;
  heartbeat: Heartbeat | null = null;
  /** Wall-clock anchor for smooth local tick estimation between batches. */
  anchor = { tick: 0, at: 0 };
  private ws: WSLike | null = null;
  private closed = false;
  private retry = 0;
  private pendingHb: Heartbeat | null = null;
  private pingTimer: any = null;
  url: string; getToken: () => Promise<string | null>; handlers: Handlers; make: (url: string) => WSLike; now: () => number;

  constructor(url: string, getToken: () => Promise<string | null>, handlers: Handlers, make: (url: string) => WSLike, now: () => number = () => Date.now()) {
    this.url = url; this.getToken = getToken; this.handlers = handlers; this.make = make; this.now = now;
  }

  connect() {
    this.closed = false; this.stats.state = 'connecting'; this.handlers.onChange?.();
    const ws = (this.ws = this.make(this.url));
    ws.onopen = async () => {
      this.stats.state = 'open'; this.retry = 0;
      const token = await this.getToken().catch(() => null);
      const hello: ClientMsg = { t: 'hello', proto: PROTO, ...(token ? { token } : {}), ...(this.replica.ready ? { since: this.replica.seq } : {}) };
      ws.send(JSON.stringify(hello));
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping', n: this.now() })); }, 5000);
      this.handlers.onChange?.();
    };
    ws.onmessage = (ev: { data: unknown }) => { const s = String(ev.data); this.stats.bytesIn += s.length; this.stats.msgsIn++; this.onMessage(JSON.parse(s) as ServerMsg); };
    ws.onclose = () => {
      clearInterval(this.pingTimer); this.stats.state = 'closed'; this.handlers.onChange?.();
      if (this.closed) return;
      this.stats.reconnects++;
      // exponential backoff with jitter, so a restart does not bring every client back on the same millisecond
      setTimeout(() => this.connect(), Math.min(15_000, 500 * 2 ** this.retry++) * (0.5 + Math.random()));
    };
    ws.onerror = () => { try { ws.close(); } catch { /* already closed */ } };
  }
  close() { this.closed = true; clearInterval(this.pingTimer); this.ws?.close(); }
  /** Re-send hello (for example after signing in or out) on the same socket. */
  rehello() { this.ws?.close(); }
  resync(reason: string) { this.stats.resyncs++; this.ws?.send(JSON.stringify({ t: 'resync', reason } satisfies ClientMsg)); }
  /** Test hook: drop the socket without the caller asking, as a network failure would. */
  dropForTest() { this.ws?.close(); }

  private setAnchor(tick: number) { this.anchor = { tick, at: this.now() }; }
  /** Smooth estimate of the current world tick for display. */
  displayTick(): number {
    const w = this.welcome; if (!w) return this.replica.tick;
    const rate = (this.heartbeat?.paused ? 0 : (this.heartbeat?.clockRate ?? w.clockRate)) / (w.dt * 1000);
    return Math.min(this.replica.tick + 10, this.anchor.tick + (this.now() - this.anchor.at) * rate);
  }

  private onMessage(m: ServerMsg) {
    const r = this.replica, h = this.handlers;
    switch (m.t) {
      case 'welcome': this.welcome = m; h.onWelcome?.(m.you, m); break;
      case 'snapshot': r.applySnapshot(m); this.stats.snapshots++; this.setAnchor(m.tick); this.pendingHb = null; break;
      case 'batch': {
        if (!r.applyBatch(m)) { this.resync(`gap: have ${r.seq}, got ${m.seq}`); break; }
        this.setAnchor(m.toTick);
        if (m.log.length) h.onLog?.(m.log);
        if (this.pendingHb) this.verify(this.pendingHb);
        break;
      }
      case 'heartbeat': this.heartbeat = m; this.stats.heartbeats++; this.stats.lastHeartbeatTick = m.tick; this.verify(m); break;
      case 'log': h.onLog?.(m.events); break;
      case 'brain': h.onBrain?.(m.calls); break;
      case 'camera': h.onCamera?.(m.line); break;
      case 'ticker': h.onTicker?.(m.lines); break;
      case 'narrative': h.onNarrative?.(m.view); break;
      case 'stats': h.onStats?.(m.stats); break;
      case 'kernel': h.onKernel?.(m.view); break;
      case 'plays': h.onPlays?.(m.plays); break;
      case 'talk': h.onTalk?.(m.lines); break;
      case 'pong': this.stats.rttMs = this.now() - m.n; break;
      case 'error': console.warn('[sim] server error', m.code, m.message); break;
    }
    h.onChange?.();
  }

  private verify(hb: Heartbeat) {
    const res = this.replica.check(hb);
    this.stats.lastCheck = res; this.stats.lastHash = hb.viewHash;
    if (res === 'pending') { this.pendingHb = hb; return; }
    this.pendingHb = null;
    this.stats.myHash = this.replica.seq === hb.seq ? this.replica.viewHash(hb.tick) : '(moved on)';
    if (res === 'mismatch') this.resync(`view hash mismatch at tick ${hb.tick}`);
  }
}
