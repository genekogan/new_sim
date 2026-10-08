import test from 'node:test';import assert from 'node:assert/strict';
import {interiorShellPolygon,navSpecFromPlaces,type Interior} from './edge/ledger/nav.ts';import {loadSpots} from './edge/ledger/activities.ts';import type {Place,PlaceData} from './edge/ledger/places.ts';
const house:Place={id:'eden-house-2',name:'House2',kind:'building',parent:'eden',level:0,enclosed:true,capacity:null,starting:false,description:'fixture',polygon:[[48,5.52],[56,5.52],[56,18],[48,18]]};
const inside:Interior={place:house.id,shell:[48,12,56,18],doors:[[51.4,12,52.6,12]],wall:.14};
test('authored room shell leaves real exterior mailbox approach open and preserves legacy polygon when absent',()=>{
 assert.deepEqual(interiorShellPolygon(house,inside),[[48,12],[56,12],[56,18],[48,18]]);assert.equal(interiorShellPolygon(house,{shell:undefined}),house.polygon);
 const root={...house,id:'eden',parent:null,enclosed:false,polygon:[[0,0],[100,0],[100,100],[0,100]]} as Place;
 const data={contract:'place-data/1',world:'eden',places:[root,house]} as PlaceData;
 const old=navSpecFromPlaces(data,{native:new Set(),ground:[],area:[[0,0,100,100]],interiors:[{...inside,shell:undefined}]});
 const next=navSpecFromPlaces(data,{native:new Set(),ground:[],area:[[0,0,100,100]],interiors:[inside]});
 assert.ok(old.solids.some(s=>s.c[1]<6&&s.half[0]>3));assert.equal(next.solids.some(s=>s.c[1]<12),false,'no fabricated front yard wall');
 assert.ok(next.solids.some(s=>s.c[1]>12&&s.half[0]>2),'real side room walls retained');
});
test('invalid shell bounds refuse conservatively, including concave parent corner-only traps',()=>{
 for(const shell of [[48,12,NaN,18],[48,12,48,18],[47,12,56,18],[48,18,56,12]])assert.equal(interiorShellPolygon(house,{shell:shell as any}),null);
 const concave={polygon:[[0,0],[10,0],[10,10],[8,10],[8,4],[2,4],[2,10],[0,10]] as [number,number][]};assert.equal(interiorShellPolygon(concave,{shell:[1,1,9,9]}),null);
 const duplicate={polygon:[[0,0],[0,0],[1,0],[1,1],[0,1]] as [number,number][]};assert.equal(interiorShellPolygon(duplicate,{shell:[2,2,3,3]}),null);
 const tinyNotch={polygon:[[0,0],[10,0],[10,10],[0,10],[0,.2],[.1,.1]] as [number,number][]};assert.equal(interiorShellPolygon(tinyNotch,{shell:[0,0,10,10]}),null);
 const loaded=loadSpots({contract:'activity-spots/1',interiors:[{...inside,shell:[48,12,48,18]}]});assert.deepEqual(loaded.refused,['interior eden-house-2']);assert.equal(loaded.data.interiors.length,0);
});
