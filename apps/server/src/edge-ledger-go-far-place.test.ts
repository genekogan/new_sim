// GO-FAR (2026-10-23, Soul tranche, live on Sim 3.79): `act go --place seafront-hotel-4` answered HTTP 503 "the ledger could
// not answer; retry" (server TypeError in Intents.go: the far place's walk is not in the capability listing, so
// caps.find(...)! was undefined) while `act "walk to seafront-hotel-4"` walked there. The structured go now builds the far
// walk on demand exactly as the words do, and a place nothing walks to is an honest refusal, never a ledger fault.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { accept } from '../test/native-owner-fixture.ts';
import { bootEden } from '../test/eden-capabilities-timing.ts';

const NO_EDEN = existsSync(new URL('../../../worlds/templates/eden-2026.json', import.meta.url)) ? false : 'needs worlds/templates/eden-2026.json (lane/engine content)';
type Act = { accepted?: boolean; code?: string; reason?: string; capability?: string };

test('Eden 2026: go --place <far place> walks there on demand, as "walk to <place>" does', { timeout: 600_000, skip: NO_EDEN }, async (t) => {
  const w = await bootEden();
  t.after(() => w.close());
  const far = 'land-lighthouse-breakwater', listed = new Set(w.edge.capabilities(w.soul).map((c) => c.id));
  assert.ok(!listed.has(`walk:${far}`), 'beyond the listing (the case this covers)');
  const dry = w.edge.intents.dryRun(w.soul, { verb: 'go', target: { place: far } }) as { ok?: boolean; code?: string; would?: { capability: string } };
  assert.equal(dry.ok, true, `dry run: ${dry.code ?? ''}`); assert.equal(dry.would?.capability, `walk:${far}`);
  const a = await accept(w.host, Promise.resolve(w.edge.act(w.soul, { verb: 'go', target: { place: far }, clientRef: 'gofar-1' }))) as Act;
  assert.equal(a.accepted, true, `go ${far} accepted (${a.code ?? ''} ${a.reason ?? ''})`);
  // a place that names nothing is still an honest refusal (no throw)
  const none = await w.edge.act(w.soul, { verb: 'go', target: { place: 'no-such-place-zz' } }) as Act;
  assert.equal(none.accepted, false); assert.ok(none.code && none.code !== 'ledger.fault', `refusal code: ${none.code}`);
  assert.deepEqual(new Set(w.edge.capabilities(w.soul).map((c) => c.id)), listed, 'the listing is unchanged');
});
