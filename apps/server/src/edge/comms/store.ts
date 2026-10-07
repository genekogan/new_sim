// Core-Comms persistence. Comms keeps its own world-scoped SQLite tables instead of
// appending to the world event log: the log's EventKind union is closed and folded by
// the engine, so new kinds there would change replay. These tables are created
// idempotently and never read by the world fold.
import type {DatabaseSync} from 'node:sqlite';

export type Sql = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS edge_comms_stream (world_id TEXT NOT NULL, soul_id TEXT NOT NULL, seq INTEGER NOT NULL, tick INTEGER NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (world_id, soul_id, seq)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS edge_comms_stream_at ON edge_comms_stream (world_id, soul_id, at);
CREATE TABLE IF NOT EXISTS edge_comms_heads (world_id TEXT NOT NULL, soul_id TEXT NOT NULL, head INTEGER NOT NULL, floor INTEGER NOT NULL, PRIMARY KEY (world_id, soul_id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS edge_comms_receipts_seen (world_id TEXT NOT NULL, receipt_id TEXT NOT NULL, phase TEXT NOT NULL, PRIMARY KEY (world_id, receipt_id, phase)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS edge_comms_speech (world_id TEXT NOT NULL, id TEXT NOT NULL, soul_id TEXT NOT NULL, tick INTEGER NOT NULL, at INTEGER NOT NULL, channel TEXT NOT NULL, text TEXT NOT NULL, heard_by TEXT NOT NULL, PRIMARY KEY (world_id, id)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS edge_comms_speech_at ON edge_comms_speech (world_id, at);
CREATE TABLE IF NOT EXISTS edge_comms_conversations (world_id TEXT NOT NULL, id TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (world_id, id)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS edge_comms_conversations_open ON edge_comms_conversations (world_id, state);
CREATE TABLE IF NOT EXISTS edge_comms_turns (world_id TEXT NOT NULL, conversation_id TEXT NOT NULL, seq INTEGER NOT NULL, soul_id TEXT NOT NULL, tick INTEGER NOT NULL, at INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY (world_id, conversation_id, seq)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS edge_comms_subscriptions (world_id TEXT NOT NULL, soul_id TEXT NOT NULL, url TEXT NOT NULL, secret TEXT NOT NULL, cursor INTEGER NOT NULL, created_at INTEGER NOT NULL, failures INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (world_id, soul_id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS edge_comms_objects (world_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (world_id, id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS edge_comms_object_log (world_id TEXT NOT NULL, object_id TEXT NOT NULL, version INTEGER NOT NULL, soul_id TEXT, action TEXT NOT NULL, params TEXT NOT NULL, tick INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (world_id, object_id, version)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS edge_comms_work (world_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL, dedupe TEXT, created_at INTEGER NOT NULL, claimed_at INTEGER, claimed_by TEXT, completed_at INTEGER, body TEXT NOT NULL, result TEXT, PRIMARY KEY (world_id, id)) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS edge_comms_work_dedupe ON edge_comms_work (world_id, dedupe) WHERE dedupe IS NOT NULL;
CREATE TABLE IF NOT EXISTS edge_comms_digests (world_id TEXT NOT NULL, written_at INTEGER NOT NULL, day INTEGER NOT NULL, phase TEXT NOT NULL, text TEXT NOT NULL, work_id TEXT, PRIMARY KEY (world_id, written_at)) WITHOUT ROWID;
`;

export function ensureCommsSchema(db: Sql): void { db.exec(SCHEMA); }

let savepoints = 0;
/** Atomic block that also nests safely inside a caller's transaction. */
export function tx<T>(db: Sql, fn: () => T): T {
  const name = `edge_comms_${++savepoints}`;
  db.exec(`SAVEPOINT ${name}`);
  try { const out = fn(); db.exec(`RELEASE ${name}`); return out; }
  catch (error) { db.exec(`ROLLBACK TO ${name}`); db.exec(`RELEASE ${name}`); throw error; }
}
