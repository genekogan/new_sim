// Test-only fixture for EVENTS-v1: the Comms fixture (real SQLite, fake ledger) plus the events, plans, schema and
// idempotency routes, and a fake actor whose receipts the test completes, fails or replaces. No world, no network.
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {getRequestListener} from '@hono/node-server';
import type {EdgeReceipt, EdgeSoul} from '../contract.ts';
import {commsFixture} from '../comms/testing.ts';
import type {CommsOptions} from '../comms/index.ts';
import {registerEdgeEvents, type EventsOptions} from './index.ts';
import {mountIdempotency} from './idempotency.ts';
import {mountSchema} from './schema.ts';
import {registerEdgePlans} from '../plans/index.ts';
import type {Db} from '../../db.ts';
import type {Plans} from '../plans/plans.ts';

export type FakeAct = {soulId: string; input: Record<string, unknown>; receipt?: EdgeReceipt};

/** A fake Ledger act: accepts anything except what `refuse` says; durable clientRef dedupe like the real one. */
export class FakeActor {
  acts: FakeAct[] = [];
  receipts = new Map<string, EdgeReceipt & {clientRef?: string}>();
  refuse: (input: Record<string, unknown>) => {code: string; reason: string; did_you_mean?: unknown} | null = () => null;
  /** Throw this (e.g. an EdgeError 400 for intents the Ledger does not know yet) instead of answering. */
  throwFor: (input: Record<string, unknown>) => Error | null = () => null;
  private n = 0;
  /** Where receipt changes go (the fixture's ledger listeners; a test may re-point it after a simulated restart). */
  emit: (r: EdgeReceipt) => void;
  private db: Db | null;
  constructor(emit: (r: EdgeReceipt) => void, db?: Db) {
    this.emit = emit; this.db = db ?? null;
    // the Ledger's receipt table (client_ref is what tags plan-driven receipts in the stream)
    this.db?.db.exec('CREATE TABLE IF NOT EXISTS edge_receipts_v1 (world_id TEXT NOT NULL, receipt_id TEXT NOT NULL, soul_id TEXT NOT NULL, capability TEXT NOT NULL, phase TEXT NOT NULL, accepted_tick INTEGER NOT NULL, started_tick INTEGER, ended_tick INTEGER, code TEXT, reason TEXT, program_id TEXT, client_ref TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (world_id, receipt_id))');
  }
  async act(soul: EdgeSoul, input: Record<string, unknown>) {
    const err = this.throwFor(input);
    // The attempt log includes requests rejected by a thrown HTTP-style error,
    // so the plans tests can detect a retry or a plain-word fallback too.
    if (err) { this.acts.push({soulId: soul.soulId, input}); throw err; }
    const ref = typeof input.clientRef === 'string' ? input.clientRef : undefined;
    if (ref) { const old = [...this.receipts.values()].find(r => r.clientRef === ref && r.soulId === soul.soulId); if (old) return {accepted: true, receipt: {...old}}; }
    const no = this.refuse(input);
    if (no) { this.acts.push({soulId: soul.soulId, input}); return {accepted: false, capability: String(input.capability ?? ''), ...no}; }
    for (const r of this.receipts.values()) if (r.soulId === soul.soulId && (r.phase === 'started' || r.phase === 'waiting')) this.set(r.id, 'replaced');
    const id = `r_${++this.n}`, cap = String(input.capability ?? input.verb ?? 'act'), capability = cap.includes(':') ? cap : cap.replace(/\s+/g, '-') + ':here';
    const r: EdgeReceipt & {clientRef?: string} = {id, soulId: soul.soulId, capability, phase: 'started', acceptedTick: 1, startedTick: 1, endedTick: null, code: null, reason: null, programId: 'p_' + id, ...(ref ? {clientRef: ref} : {})};
    this.receipts.set(id, r); this.acts.push({soulId: soul.soulId, input, receipt: {...r}});
    this.db?.db.prepare('INSERT OR REPLACE INTO edge_receipts_v1 (world_id,receipt_id,soul_id,capability,phase,accepted_tick,client_ref,created_at) VALUES (?,?,?,?,?,?,?,?)').run('edge-comms-test', id, soul.soulId, capability, 'started', 1, ref ?? null, 0);
    this.emit({...r});
    return {accepted: true, receipt: {...r}, ...(cap !== capability ? {resolved: {from: cap, to: capability, note: 'fake'}} : {})};
  }
  receipt(soulId: string, id: string) { const r = this.receipts.get(id); return r && r.soulId === soulId ? {...r} : null; }
  set(id: string, phase: EdgeReceipt['phase'], code: string | null = null, reason: string | null = null) {
    const r = this.receipts.get(id); if (!r) return;
    r.phase = phase; r.code = code; r.reason = reason; if (phase !== 'started' && phase !== 'waiting') r.endedTick = 2;
    this.emit({...r});
  }
  last(soulId?: string) { return [...this.acts].reverse().find(a => !soulId || a.soulId === soulId); }
}

