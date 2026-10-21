// SOULSIM-E (2026-10-21, real Claude Code Soul agents on Eden 2026): a Soul resolves its human's words first (as the skill
// says) and only then acts. Resolve (the dry run) did not offer the walk the listing leaves out for distance, so "go to
// the lighthouse" and "go to the horse" were answered "<place> is not walkable ground yet" by resolve while act would have
// walked there, and the Soul told its human it could not go. And "run to the cottage" ran to a woodland whose description
// lists a cottage (the listing offers gaits to open places only). Resolve now goes through the same on-demand offers as
// act, and a run or jog goes to the place the same words walk to.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { bootEden } from '../test/eden-capabilities-timing.ts';

const NO_EDEN = existsSync(new URL('../../../worlds/templates/eden-2026.json', import.meta.url)) ? false : 'needs worlds/templates/eden-2026.json (lane/engine content)';
type Would = { ok: boolean; code?: string; reason?: string; would?: { capability: string; available: boolean } };

test('Eden 2026: resolve answers far named places as act does, and a run goes where the same words walk', { timeout: 600_000, skip: NO_EDEN }, async (t) => {
  const w = await bootEden();
  t.after(() => w.close());
  const listed = new Set(w.edge.capabilities(w.soul).map((c) => c.id));
  const dry = (text: string) => w.edge.intents.dryRun(w.soul, { capability: text }) as Would;
  // the cases: far places the listing leaves out (the lighthouse's breakwater, the big top)
  for (const [text, cap] of [['go to the lighthouse', 'walk:land-lighthouse-breakwater'], ['go to the big top', 'walk:region-festival-meadow-big-top'], ['walk to the pier', 'walk:land-harbour-east-pier']]) {
    assert.ok(!listed.has(cap), `${cap} is beyond the listing (the case this covers)`);
    const r = dry(text);
    assert.equal(r.ok, true, `${text}: ${r.code ?? ''} ${r.reason ?? ''}`);
    assert.equal(r.would?.capability, cap, text);
    assert.equal(r.would?.available, true, text);
  }
  // a far place at a gait: its walk, then that gait
  const run = dry('run to the lighthouse');
  assert.equal(run.ok, true, `run to the lighthouse: ${run.code ?? ''} ${run.reason ?? ''}`);
  assert.equal(run.would?.capability, 'run:g-land-lighthouse-breakwater');
  // a run goes where the same words walk (a cottage, not a woodland whose description lists one)
  const walk = dry('walk to the cottage'), toCottage = dry('run to the cottage');
  assert.equal(walk.ok, true); assert.equal(toCottage.ok, true, `run to the cottage: ${toCottage.code ?? ''} ${toCottage.reason ?? ''}`);
  const place = (id: string | undefined) => id?.slice(id.indexOf(':') + 1).replace(/^g-/, '').split('/')[0];
  assert.equal(place(toCottage.would?.capability), place(walk.would?.capability), `${toCottage.would?.capability} goes where ${walk.would?.capability} does`);
  assert.match(toCottage.would!.capability, /^run:/);
  // unchanged: a loop is still a loop, and a place that does not exist is still refused, not swapped
  assert.match(dry('run around the pond').would?.capability ?? '', /^run-around:/);
  assert.equal(dry('go to the airport').ok, false);
  // the listing itself is unchanged (offers on demand are for that resolution only)
  assert.deepEqual(new Set(w.edge.capabilities(w.soul).map((c) => c.id)), listed);
});
