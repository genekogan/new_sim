// RESOLVE (2026-10-21, naive phrases real Claude Code Souls' humans typed on Eden 2026): "go to the horse" ended at the
// west lawn's centre (its description lists a horse), "go to the bakery" in its storeroom, "find a boat" had no "find"
// capability, "go to the lighthuose" named nothing, "go inside the cottage and go upstairs" was capability.unknown and
// "go upstairs" outdoors walked 100 m to a hall, "go to the pond" went to a tree "by" the pond reeds. (The live world's
// horses were added by its god; the template's ducks stand in for them.) Each now resolves to
// the thing the words name (or is refused honestly), from where two real Souls stood (Wren at 71,-15; Ada at -18,-8).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { bootEden } from '../test/eden-capabilities-timing.ts';

const NO_EDEN = existsSync(new URL('../../../worlds/templates/eden-2026.json', import.meta.url)) ? false : 'needs worlds/templates/eden-2026.json (lane/engine content)';
type Would = { ok: boolean; code?: string; reason?: string; would?: { capability: string; available: boolean; label?: string; resolved?: string } };

test('Eden 2026: naive Soul phrases resolve to the thing they name', { timeout: 600_000, skip: NO_EDEN }, async (t) => {
  const w = await bootEden();
  t.after(() => w.close());
  const e = (w.host.engine.world.entities as Record<string, { pose: { p: number[] } }>)[w.soul.entityId];
  const stand = async (x: number, z: number) => { e.pose.p = [x, e.pose.p[1], z]; await w.settle(2); };
  const dry = (text: string) => w.edge.intents.dryRun(w.soul, { capability: text }) as Would;
  const ok = (text: string) => { const r = dry(text); assert.equal(r.ok, true, `${text}: ${r.code ?? ''} ${r.reason ?? ''}`); return r.would!; };

  await stand(71, -15); // Wren
  // the template has ducks where the live world also has horses: decor beyond the listing, named in a place's description
  assert.match(ok('go to the duck').capability, /^walk:commons-pond-duck-\d+$/, 'the duck itself, not a place whose description lists ducks');
  assert.match(ok('find a duck').capability, /^walk:commons-pond-duck-\d+$/);
  assert.equal(ok('go to the dcuk').capability, ok('go to the duck').capability);
  assert.equal(ok('go to the bakery').capability, 'walk:int-bakery', 'in at the front door, not the storeroom shelf nearest the Soul');
  assert.equal(ok('go into the bakery').capability, 'walk:int-bakery');
  assert.match(ok('find a boat').capability, /boat/, 'find X walks to the nearest X');
  assert.match(ok('look for a bench').capability, /bench/);
  const light = ok('go to the lighthouse'), typo = ok('go to the lighthuose');
  assert.equal(typo.capability, light.capability, 'a misspelt name reads as the name');
  assert.match(typo.resolved ?? '', /read "lighthuose" as "lighthouse"/, 'and the reply says how it was read');
  assert.equal(ok('walk to the cotage').capability, ok('walk to the cottage').capability);
  const up = ok('go inside the cottage and go upstairs');
  assert.match(up.label ?? '', /floor [1-9]/, `an upper floor of a cottage: ${up.capability} ${up.label}`);
  assert.equal(dry('go to the airport').ok, false, 'a place that is not here is still refused, not swapped');

  await stand(-18, -8); // Ada, outdoors on the commons
  assert.equal(ok('go to the pond').capability, 'walk:land-commons-shore-pond', 'the pond, not a tree "by" the pond reeds');
  assert.equal(ok('find the pond').capability, 'walk:land-commons-shore-pond');
  const out = dry('go upstairs');
  assert.equal(out.ok, false); assert.equal(out.code, 'floor.no-building', `${out.code} ${out.reason}`);
});
