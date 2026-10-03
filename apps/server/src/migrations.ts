// Numbered, forward-only migrations. Each runs once, in a transaction, and is
// recorded in schema_migrations. Never edit a shipped migration; add a new one.
import type { DatabaseSync } from 'node:sqlite';

const hasColumn = (db: DatabaseSync, table: string, col: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
const addColumn = (db: DatabaseSync, table: string, col: string, decl: string) => { if (!hasColumn(db, table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`); };

export const MIGRATIONS: { id: number; name: string; up(db: DatabaseSync): void }[] = [
  {
    id: 1, name: 'baseline',
    up(db) {
      db.exec(`
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
      CREATE TABLE IF NOT EXISTS narratives (id INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL, region TEXT NOT NULL, tick INTEGER NOT NULL, at INTEGER NOT NULL, body TEXT NOT NULL);`);
    },
  },
  {
    id: 2, name: 'soul_id columns, prompts, invites, agent token metadata',
    up(db) {
      // events.soul_id: a real indexed column instead of scanning JSON payloads
      addColumn(db, 'events', 'soul_id', 'TEXT');
      db.exec(`UPDATE events SET soul_id = json_extract(payload, '$.soulId') WHERE soul_id IS NULL AND json_extract(payload, '$.soulId') IS NOT NULL`);
      db.exec('CREATE INDEX IF NOT EXISTS events_soul ON events (world_id, soul_id, seq)');
      // brain_calls: who the call was about, and whether it hit a real model
      addColumn(db, 'brain_calls', 'soul_id', 'TEXT');
      addColumn(db, 'brain_calls', 'mode', "TEXT NOT NULL DEFAULT 'live'");
      db.exec(`UPDATE brain_calls SET mode = COALESCE(json_extract(body, '$.mode'), 'live')`);
      db.exec('CREATE INDEX IF NOT EXISTS brain_calls_soul ON brain_calls (soul_id, id)');
      db.exec('CREATE INDEX IF NOT EXISTS brain_calls_tier ON brain_calls (tier, id)');
      // long prompts stored once, referenced by hash
      db.exec('CREATE TABLE IF NOT EXISTS prompts (hash TEXT PRIMARY KEY, text TEXT NOT NULL, created_at INTEGER NOT NULL)');
      // invite gate
      db.exec('CREATE TABLE IF NOT EXISTS invites (code TEXT PRIMARY KEY, max_uses INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0, note TEXT, created_by TEXT, created_at INTEGER NOT NULL)');
      addColumn(db, 'users', 'invited_by', 'TEXT');
      // agent tokens: a label and last-use time so owners can see what is attached
      addColumn(db, 'souls', 'token_label', 'TEXT');
      addColumn(db, 'souls', 'token_last_used', 'INTEGER');
    },
  },
  {
    id: 3, name: 'talk: rendered words for speech acts',
    up(db) {
      db.exec('CREATE TABLE IF NOT EXISTS talks (id INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL, tick INTEGER NOT NULL, at INTEGER NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL, body TEXT NOT NULL)');
      db.exec('CREATE INDEX IF NOT EXISTS talks_pair ON talks (from_id, to_id, id)');
    },
  },
  {
    id: 4, name: 'durable model cost reservations',
    up(db) {
      db.exec('CREATE TABLE paid_costs (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, model TEXT NOT NULL, cost REAL NOT NULL, settled INTEGER NOT NULL DEFAULT 0)');
      db.exec('CREATE INDEX paid_costs_at ON paid_costs(at)');
      // Old hourly totals include pruned call rows. Date at hour end errs toward retaining spend.
      db.exec("INSERT INTO paid_costs(at, model, cost, settled) SELECT (hour + 1) * 3600000, model, SUM(cost_usd), 1 FROM spend_hourly GROUP BY hour, model");
    },
  },
  { id: 5, name: 'recorded rendering chunks', up(db) {
    db.exec('CREATE TABLE take_chunks (world_id TEXT NOT NULL, from_tick INTEGER NOT NULL, to_tick INTEGER NOT NULL, body BLOB NOT NULL, PRIMARY KEY(world_id, to_tick))');
    db.exec('CREATE INDEX take_chunks_from ON take_chunks(world_id, from_tick)');
  } },
];

export function migrate(db: DatabaseSync): number[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
  const done = new Set((db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]).map((r) => r.id));
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    db.exec('BEGIN');
    try { m.up(db); db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?,?,?)').run(m.id, m.name, Date.now()); db.exec('COMMIT'); applied.push(m.id); }
    catch (e) { db.exec('ROLLBACK'); throw new Error(`migration ${m.id} (${m.name}) failed: ${(e as Error).message}`); }
  }
  return applied;
}
