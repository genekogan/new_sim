// SQLite via node:sqlite (built in, no native build). One file, WAL.
import { DatabaseSync, backup } from 'node:sqlite';
import { statSync } from 'node:fs';
import type { BrainCall, LogEvent, NarrativeView } from '@sim/protocol';

export type UserRow = { id: string; email: string | null; wallet: string | null; role: 'user' | 'admin'; created_at: number; last_seen: number };
export type SoulRow = { id: string; world_id: string; owner: string; entity_id: string; name: string; description: string; created_at: number; retired_at: number | null; token_hash: string | null; token_created_at: number | null; native: number };

export class Db {
  db: DatabaseSync;
  path: string;
  constructor(path: string) {
    this.path = path;
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS worlds (id TEXT PRIMARY KEY, schema TEXT NOT NULL, rules_version TEXT NOT NULL, dt REAL NOT NULL, seed TEXT NOT NULL, clock_rate REAL NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events (world_id TEXT NOT NULL, seq INTEGER NOT NULL, tick INTEGER NOT NULL, kind TEXT NOT NULL, author TEXT NOT NULL, payload TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (world_id, seq));
      CREATE INDEX IF NOT EXISTS events_tick ON events (world_id, tick);
      CREATE TABLE IF NOT EXISTS snapshots (world_id TEXT NOT NULL, tick INTEGER NOT NULL, seq INTEGER NOT NULL, state_hash TEXT NOT NULL, physical_hash TEXT NOT NULL, rules_version TEXT NOT NULL, snapshot TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (world_id, tick));
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, wallet TEXT, role TEXT NOT NULL DEFAULT 'user', created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS souls (id TEXT PRIMARY KEY, world_id TEXT NOT NULL, owner TEXT NOT NULL, entity_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, created_at INTEGER NOT NULL, retired_at INTEGER, token_hash TEXT, token_created_at INTEGER, native INTEGER NOT NULL DEFAULT 0);
      CREATE UNIQUE INDEX IF NOT EXISTS souls_name ON souls (world_id, name COLLATE NOCASE) WHERE retired_at IS NULL;
      CREATE TABLE IF NOT EXISTS brain_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL, tick INTEGER NOT NULL, at INTEGER NOT NULL, tier TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, cost_usd REAL NOT NULL, ms REAL NOT NULL);
      CREATE INDEX IF NOT EXISTS brain_calls_at ON brain_calls (at);
      CREATE TABLE IF NOT EXISTS spend_hourly (hour INTEGER NOT NULL, tier TEXT NOT NULL, model TEXT NOT NULL, calls INTEGER NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cached_tokens INTEGER NOT NULL, cost_usd REAL NOT NULL, PRIMARY KEY (hour, tier, model));
      CREATE TABLE IF NOT EXISTS narratives (id INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL, region TEXT NOT NULL, tick INTEGER NOT NULL, at INTEGER NOT NULL, body TEXT NOT NULL);
    `);
  }

  // worlds
  world(id: string) { return this.db.prepare('SELECT * FROM worlds WHERE id = ?').get(id) as { id: string; schema: string; rules_version: string; dt: number; seed: string; clock_rate: number } | undefined; }
  createWorld(w: { id: string; schema: string; rules_version: string; dt: number; seed: string }) { this.db.prepare('INSERT INTO worlds (id, schema, rules_version, dt, seed, created_at) VALUES (?,?,?,?,?,?)').run(w.id, w.schema, w.rules_version, w.dt, w.seed, Date.now()); }
  setClockRate(id: string, rate: number) { this.db.prepare('UPDATE worlds SET clock_rate = ? WHERE id = ?').run(rate, id); }

  // events
  appendEvent(worldId: string, e: LogEvent) { this.db.prepare('INSERT INTO events (world_id, seq, tick, kind, author, payload, at) VALUES (?,?,?,?,?,?,?)').run(worldId, e.seq, e.tick, e.kind, e.author, JSON.stringify(e.payload), e.at); }
  events(worldId: string, afterSeq = 0, limit = 1_000_000): LogEvent[] {
    return (this.db.prepare('SELECT seq, tick, kind, author, payload, at FROM events WHERE world_id = ? AND seq > ? ORDER BY seq LIMIT ?').all(worldId, afterSeq, limit) as any[]).map(rowToEvent);
  }
  tailEvents(worldId: string, n: number): LogEvent[] {
    return (this.db.prepare('SELECT seq, tick, kind, author, payload, at FROM events WHERE world_id = ? ORDER BY seq DESC LIMIT ?').all(worldId, n) as any[]).map(rowToEvent).reverse();
  }
  lastSeq(worldId: string): number { return ((this.db.prepare('SELECT MAX(seq) AS s FROM events WHERE world_id = ?').get(worldId) as any)?.s as number) ?? 0; }
  countEvents(worldId: string): number { return (this.db.prepare('SELECT COUNT(*) AS c FROM events WHERE world_id = ?').get(worldId) as any).c; }

  // snapshots
  saveSnapshot(worldId: string, s: { tick: number; seq: number; stateHash: string; physicalHash: string; rulesVersion: string; body: unknown }) {
    this.db.prepare('INSERT OR REPLACE INTO snapshots (world_id, tick, seq, state_hash, physical_hash, rules_version, snapshot, at) VALUES (?,?,?,?,?,?,?,?)').run(worldId, s.tick, s.seq, s.stateHash, s.physicalHash, s.rulesVersion, JSON.stringify(s.body), Date.now());
    // keep the genesis-adjacent first snapshot and the latest 20
    this.db.prepare('DELETE FROM snapshots WHERE world_id = ? AND tick NOT IN (SELECT tick FROM snapshots WHERE world_id = ? ORDER BY tick DESC LIMIT 20)').run(worldId, worldId);
  }
  latestSnapshot(worldId: string) {
    const r = this.db.prepare('SELECT tick, seq, state_hash, rules_version, snapshot FROM snapshots WHERE world_id = ? ORDER BY tick DESC LIMIT 1').get(worldId) as any;
    return r ? { tick: r.tick as number, seq: r.seq as number, stateHash: r.state_hash as string, rulesVersion: r.rules_version as string, body: JSON.parse(r.snapshot) } : null;
  }

  // users
  user(id: string) { return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined; }
  upsertUser(u: { id: string; email: string | null; wallet: string | null; role: 'user' | 'admin' }) {
    const now = Date.now();
    this.db.prepare('INSERT INTO users (id, email, wallet, role, created_at, last_seen) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email = excluded.email, wallet = excluded.wallet, role = excluded.role, last_seen = excluded.last_seen').run(u.id, u.email, u.wallet, u.role, now, now);
  }
  touchUser(id: string) { this.db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), id); }
  countUsers(): number { return (this.db.prepare('SELECT COUNT(*) AS c FROM users').get() as any).c; }

  // souls
  soul(id: string) { return this.db.prepare('SELECT * FROM souls WHERE id = ?').get(id) as SoulRow | undefined; }
  soulsOf(owner: string) { return this.db.prepare('SELECT * FROM souls WHERE owner = ? AND retired_at IS NULL ORDER BY created_at').all(owner) as SoulRow[]; }
  liveSouls(worldId: string) { return this.db.prepare('SELECT * FROM souls WHERE world_id = ? AND retired_at IS NULL ORDER BY created_at').all(worldId) as SoulRow[]; }
  soulByName(worldId: string, name: string) { return this.db.prepare('SELECT * FROM souls WHERE world_id = ? AND name = ? COLLATE NOCASE AND retired_at IS NULL').get(worldId, name) as SoulRow | undefined; }
  soulByTokenHash(hash: string) { return this.db.prepare('SELECT * FROM souls WHERE token_hash = ? AND retired_at IS NULL').get(hash) as SoulRow | undefined; }
  createSoul(s: { id: string; worldId: string; owner: string; entityId: string; name: string; description: string; native: boolean }) {
    this.db.prepare('INSERT INTO souls (id, world_id, owner, entity_id, name, description, created_at, native) VALUES (?,?,?,?,?,?,?,?)').run(s.id, s.worldId, s.owner, s.entityId, s.name, s.description, Date.now(), s.native ? 1 : 0);
  }
  retireSoul(id: string) { this.db.prepare('UPDATE souls SET retired_at = ?, token_hash = NULL WHERE id = ?').run(Date.now(), id); }
  setSoulToken(id: string, hash: string | null) { this.db.prepare('UPDATE souls SET token_hash = ?, token_created_at = ? WHERE id = ?').run(hash, hash ? Date.now() : null, id); }

  // brain calls
  saveBrainCall(worldId: string, c: Omit<BrainCall, 'id'>): number {
    const r = this.db.prepare('INSERT INTO brain_calls (world_id, tick, at, tier, subject, body, cost_usd, ms) VALUES (?,?,?,?,?,?,?,?)').run(worldId, c.tick, c.at, c.tier, c.subject, JSON.stringify(c), c.costUsd, c.ms);
    // hourly rollup: survives pruning of brain_calls, so all-time spend stays exact
    if (c.mode === 'live') this.db.prepare(`INSERT INTO spend_hourly (hour, tier, model, calls, input_tokens, output_tokens, cached_tokens, cost_usd) VALUES (?,?,?,1,?,?,?,?)
      ON CONFLICT(hour, tier, model) DO UPDATE SET calls = calls + 1, input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens, cached_tokens = cached_tokens + excluded.cached_tokens, cost_usd = cost_usd + excluded.cost_usd`)
      .run(Math.floor(c.at / 3600_000), c.tier, c.model, c.inputTokens, c.outputTokens, c.cachedTokens, c.costUsd);
    return Number(r.lastInsertRowid);
  }
  brainCalls(limit: number, tier?: string): BrainCall[] {
    const rows = (tier
      ? this.db.prepare('SELECT id, body FROM brain_calls WHERE tier = ? ORDER BY id DESC LIMIT ?').all(tier, limit)
      : this.db.prepare('SELECT id, body FROM brain_calls ORDER BY id DESC LIMIT ?').all(limit)) as any[];
    return rows.map((r) => ({ ...JSON.parse(r.body), id: r.id })).reverse();
  }
  brainToday(sinceMs = 0): { calls: number; cost: number; jevMs: number } {
    const since = Math.max(sinceMs, Date.now() - 24 * 3600 * 1000);
    const a = this.db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(cost_usd),0) AS s FROM brain_calls WHERE at > ?').get(since) as any;
    const b = this.db.prepare("SELECT COALESCE(AVG(ms),0) AS m FROM (SELECT ms FROM brain_calls WHERE tier = 'mid' AND ms > 2 ORDER BY id DESC LIMIT 100)").get() as any;
    return { calls: a.c, cost: a.s, jevMs: b.m };
  }
  /** Spend since a time, by tier (live calls only). */
  spendSince(sinceMs: number): { tier: string; calls: number; cost: number; tokens: number }[] {
    return (this.db.prepare('SELECT tier, SUM(calls) AS calls, SUM(cost_usd) AS cost, SUM(input_tokens + output_tokens) AS tokens FROM spend_hourly WHERE hour >= ? GROUP BY tier').all(Math.floor(sinceMs / 3600_000)) as any[]);
  }
  /** Exact spend over the last N minutes from the raw call table (for the short window). */
  spendRecent(sinceMs: number): { tier: string; calls: number; cost: number }[] {
    return this.db.prepare("SELECT tier, COUNT(*) AS calls, SUM(cost_usd) AS cost FROM brain_calls WHERE at >= ? AND body LIKE '%\"mode\":\"live\"%' GROUP BY tier").all(sinceMs) as any[];
  }
  spendHourly(hours: number): { hour: number; tier: string; cost: number; calls: number }[] {
    return this.db.prepare('SELECT hour, tier, SUM(cost_usd) AS cost, SUM(calls) AS calls FROM spend_hourly WHERE hour >= ? GROUP BY hour, tier ORDER BY hour').all(Math.floor(Date.now() / 3600_000) - hours + 1) as any[];
  }
  spendByModel(): { model: string; calls: number; cost: number; input: number; output: number; cached: number }[] {
    return this.db.prepare('SELECT model, SUM(calls) AS calls, SUM(cost_usd) AS cost, SUM(input_tokens) AS input, SUM(output_tokens) AS output, SUM(cached_tokens) AS cached FROM spend_hourly GROUP BY model').all() as any[];
  }
  spendFirstHour(): number | null { return ((this.db.prepare('SELECT MIN(hour) AS h FROM spend_hourly').get() as any)?.h as number) ?? null; }
  /** Backfill the rollup from calls recorded before it existed (idempotent: only when the rollup is empty). */
  backfillSpend() {
    if ((this.db.prepare('SELECT COUNT(*) AS c FROM spend_hourly').get() as any).c > 0) return;
    for (const r of this.db.prepare('SELECT body FROM brain_calls ORDER BY id').all() as any[]) {
      const c = JSON.parse(r.body); if (c.mode !== 'live') continue;
      this.db.prepare(`INSERT INTO spend_hourly (hour, tier, model, calls, input_tokens, output_tokens, cached_tokens, cost_usd) VALUES (?,?,?,1,?,?,?,?)
        ON CONFLICT(hour, tier, model) DO UPDATE SET calls = calls + 1, input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens, cached_tokens = cached_tokens + excluded.cached_tokens, cost_usd = cost_usd + excluded.cost_usd`)
        .run(Math.floor(c.at / 3600_000), c.tier, c.model, c.inputTokens ?? 0, c.outputTokens ?? 0, c.cachedTokens ?? 0, c.costUsd ?? 0);
    }
  }
  pruneBrainCalls(keep = 20000) { this.db.prepare('DELETE FROM brain_calls WHERE id <= (SELECT MAX(id) FROM brain_calls) - ?').run(keep); }

  // narratives
  saveNarrative(worldId: string, region: string, tick: number, body: Omit<NarrativeView, 'id'>): number {
    return Number(this.db.prepare('INSERT INTO narratives (world_id, region, tick, at, body) VALUES (?,?,?,?,?)').run(worldId, region, tick, Date.now(), JSON.stringify(body)).lastInsertRowid);
  }
  updateNarrative(id: number, body: NarrativeView) { this.db.prepare('UPDATE narratives SET body = ? WHERE id = ?').run(JSON.stringify(body), id); }

  bytes(): number { try { return statSync(this.path).size; } catch { return 0; } }
  async backupTo(dest: string) { await backup(this.db, dest); }
  close() { this.db.close(); }
}
const rowToEvent = (r: any): LogEvent => ({ seq: r.seq, tick: r.tick, kind: r.kind, author: r.author, payload: JSON.parse(r.payload), at: r.at });
