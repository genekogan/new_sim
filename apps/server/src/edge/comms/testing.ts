// Test-only fixture for Core-Comms: a real SQLite Db, a fake ledger whose bodies,
// places and enclosures the test controls, and a fresh Hono app with only the Comms
// routes. Fake minds, no network, no model keys.
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Hono} from 'hono';
import {Db} from '../../db.ts';
import type {WorldHost} from '../../world.ts';
import type {Souls} from '../../souls.ts';
import {EdgeError, type EdgeCapability, type EdgeDeps, type EdgeLedgerHooks, type EdgeReceipt, type EdgeSoul, type NearbyBody, type PlaceRef} from '../contract.ts';
import {registerEdgeComms, type CommsOptions, type CommsRuntime} from './index.ts';

export type FakeBody = {x: number; z: number; path: PlaceRef[]; enclosure: string | null};
export const place = (id: string, kind = 'outdoor'): PlaceRef => ({id, name: id, kind});
export const COMMONS = place('eden-commons');

export class FakeLedger implements EdgeLedgerHooks {
  bodies = new Map<string, FakeBody>();
  receiptListeners: ((r: EdgeReceipt) => void)[] = [];
  placeListeners: ((e: {soulId: string; from: string | null; to: string | null; tick: number}) => void)[] = [];
  providers: ((soul: EdgeSoul) => EdgeCapability[])[] = [];
  placePathOf(soulId: string) { return this.bodies.get(soulId)?.path ?? []; }
  enclosureOf(soulId: string) { return this.bodies.get(soulId)?.enclosure ?? null; }
  perceivedBodies(soulId: string, radius: number): NearbyBody[] {
    const me = this.bodies.get(soulId);
    if (!me) return [];
    const out: NearbyBody[] = [];
    for (const [id, b] of this.bodies) {
      if (id === soulId || b.enclosure !== me.enclosure) continue;
      const distance = Math.hypot(b.x - me.x, b.z - me.z);
      if (distance <= radius) out.push({soulId: id, entityId: `h_${id}`, name: id, distance, placeId: b.path[0]?.id ?? '', state: 'standing', activity: 'stand'});
    }
    return out;
  }
  onReceipt(l: (r: EdgeReceipt) => void) { this.receiptListeners.push(l); }
  onPlaceChange(l: (e: {soulId: string; from: string | null; to: string | null; tick: number}) => void) { this.placeListeners.push(l); }
  addCapabilityProvider(p: (soul: EdgeSoul) => EdgeCapability[]) { this.providers.push(p); }
  capabilities(soul: EdgeSoul) { return this.providers.flatMap(p => p(soul)); }
  /** Move a body and fire the place-change hook like the Ledger would. */
  move(soulId: string, body: FakeBody, tick = 0) {
    const from = this.bodies.get(soulId)?.path[0]?.id ?? null;
    this.bodies.set(soulId, body);
    const to = body.path[0]?.id ?? null;
    if (from !== to) for (const l of this.placeListeners) l({soulId, from, to, tick});
  }
  receipt(r: Partial<EdgeReceipt> & {id: string; soulId: string; phase: EdgeReceipt['phase']}) {
    const full: EdgeReceipt = {capability: 'walk:x', acceptedTick: 1, startedTick: null, endedTick: null, code: null, reason: null, programId: null, ...r};
    for (const l of this.receiptListeners) l(full);
  }
}

export type CommsFixture = ReturnType<typeof commsFixture>;

export function commsFixture(names: string[], options: CommsOptions = {}, existing?: {dir: string; db: Db; clock: {now: number}}) {
  const dir = existing?.dir ?? mkdtempSync(join(tmpdir(), 'edge-comms-'));
  const db = existing?.db ?? new Db(join(dir, 'world.db'));
  const worldId = 'edge-comms-test';
  const clock = existing?.clock ?? {now: 1_800_000_000_000};
  const host = {worldId, engine: {world: {tick: 100}}} as unknown as WorldHost;
  const ledger = new FakeLedger();
  const souls = new Map<string, EdgeSoul>();
  names.forEach((name, i) => {
    const soulId = `s_${name.toLowerCase()}`;
    if (!db.soul(soulId)) db.db.prepare('INSERT INTO souls (id, world_id, owner, entity_id, name, description, created_at) VALUES (?,?,?,?,?,?,?)').run(soulId, worldId, `dev:${name}`, `h_${soulId}`, name, '', i);
    souls.set(soulId, {soulId, entityId: `h_${soulId}`, name, owner: `dev:${name}`});
    ledger.bodies.set(soulId, {x: i * 100, z: 0, path: [COMMONS], enclosure: null});
  });
  const deps: EdgeDeps = {host, db, souls: {} as Souls, ledger, soul(c) {
    const token = c.req.header('authorization')?.replace(/^Bearer /, '') ?? '';
    const s = souls.get(token);
    if (!s) throw new EdgeError(401, 'unauthorized', 'unknown soul token');
    return s;
  }};
  const app = new Hono();
  const runtime: CommsRuntime = registerEdgeComms(app, deps, {now: () => clock.now, sweepMs: 0, fetch: null, ...options});
  const id = (name: string) => `s_${name.toLowerCase()}`;
  const req = async (name: string, method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {method, headers: {authorization: `Bearer ${id(name)}`, ...(body === undefined ? {} : {'content-type': 'application/json'})}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    return {status: res.status, body: await res.json() as any};
  };
  const at = (name: string, x: number, z: number, path: PlaceRef[] = [COMMONS], enclosure: string | null = null) => ledger.move(id(name), {x, z, path, enclosure}, (host as any).engine.world.tick);
  const close = () => { runtime.close(); };
  const destroy = () => { runtime.close(); db.db.close(); rmSync(dir, {recursive: true, force: true}); };
  return {dir, db, host, ledger, app, runtime, clock, deps, id, req, at, close, destroy,
    get: (name: string, path: string) => req(name, 'GET', path),
    post: (name: string, path: string, body: unknown) => req(name, 'POST', path, body),
    /** Everything retained in a Soul's stream (non-blocking; `wait` shape without the HTTP hop). */
    drain: async (name: string) => runtime.streams.read(id(name), runtime.streams.read(id(name), 0).gap ? Number(runtime.streams.read(id(name), 0).cursor.slice(2)) : 0, 10_000) as {cursor: string; events: any[]; gap?: true}};
}
