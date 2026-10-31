// Lane L5 (server reliability, fast boot): how long a boot after SIGKILL replays, on Eden 2026 in memory.
// Boots the eden-2026 template the way main.ts does (bootEden), adds Souls that keep walking, snapshots, runs N live
// ticks (the replay debt a SIGKILL leaves), then cold-boots a second host on the same database and times restore and
// replay, and checks the replayed world equals the live one (engine, physical and kernel hashes at the same tick).
//   node apps/server/test/boot-replay-bench.ts [--souls 6] [--ticks 1200] [--json out.json] [--prof]
// INDICATIVE on the laptop; the numbers to quote come from the eden2 bench (L6).
import { writeFileSync } from 'node:fs';
import { kernelHash } from '@sim/kernel';
import { bootEden } from './eden-capabilities-timing.ts';
import { accept, invite, factory } from './native-owner-fixture.ts';
import { WorldHost } from '../src/world.ts';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const SOULS = Number(arg('--souls', '6')), TICKS = Number(arg('--ticks', '1200')), out = arg('--json', '');
const log = (m: string) => console.error(`[bench] ${m}`);

const w = await bootEden(log);
const souls = [w.soul];
for (let i = 1; i < SOULS; i++) {
  const owner = `dev:b${i}`; await invite(w, `b${i}`);
  const row = await accept(w.host, w.souls.create(owner, { name: `B${i}`, description: 'walker' })) as { id: string; entity_id: string; name: string; owner: string };
  souls.push({ soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner });
}
await w.settle(3);
type Cap = { verb: string; available?: boolean; id: string; target?: { kind?: string; id?: string } };
let k = 0;
const walkAll = async () => {
  for (const s of souls) {
    const caps = (w.edge.capabilities(s) as Cap[]).filter((c) => c.verb === 'walk' && c.available && c.target?.kind === 'place');
    if (!caps.length) continue;
    try { await accept(w.host, Promise.resolve(w.edge.act(s, { capability: caps[(k++ * 7) % caps.length].id }))); } catch { /* a refused walk is not the point */ }
  }
};
await walkAll(); await w.settle(5);
const snap = w.host.saveSnapshot(true);
log(`snapshot at tick ${snap.tick} (${SOULS} Souls), running ${TICKS} live ticks`);
const tickMs: number[] = [];
const t0 = performance.now();
for (let i = 0; i < TICKS; i++) {
  if (i % 400 === 0) await walkAll();
  const a = performance.now(); w.host.tickOnce(); tickMs.push(performance.now() - a);
  await new Promise((r) => setImmediate(r)); w.host.drainInputs();
}
// a last logged input at the head, so a boot without a durable clock frontier replays to it
await walkAll(); w.host.tickOnce(); w.host.drainInputs();
const liveMs = performance.now() - t0;
const live = { tick: w.host.engine.world.tick, engine: w.host.engine.stateHash(), physical: w.host.engine.physicalHash(), kernel: kernelHash(w.host.kernel) };
w.host.stop();

const b = new WorldHost(w.db, factory, (w.host as unknown as { seed: string }).seed, 1e9, w.host.worldId);
const bt = performance.now();
const booted = b.boot();
const bootMs = performance.now() - bt;
const replayedTo = b.engine.world.tick;
while (b.engine.world.tick < live.tick) b.tickOnce();
const got = { tick: b.engine.world.tick, engine: b.engine.stateHash(), physical: b.engine.physicalHash(), kernel: kernelHash(b.kernel) };
const same = JSON.stringify(got) === JSON.stringify(live);
const sorted = [...tickMs].sort((x, y) => x - y), avg = tickMs.reduce((s, x) => s + x, 0) / tickMs.length;
const result = { souls: SOULS, snapshotTick: snap.tick, liveTicks: TICKS, liveTickMsAvg: +avg.toFixed(2), liveTickMsP95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
  liveMs: Math.round(liveMs), boot: { ...booted, ms: Math.round(bootMs), replayedTo, replayTicks: replayedTo - snap.tick, phases: b.bootStats ?? null }, sameAsLive: same };
console.log(JSON.stringify(result));
if (out) writeFileSync(out, JSON.stringify(result, null, 1));
b.stop(); w.db.close();
if (!same) process.exitCode = 1;
