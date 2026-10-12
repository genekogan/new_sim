import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coreLibrary } from '@sim/world-compiler';
import { makeItem } from './import-core.ts';
import { loadContract } from './contract.ts';
import { g5, itemFinder } from './findability.ts';

const { item: bench } = await makeItem(coreLibrary().get('core-bench@1')!, { at: '2026-10-12T12:00:00.000Z', run: 'g5', author: 'test', contract: loadContract() });
const existing = { ...bench, text: { ...bench.text, title: 'Bench', first: 'A garden bench for sitting outdoors.', description: 'A garden bench for sitting outdoors.', synonyms: ['park seat', 'garden bench', 'outdoor bench'] } };
const item = { ...bench, id: 'eden/amber-beacon', text: { ...bench.text, title: 'Amber beacon', category: 'utility.light',
  first: 'A bright amber navigation light warns ships at the harbour from a tower.', description: 'A bright amber navigation light warns ships at the harbour from a tower.',
  synonyms: ['warning lamp', 'tower signal', 'navigation beacon'], heldOut: ['harbour warning', 'tower beacon at night'] } };

test('G5 passes clear first-hit words and held-out intents without indexing held-out text', () => {
  const result = g5(item, [existing], [{ q: 'garden bench', any: [existing.id] }]);
  assert.ok(result.ok, result.errors.join('\n'));
  assert.equal(result.numbers.standingAfter, 1);
  assert.equal(result.numbers.regressions, 0);
  assert.deepEqual(itemFinder([{ ...item, text: { ...item.text, heldOut: ['qzxsecret'] } }])('qzxsecret'), []);
});

test('G5 refuses retrieval hijacks, indexed held-out text, and absent held-out queries', () => {
  const stolen = g5({ ...item, text: { ...item.text, title: 'Park seat' } }, [existing]);
  assert.ok(stolen.errors.some((e) => e.startsWith('existing first-hit:')), stolen.errors.join('\n'));
  const leaked = g5({ ...item, text: { ...item.text, heldOut: [item.text.first, 'qzxqzx'] } }, [existing]);
  assert.ok(leaked.errors.some((e) => e.includes('already in indexed text')));
  assert.ok(leaked.errors.some((e) => e.includes('misses')));
  assert.equal(g5({ ...item, text: { ...item.text, heldOut: [] } }, [existing]).ok, false);
});
