import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Quality lane (cases 29/33): agents refused swings "because the playground is not walkable" from stale authored prose.
// These Eden places are walkable in the CN5 world, so their descriptions must not say otherwise.
const WALKABLE = ['region-old-town','region-old-town.plaza','region-old-town.north-arcade','region-old-town.south-arcade','region-old-town.market-street','region-park','region-park.gazebo','region-park.playground','region-harbour','region-harbour.boardwalk','region-harbour.west-pier','region-harbour.east-pier','region-harbour.beach','region-artists-village','region-artists-village.green'];
for (const file of ['../../../worlds/eden/places.v1.json', '../test/fixtures/eden-places-cn5.v1.json', '../test/fixtures/eden-places.v1.json']) {
  test('walkable Eden places do not claim to be unwalkable scenery: ' + file, () => {
    const places = JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8')).places as {id: string; description?: string}[];
    for (const id of WALKABLE) {const p = places.find(x => x.id === id); assert.ok(p, id); assert.doesNotMatch(p.description ?? '', /not walkable yet/, id);}
  });
}
