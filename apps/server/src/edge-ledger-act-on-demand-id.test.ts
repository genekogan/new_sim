// SOULSIM-E (2026-10-21, real Claude Code Soul agents on Eden 2026 / Sim 3.60): the agent resolved "go to the lighthouse"
// to walk:land-lighthouse-breakwater (resolve offers far places on demand since 9981ed463) and then acted on that id, as
// the skill says. The id was refused place.unwalkable ("no walk reaches it in the current offered destinations"), so the
// Soul told its human it could not go (horse and lighthouse, 2 of the first 3 Eden 2026 requests, again). The id resolve
// gave is now walked on demand exactly as the words are; an id that names nothing is still refused, never swapped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { accept } from '../test/native-owner-fixture.ts';
import { bootEden } from '../test/eden-capabilities-timing.ts';

const NO_EDEN = existsSync(new URL('../../../worlds/templates/eden-2026.json', import.meta.url)) ? false : 'needs worlds/templates/eden-2026.json (lane/engine content)';
type Act = { accepted?: boolean; code?: string; reason?: string };

test('Eden 2026: acting on the far-place id that resolve offered walks there, as the words do', { timeout: 600_000, skip: NO_EDEN }, async (t) => {
  const w = await bootEden();
  t.after(() => w.close());
  const listed = new Set(w.edge.capabilities(w.soul).map((c) => c.id));
  const would = (w.edge.intents.dryRun(w.soul, { capability: 'go to the lighthouse' }) as { would?: { capability: string } }).would?.capability;
  assert.equal(would, 'walk:land-lighthouse-breakwater');
  assert.ok(!listed.has(would!), 'beyond the listing (the case this covers)');
  // an id that names nothing is refused, not swapped for a near one (strict/1 unchanged)
  const none = await w.edge.act(w.soul, { capability: 'walk:no-such-place-zz' }) as Act;
  assert.equal(none.accepted, false); assert.equal(none.code, 'capability.unknown');
  const a = await accept(w.host, Promise.resolve(w.edge.act(w.soul, { capability: would!, clientRef: 'lh-1' }))) as Act;
  assert.equal(a.accepted, true, `${would} accepted (${a.code ?? ''} ${a.reason ?? ''})`);
  assert.deepEqual(new Set(w.edge.capabilities(w.soul).map((c) => c.id)), listed, 'the listing is unchanged');
});
