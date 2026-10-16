// Eden 2026 capabilities timing (engine P4): a fresh Soul's first GET /v1/edge/capabilities used to block the server
// 79–85 s. Boots the world the way main.ts does for a launcher entity world (green-field engine, GodMode with the
// eden-2026 genesis, ground host + paged nav, entity bridge, world env, edge ledger), in memory, fake minds, no
// network; creates one Soul through the owner flow and times its capabilities calls, before and after it walks.
//   node apps/server/test/eden-capabilities-timing.ts [--json out.json] [--walk]
// Also exports `bootEden` for the regression test (eden-capabilities-budget.test.ts).
import { readFileSync, writeFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { fixture, invite, accept } from './native-owner-fixture.ts';
import { GodMode, type Genesis } from '../src/god/god.ts';
import { GroundHost, installGroundCapabilities, loadGroundRecipes } from '../src/god/ground-host.ts';
import { installEngineBridge } from '../src/god/engine-bridge.ts';
import { installWorldEnv } from '../src/god/world-env.ts';
import { EdgeLedger } from '../src/edge/ledger/ledger.ts';

const TEMPLATE = new URL('../../../worlds/templates/eden-2026.json', import.meta.url);

export async function bootEden(log: (m: string) => void = () => {}) {
  const t0 = performance.now();
  const f = fixture(':memory:');
  loadGroundRecipes(f.db, f.host.worldId);
  const edge = new EdgeLedger(f.host, f.db);
  const genesis = JSON.parse(readFileSync(TEMPLATE, 'utf8')) as Genesis;
  const god = new GodMode(f.db, { genesis, worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  log(`genesis: ${god.model.entities.size} entities in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  new GroundHost(f.db, f.host, god);
  installGroundCapabilities(edge as never, god, f.host);
  const bridge = installEngineBridge({ host: f.host, god, edge, log: () => {} });
  installWorldEnv(f.host, god, edge);
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  await settle(3);
  log(`world ready in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  await invite(f, 'ana');
  const row = await accept(f.host, f.souls.create('dev:ana', { name: 'Ana', description: 'curious' })) as { id: string; entity_id: string; name: string; owner: string };
  await settle(3);
  const soul = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  const close = () => { f.brain.quiesce(); f.host.stop(); f.db.close(); };
  return { ...f, god, edge, bridge, settle, soul, close };
}

/** Wall time of one synchronous capabilities call (it runs on the event loop, so this is how long the server blocks). */
export function timed<T>(fn: () => T): { ms: number; value: T } { const t = performance.now(); const value = fn(); return { ms: performance.now() - t, value }; }

/** Stable view of a capability list for before/after comparison (ids, availability, targets, reasons). */
export function capsDigest(caps: unknown[]): string { return JSON.stringify(caps); }

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
  const walk = process.argv.includes('--walk');
  const lag = monitorEventLoopDelay({ resolution: 20 }); lag.enable();
  const w = await bootEden((m) => console.log(m));
  const L = w.edge;
  const res: Record<string, unknown> = {};
  const c1 = timed(() => L.capabilities(w.soul)); console.log(`first capabilities: ${c1.ms.toFixed(0)} ms (${c1.value.length} capabilities)`);
  const c2 = timed(() => L.capabilities(w.soul)); console.log(`second capabilities: ${c2.ms.toFixed(0)} ms`);
  Object.assign(res, { firstMs: Math.round(c1.ms), secondMs: Math.round(c2.ms), count: c1.value.length, same: capsDigest(c1.value) === capsDigest(c2.value), caps: c1.value });
  if (walk) {
    const target = (c1.value as { verb: string; available?: boolean; id: string; target?: { kind?: string } }[]).find((c) => c.verb === 'walk' && c.available && c.target?.kind === 'place');
    if (target) {
      const a = await accept(w.host, Promise.resolve(L.act(w.soul, { capability: target.id }))) as { accepted?: boolean };
      console.log(`walk ${target.id}: accepted=${a?.accepted}`);
      await w.settle(200);
      const c3 = timed(() => L.capabilities(w.soul)); console.log(`after 200 ticks of walking: ${c3.ms.toFixed(0)} ms`);
      const c4 = timed(() => L.capabilities(w.soul)); console.log(`again: ${c4.ms.toFixed(0)} ms`);
      Object.assign(res, { walk: target.id, afterWalkMs: Math.round(c3.ms), afterWalkAgainMs: Math.round(c4.ms) });
    }
  }
  lag.disable();
  console.log(`event loop max delay over the run: ${(lag.max / 1e6).toFixed(0)} ms`);
  if (out) writeFileSync(out, JSON.stringify(res, null, 1));
  w.close();
  process.exit(0);
}
