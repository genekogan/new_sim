// RESOLVE2 (2026-10-22, resolve50 probe N2/N5/N29/N39): resolve offered a far thing's walk (walk:pond-horse-4 for
// "go to the horse") and the same id re-sent was refused capability.unknown "not an id in this world": the place-name
// pre-check (explicitPlaceCapability) ran strict/1 before the on-demand walk. An offered thing id now resolves and acts
// as it was offered; an id that names nothing is still refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { accept } from '../test/native-owner-fixture.ts';
import { bootEden } from '../test/eden-capabilities-timing.ts';

const NO_EDEN = existsSync(new URL('../../../worlds/templates/eden-2026.json', import.meta.url)) ? false : 'needs worlds/templates/eden-2026.json (lane/engine content)';
type Would = { ok?: boolean; code?: string; would?: { capability: string } };

test('Eden 2026: a far thing id without a slash (as resolve offers it) is resolved on demand when re-sent, not "not an id"', { timeout: 600_000, skip: NO_EDEN }, async (t) => {
  const w = await bootEden();
  t.after(() => w.close());
  const listed = new Set(w.edge.capabilities(w.soul).map((c) => c.id));
  const refs = (w.bridge.nav.things() as { ref?: string; kind: string; level?: number }[])
    .filter((x) => x.ref && !x.ref.includes('/') && x.kind !== 'room' && !x.level && !listed.has(`walk:${x.ref}`)).map((x) => x.ref!).slice(0, 12);
  assert.ok(refs.length >= 5, `far things without a slash: ${refs.length}`);
  const refused = refs.filter((r) => { const v = w.edge.intents.dryRun(w.soul, { capability: `walk:${r}` }) as Would & { reason?: string }; return !v.ok && /not an id in this world/.test(v.reason ?? ''); });
  assert.deepEqual(refused, [], 'an existing thing id is never "not an id in this world"');
  const none = w.edge.intents.dryRun(w.soul, { capability: 'walk:no-such-thing-zz' }) as Would;
  assert.equal(none.ok, false); assert.equal(none.code, 'capability.unknown');
  const id = refs.map((r) => (w.edge.intents.dryRun(w.soul, { capability: `walk:${r}` }) as Would).would?.capability).find((c) => c === `walk:${refs[0]}`) ?? `walk:${refs[0]}`;
  const a = await accept(w.host, Promise.resolve(w.edge.act(w.soul, { capability: id, clientRef: 'r2-1' }))) as { accepted?: boolean; code?: string; reason?: string };
  assert.ok(a.accepted || a.code !== 'capability.unknown', `${id} acted (${a.code ?? ''} ${a.reason ?? ''})`);
});
