// E2 #6: "canal boat" ranked the canal (a def named by one word of the phrase) above the narrowboat (whose own name
// for the whole phrase is "canal boat"). A phrase synonym now counts as the name; one word naming a def is a token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchDefs } from './assets.ts';
import { FAMILY_KITS } from '../../../../packages/world-compiler/src/core-kit/index.ts';

const defs = (FAMILY_KITS as unknown as { name: string; synonyms?: string[]; tags?: string[]; description?: string }[])
  .map((d) => { const name = d.name.startsWith('core-') ? d.name : `core-${d.name}`; return { ...d, name, ref: `${name}@1` }; });
const top = (q: string) => searchDefs(defs, q, { limit: 3 })[0]?.def.name;

test('a phrase synonym beats a def named by one word of the phrase', () => {
  assert.equal(top('canal boat'), 'core-narrowboat');
  assert.equal(top('swan boat'), 'core-pedalo');
  assert.equal(top('water bird'), 'core-swan');
});

test('one-word and whole-name queries are unchanged', () => {
  assert.equal(top('canal'), 'core-canal');
  assert.equal(top('narrowboat'), 'core-narrowboat');
  assert.equal(top('houseboat'), 'core-narrowboat');
  assert.equal(top('rowing boat'), 'core-rowing-boat');
  assert.equal(top('water tank'), 'core-water-tank');
  assert.equal(top('tennis court'), 'core-tennis-court');
});

test('every multi-word synonym or name in the core kit finds its def first (at least 99%)', () => {
  let n = 0, ok = 0;
  for (const d of defs) for (const q of [...(d.synonyms ?? []).filter((s) => /[\s-]/.test(s)).map((s) => s.replace(/-/g, ' ')), ...(/-/.test(d.name.slice(5)) ? [d.name.slice(5).replace(/-/g, ' ')] : [])]) {
    n++; const hits = searchDefs(defs, q, { limit: 5 }); const mine = hits.find((h) => h.def.name === d.name);
    if (hits[0] && mine && mine.score === hits[0].score) ok++;
  }
  assert.ok(n > 1000 && ok / n >= 0.99, `${ok}/${n}`);   // main: 1374/1394 (98.6%); this change: 1384/1394
});
