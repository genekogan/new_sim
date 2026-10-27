// SOULSIM-E (2026-10-21, real Claude Code Soul agents on Eden 2026 / Sim 3.60): the agent resolved "go to the lighthouse"
// to walk:land-lighthouse-breakwater (resolve offers far places on demand since 9981ed463) and then acted on that id, as
// the skill says. The id was refused place.unwalkable ("no walk reaches it in the current offered destinations"), so the
// Soul told its human it could not go (horse and lighthouse, 2 of the first 3 Eden 2026 requests, again). The id resolve
// gave is now walked (and resolved) on demand exactly as the words are; an id that names nothing is still refused, never swapped.
// Same run: walk:castle-keep, walk:beach-hut-1, walk:land-botanic-koi-pond (9 refusals in 52 messages; the agent built its
// own hop script through nearer places, so walks took 4-8 minutes and new messages waited 70-105 s for an ack).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { accept } from '../test/native-owner-fixture.ts';
import { bootEden } from '../test/eden-capabilities-timing.ts';

const NO_EDEN = existsSync(new URL('../../../worlds/templates/eden-2026.json', import.meta.url)) ? false : 'needs worlds/templates/eden-2026.json (lane/engine content)';
type Act = { accepted?: boolean; code?: string; reason?: string; receipt?: {id:string;capability:string} };

test('Eden 2026: acting on the far-place id that resolve offered walks there, as the words do', { timeout: 600_000, skip: NO_EDEN }, async (t) => {
  const w = await bootEden();
  t.after(() => w.close());
  const listed = new Set(w.edge.capabilities(w.soul).map((c) => c.id));
  const would = (w.edge.intents.dryRun(w.soul, { capability: 'go to the lighthouse' }) as { would?: { capability: string } }).would?.capability;
  assert.equal(would, 'walk:region-harbour-lighthouse', 'the authored lighthouse identity, not its neighbouring breakwater');
  assert.ok(!listed.has(would!), 'beyond the listing (the case this covers)');
  // an id that names nothing is refused, not swapped for a near one (strict/1 unchanged)
  const none = await w.edge.act(w.soul, { capability: 'walk:no-such-place-zz' }) as Act;
  assert.equal(none.accepted, false); assert.equal(none.code, 'capability.unknown');
  // resolve answers the id itself as it answers the words (the agent re-resolves ids it read from the map)
  const byId = w.edge.intents.dryRun(w.soul, { capability: would! }) as { ok?: boolean; would?: { capability: string } };
  assert.equal(byId.ok, true); assert.equal(byId.would?.capability, would);
  // a pond's walk goes to its shore (g-land-botanic-koi-pond.shore-bank, not a child of the pond): its id too
  const pond = w.edge.intents.dryRun(w.soul, { capability: 'walk:land-botanic-koi-pond' }) as { ok?: boolean; code?: string; would?: { capability: string } };
  assert.equal(pond.ok, true, `walk:land-botanic-koi-pond: ${pond.code ?? ''}`);
  assert.equal((w.edge.intents.dryRun(w.soul,{capability:'walk:land-lighthouse-breakwater'}) as {would?:{capability:string}}).would?.capability,'walk:land-lighthouse-breakwater','the explicitly named breakwater remains independently reachable');
  const body=()=>w.host.engine.world.entities[w.soul.entityId]!;
  const start=[...body().pose.p];
  const target=w.bridge.nav.thing('region-harbour-lighthouse')!,goal=w.bridge.nav.goal(target,[start[0],start[2]])!;assert.ok(goal);
  const a = await accept(w.host, Promise.resolve(w.edge.act(w.soul, { capability: would!, clientRef: 'lh-1' }))) as Act;
  assert.equal(a.accepted, true, `${would} accepted (${a.code ?? ''} ${a.reason ?? ''})`);
  assert.deepEqual(new Set(w.edge.capabilities(w.soul).map((c) => c.id)), listed, 'the listing is unchanged');
  const arrive=async(out:Act)=>{assert.equal(out.accepted,true,JSON.stringify(out));const tick=w.host.engine.world.tick;let phase='accepted';while(['accepted','started'].includes(phase)&&w.host.engine.world.tick-tick<600*20){await w.settle(20);phase=w.edge.receipt(w.soul.soulId,out.receipt!.id)!.phase;}assert.equal(phase,'completed');const p=body().pose.p;assert.ok(Math.hypot(p[0]-goal.p[0],p[2]-goal.p[1])<1.5,JSON.stringify({p,goal}));assert.equal(body().human?.level??0,goal.level);return [...p];};
  const walked=await arrive(a);
  body().pose.p=[...start] as [number,number,number];await w.settle(2);
  const run=await accept(w.host,Promise.resolve(w.edge.act(w.soul,{capability:'run to the lighthouse',clientRef:'lh-run'}))) as Act;assert.equal(run.receipt?.capability,'run:g-region-harbour-lighthouse');
  const ran=await arrive(run);assert.ok(Math.hypot(walked[0]-ran[0],walked[2]-ran[2])<1.5,'walk and run arrive at the same authored lighthouse doorway');
});