export function eventsFixture(names: string[], options: {comms?: CommsOptions; events?: EventsOptions; existing?: {dir: string; db: Db; clock: {now: number}}; actor?: FakeActor} = {}) {
  const f = commsFixture(names, {fading: true, beam: true, ...(options.comms ?? {})}, options.existing, (app, deps, clock) => mountIdempotency(app, deps, () => clock.now));
  (f.host as unknown as {minds: Map<string, unknown>}).minds = new Map(names.map(n => [f.id(n), {soulId: f.id(n), entityId: `h_${f.id(n)}`, name: n, owner: `dev:${n}`}]));
  const actor = options.actor ?? new FakeActor(r => { for (const l of f.ledger.receiptListeners) l(r); }, f.db);
  let plans: Plans | null = null;
  const events = registerEdgeEvents(f.app, f.deps, f.runtime, {heartbeatMs: 150, planSummary: id => plans?.summary(id) ?? null, ...(options.events ?? {})});
  plans = registerEdgePlans(f.app, f.deps, f.runtime, events, actor, {tickMs: 0});
  mountSchema(f.app);
  let server: Server | null = null;
  const listen = async () => {
    server = createServer(getRequestListener(f.app.fetch));
    server.on('upgrade', (req, socket, head) => { if (!events.upgrade(req, socket, head)) socket.destroy(); });
    await new Promise<void>(r => server!.listen(0, '127.0.0.1', () => r()));
    return `127.0.0.1:${(server.address() as AddressInfo).port}`;
  };
  const destroy = () => { plans?.close(); events.close(); server?.close(); f.destroy(); };
  const close = () => { plans?.close(); events.close(); server?.close(); f.close(); };
  return {...f, actor, events, plans: plans!, listen, destroy, close,
    /** Envelopes retained in a Soul's stream (non-blocking). */
    envelopes: async (name: string) => (await f.drain(name)).events.map((e: any) => events.envelope(f.id(name), e)),
    patch: (name: string, path: string, body: unknown) => f.req(name, 'PATCH', path, body),
    del: (name: string, path: string) => f.req(name, 'DELETE', path)};
}

/** Parse an SSE byte stream into {event, id, data} records until `until` returns true or the timeout passes. */
export async function readSSE(res: Response, until: (msgs: {event: string; id?: string; data: any}[]) => boolean, timeoutMs = 4000) {
  const reader = res.body!.getReader(), dec = new TextDecoder(), msgs: {event: string; id?: string; data: any}[] = [];
  let buf = '';
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline && !until(msgs)) {
      const left = deadline - Date.now();
      const chunk = await Promise.race([reader.read(), new Promise<{done: true; value: undefined}>(r => setTimeout(() => r({done: true, value: undefined}), left))]);
      if (chunk.done) break;
      buf += dec.decode(chunk.value, {stream: true});
      let k;
      while ((k = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, k); buf = buf.slice(k + 2);
        const lines = block.split('\n').filter(l => !l.startsWith(':'));
        if (!lines.length) { msgs.push({event: 'comment', data: null}); continue; }
        const get = (f: string) => lines.filter(l => l.startsWith(f + ':')).map(l => l.slice(f.length + 1).replace(/^ /, ''));
        const data = get('data').join('\n');
        msgs.push({event: get('event')[0] ?? 'message', id: get('id')[0], data: data ? JSON.parse(data) : null});
      }
    }
  } finally { await reader.cancel().catch(() => {}); }
  return msgs;
}
