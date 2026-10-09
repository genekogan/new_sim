import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {EDEN_CONTENT_VERSION, EDEN_CONTENT_PROVENANCE, EDEN_LIBRARY_CATALOGUE} from './edge/content/eden-library-catalogue.ts';
import {EDEN_PLACE_LORE} from './edge/content/eden-place-lore.ts';

// Import-relative fixture source: portable from either repo or apps/server cwd.
const bytes = readFileSync(new URL('../../../worlds/eden/places.v1.json', import.meta.url));
const places = JSON.parse(bytes.toString()) as {places: {id: string; level: number}[]};
const known = new Map(places.places.map(p => [p.id, p]));
const length = (s: string) => [...s].length;
const unique = (values: readonly string[], label: string) => assert.equal(new Set(values).size, values.length, label);

test('W2 original catalogue has bounded, uniquely attributable passages about known places', () => {
  const sources: string[] = [], facts: string[] = [];
  assert.equal(createHash('sha256').update(bytes).digest('hex'), EDEN_CONTENT_PROVENANCE.placeDataSHA256, 'place provenance pins actual fixture bytes');
  assert.equal(EDEN_LIBRARY_CATALOGUE.length, 33);
  unique(EDEN_LIBRARY_CATALOGUE.map(b => b.id), 'book IDs');
  unique(EDEN_LIBRARY_CATALOGUE.map(b => b.title), 'book titles');
  const texts: string[] = [];
  for (const book of EDEN_LIBRARY_CATALOGUE) {
    assert.equal(book.version, EDEN_CONTENT_VERSION);
    assert.match(book.id, /^book:[a-z0-9-]+$/);
    assert.ok(length(book.title) > 3 && length(book.title) <= 100);
    assert.ok(length(book.author) > 3 && length(book.author) <= 100);
    assert.ok(book.tags.length > 0 && book.about.length > 0);
    unique(book.tags, `${book.id} tags`);
    assert.equal(book.provenance.kind, 'authored-fiction');
    for (const about of book.about) assert.ok(known.has(about), `${book.id} unknown about ${about}`);
    assert.ok(book.passages.length >= 3 && book.passages.length <= 8, `${book.id} passage count`);
    unique(book.passages.map(p => p.id), `${book.id} passage IDs`);
    for (const passage of book.passages) {
      assert.ok(length(passage.text) >= 50 && length(passage.text) <= 300, `${passage.source} length ${length(passage.text)}`);
      assert.equal(passage.source, `${book.id}@1#${passage.id}`);
      assert.doesNotMatch(passage.text, /lorem ipsum|\bTODO\b|placeholder/i);
      texts.push(passage.text); sources.push(passage.source);
      assert.ok(passage.learned.length >= 1 && passage.learned.length <= 5);
      for (const learned of passage.learned) {
        assert.equal(learned.source, passage.source);
        assert.equal(learned.provenance, 'authored-fiction');
        assert.ok(book.about.includes(learned.about));
        assert.ok(length(learned.fact) >= 25 && length(learned.fact) <= 300);
        facts.push(learned.fact);
      }
    }
  }
  unique(texts, 'passage text is original and non-repeated');
  unique(sources, 'passage source IDs');
  assert.ok(new Set(facts).size >= 10, 'at least ten distinct attributable learned statements are available');
});

test('first-visit lore covers configured static destinations without granting access', () => {
  const configured = ['commons-kitchen', 'eden-stone-garden', 'eden-bandstand', 'eden-market-kiosks', 'eden-north-woods', 'eden-gardens', 'eden-market-1', 'eden-tea-house', 'eden-dome', 'eden-pergola-court', 'eden-amphitheatre', 'eden-hex-pavilion', 'region-park', 'region-park.gazebo', 'region-park.playground', 'eden-library-1', 'eden-south-lawn', 'region-harbour', 'region-harbour.boardwalk', 'region-harbour.west-pier', 'region-harbour.east-pier', 'region-harbour.beach', 'region-artists-village', 'region-artists-village.green', 'region-old-town', 'region-old-town.plaza', 'region-old-town.market-street', 'region-old-town.north-arcade', 'region-old-town.south-arcade', 'eden-performance-stage'];
  const retained = ['field', 'commons', 'commons-deck', 'social-eden-fire-circle', 'social-eden-dining', 'shore-bank', 'shore-water', 'eden-classroom-1'];
  const expected = [...configured, ...retained, ...Array.from({length: 30}, (_, i) => `commons-mat-${i + 1}`)].sort();
  assert.deepEqual(EDEN_PLACE_LORE.map(l => l.about).sort(), expected);
  unique(EDEN_PLACE_LORE.map(l => l.id), 'lore IDs');
  unique(EDEN_PLACE_LORE.map(l => l.source), 'lore sources');
  for (const lore of EDEN_PLACE_LORE) {
    assert.equal(lore.version, EDEN_CONTENT_VERSION);
    assert.ok(known.has(lore.about), `unknown lore place ${lore.about}`);
    // The retained presentation deck is an admitted low stage, not an upper floor.
    assert.ok(known.get(lore.about)!.level === 0 || lore.about === 'commons-deck');
    assert.equal(lore.source, `${lore.id}@1`);
    assert.equal(lore.provenance.kind, 'authored-fiction');
    assert.ok(length(lore.text) >= 80 && length(lore.text) <= 400, `${lore.id} paragraph length`);
    assert.ok(!lore.text.includes('\n'), 'one paragraph');
    assert.doesNotMatch(lore.text, /lorem ipsum|\bTODO\b|placeholder/i);
    assert.equal('walkable' in lore, false, 'content does not grant route admission');
    for (const learned of lore.learned) {
      assert.equal(learned.about, lore.about); assert.equal(learned.source, lore.source);
      assert.equal(learned.provenance, 'authored-fiction');
    }
  }
});
