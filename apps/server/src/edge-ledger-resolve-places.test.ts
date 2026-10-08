// CN5 (Gene 2026-10-07: "walk to the harbour" resolved to walk:region-park): a named place resolves to itself, a place
// inside it or the place containing it, or is refused honestly (place.unreachable with the nearest reachable places in
// did_you_mean). Checked over every place in World's live places file, by id and by name, for the live walkable set
// and for the CN5 set (districts admitted). Zero wrong resolutions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveCapability, tokens, type VocabContext, type VocabPlace} from './edge/ledger/vocabulary.ts';
import {centroid, type PlaceData} from './edge/ledger/places.ts';
import type {EdgeCapability} from './edge/contract.ts';
import {CN5_DISTRICT_PLACES} from './edge/ledger/districts.ts';

const DATA = JSON.parse(readFileSync(new URL('../test/fixtures/eden-places-cn5.v1.json', import.meta.url), 'utf8')) as PlaceData;
/** Native regions on the live CN4 world (engine regions + descriptor nativePlaces). */
const ENGINE = ['field', 'commons', 'commons-deck', 'shore-bank', 'shore-water', 'social-eden-fire-circle', 'social-eden-dining', 'eden-classroom-1', ...Array.from({length: 30}, (_, i) => `commons-mat-${i + 1}`)];
const LIVE = [...ENGINE, 'commons-kitchen', 'eden-stone-garden', 'eden-bandstand', 'eden-market-kiosks', 'eden-north-woods', 'eden-gardens', 'eden-market-1', 'eden-tea-house', 'eden-dome', 'eden-pergola-court',
  'eden-amphitheatre', 'eden-hex-pavilion', 'region-park', 'region-park.gazebo', 'region-park.playground', 'eden-library-1', 'eden-south-lawn'];

function context(walkable: Set<string>, me: [number, number] = [10, 5]): VocabContext {
  const places: VocabPlace[] = DATA.places.filter(p => p.parent !== null).map(p => ({id: p.id, name: p.name, center: centroid(p.polygon), parent: p.parent, kind: p.kind, description: p.description, walkable: walkable.has(p.id)}));
  const byId = new Map(places.map(p => [p.id, p]));
  const caps: EdgeCapability[] = [...walkable].sort().flatMap(id => {const p = byId.get(id)!; return [
    {id: 'walk:' + id, verb: 'walk', label: p.name, available: true, target: {id, kind: 'place'}},
    {id: 'hang-out:' + id, verb: 'hang-out', label: `Hang out at ${p.name}`, available: true, target: {id, kind: 'place'}}];});
  caps.push({id: 'wander:here', verb: 'wander', label: 'Stroll around nearby', available: true}, {id: 'rest:here', verb: 'rest', label: 'Rest here', available: true});
  return {caps, places, root: ['eden'], me, target: c => {const p = c.target ? byId.get(c.target.id) : undefined; return p ? {names: [p.name], around: [], at: p.center} : {names: [], around: [], at: null};}};
}

function audit(walkable: Set<string>) {
  const ctx = context(walkable), byId = new Map(ctx.places.map(p => [p.id, p]));
  const up = (id: string) => {const out: string[] = []; for (let p = byId.get(id); p?.parent && byId.has(p.parent); p = byId.get(p.parent)) out.push(p.parent);return out;};
  const family = (p: VocabPlace, t: string) => t === p.id || up(p.id).includes(t) || up(t).includes(p.id);
  const sameName = (p: VocabPlace, t: string) => tokens(byId.get(t)?.name ?? '').join(' ') === tokens(p.name).join(' ');
  const wrong: string[] = [], counts = {resolved: 0, refused: 0};
  for (const p of ctx.places) {
    const reachable = walkable.has(p.id);
    for (const [input, byName] of [[`walk:${p.id}`, false], [`walk to the ${p.name}`, true], [`go to ${p.name}`, true], [`walk:${p.name}`, true], [`hang out at the ${p.name}`, true]] as const) {
      const r = resolveCapability(input, ctx);
      if (r.kind === 'unknown') {
        counts.refused++;
        if (reachable) wrong.push(`${input} → refused although ${p.id} is walkable (${r.reason})`);
        else if (r.code !== 'place.unreachable' && r.code !== undefined) wrong.push(`${input} → odd code ${r.code}`);
        continue;
      }
      counts.resolved++;
      const t = r.cap.target?.id ?? '';
      // also right: the target is itself named by every asked word (its own name or id), e.g. "Fire circle" → social-eden-fire-circle
      const words = tokens(p.name).filter(w => !['eden', 'region'].includes(w));
      const named = byName && words.length > 0 && words.every(w => [...tokens(byId.get(t)?.name ?? ''), ...tokens(t)].includes(w));
      if (!(family(p, t) || (byName && sameName(p, t)) || named)) wrong.push(`${input} → ${r.cap.id} (${r.kind === 'alias' ? r.note : 'exact'})`);
      if (reachable && !byName && r.cap.id !== `${input.slice(0, input.indexOf(':'))}:${p.id}`) wrong.push(`${input} → ${r.cap.id}, not itself`);
    }
  }
  return {wrong, counts};
}

test('resolver: every place name and id resolves to itself, inside it or its container, or is refused honestly (live and CN5 walkable sets)', () => {
  for (const [label, set] of [['live CN4', new Set(LIVE)], ['CN5 districts', new Set([...LIVE, ...CN5_DISTRICT_PLACES])]] as const) {
    const {wrong, counts} = audit(set);
    assert.deepEqual(wrong, [], `${label}: ${wrong.length} wrong of ${counts.resolved + counts.refused}`);
    assert.ok(counts.refused > 0 && counts.resolved > 0, label + JSON.stringify(counts));
  }
});

test('resolver: the harbour is refused while unreachable (place.unreachable, nearest reachable offered) and is itself once admitted', () => {
  const live = resolveCapability('walk to the harbour', context(new Set(LIVE)));
  assert.equal(live.kind, 'unknown'); assert.equal((live as {code?: string}).code, 'place.unreachable');
  assert.match((live as {reason: string}).reason, /Harbour, boardwalk and beach is not walkable ground yet/);
  assert.ok((live as {didYouMean: {id: string}[]}).didYouMean.length > 0 && (live as {didYouMean: {id: string}[]}).didYouMean.every(d => d.id.startsWith('walk:')));
  const cn5 = context(new Set([...LIVE, ...CN5_DISTRICT_PLACES]));
  for (const [words, id] of [['walk to the harbour', 'region-harbour'], ['walk to the boardwalk', 'region-harbour.boardwalk'], ['walk:west pier', 'region-harbour.west-pier'], ['go to the beach', 'region-harbour.beach'],
    ["walk to the artists' village", 'region-artists-village'], ['walk to the old town', 'region-old-town'], ['walk to the market street', 'region-old-town.market-street'], ['go to the village green', 'region-artists-village.green']] as const) {
    const r = resolveCapability(words, cn5); assert.equal(r.kind === 'unknown' ? r.reason : r.cap.id, 'walk:' + id, words);
  }
  // the lighthouse is a closed building on the breakwater: its container, the harbour, said so
  const lh = resolveCapability('walk to the lighthouse', cn5); assert.equal(lh.kind, 'alias'); assert.equal((lh as {cap: EdgeCapability}).cap.id, 'walk:region-harbour'); assert.match((lh as {note: string}).note, /contains it/);
  // the observatory plateau stands 13 m above level ground: refused, never another place
  const obs = resolveCapability('walk to the observatory dome', cn5); assert.equal(obs.kind, 'unknown'); assert.equal((obs as {code?: string}).code, 'place.unreachable');
});
