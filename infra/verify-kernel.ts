// Replay the kernel from the event log (no engine stepping, no models) and compare with the live server's kernel hash.
// Read-only. On the box, as the service user:
//   cd /srv/sim/current/apps/server && sudo -u sim node /srv/sim/current/infra/verify-kernel.ts /srv/sim-data/sim.db http://127.0.0.1:4500
// Locally: SIM_RELEASE=$PWD node infra/verify-kernel.ts <path to sim.db> http://127.0.0.1:<port>
// Exit code 0 on a match. (Toy-engine worlds; the kernel does not depend on the engine beyond its list of places.)
import { DatabaseSync } from 'node:sqlite';
const R = process.env.SIM_RELEASE ?? '/srv/sim/current';
const { toyFactory } = await import(`${R}/packages/engine-toy/src/index.ts`);
const { kernelHash } = await import(`${R}/packages/kernel/src/index.ts`);
const { initKernel, pinnedVocabulary, replayKernel } = await import(`${R}/apps/server/src/fold.ts`);
const [dbPath, base] = process.argv.slice(2);
const db = new DatabaseSync(dbPath, { readOnly: true });
const world = db.prepare('SELECT id, seed FROM worlds LIMIT 1').get() as { id: string; seed: string };
for (let attempt = 0; attempt < 4; attempt++) {
  const live = await (await fetch(`${base}/v1/kernel`)).json() as any;
  const rows = db.prepare('SELECT seq, tick, kind, author, payload, at FROM events WHERE world_id = ? AND tick <= ? ORDER BY seq').all(world.id, live.tick) as any[];
  const events = rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
  const t0 = performance.now();
  const k = replayKernel(initKernel(toyFactory.create(toyFactory.genesis(world.seed)), pinnedVocabulary(events)), events); k.tick = live.tick;
  for(const thing of Object.values(k.things))delete thing.states.privateMandate;
  const h = kernelHash(k).slice(0, 16);
  const kinds: Record<string, number> = {}; for (const e of events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  console.log(`tick ${live.tick}: ${events.length} events ${JSON.stringify(kinds)} replayed in ${(performance.now() - t0).toFixed(0)} ms; live ${live.hash} replay ${h} → ${h === live.hash ? 'MATCH' : 'differ'}`);
  if (h === live.hash) process.exit(0);
  // say where they differ
  const diff: string[] = [];
  for (const id of new Set([...Object.keys(k.things), ...Object.keys(live.things)])) if (JSON.stringify(k.things[id]) !== JSON.stringify(live.things[id])) diff.push(`thing ${id}: replay ${JSON.stringify(k.things[id])?.slice(0, 160)} | live ${JSON.stringify(live.things[id])?.slice(0, 160)}`);
  const liveLinks = live.links, mine = Object.fromEntries(Object.entries(k.links).filter(([, l]: any) => l.until === undefined || l.until >= k.tick));
  for (const id of new Set([...Object.keys(mine), ...Object.keys(liveLinks)])) if (JSON.stringify(mine[id]) !== JSON.stringify(liveLinks[id])) diff.push(`link ${id}: replay ${JSON.stringify(mine[id])} | live ${JSON.stringify(liveLinks[id])}`);
  if (JSON.stringify(k.decks) !== JSON.stringify(live.decks)) diff.push('decks differ');
  if (JSON.stringify(k.vocab) !== JSON.stringify(live.vocab)) diff.push(`vocab differs: cards ${Object.keys(k.vocab.cards).length}/${Object.keys(live.vocab.cards).length}`);
  console.log(diff.slice(0, 8).join('\n') || '(no visible difference: nextId or ordering)');
  await new Promise((r) => setTimeout(r, 1500));
}
process.exit(1);
