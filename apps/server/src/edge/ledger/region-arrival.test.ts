import test from 'node:test';
import assert from 'node:assert/strict';
import {PlaceIndex,type Place} from './places.ts';
import {outdoorRegionExclusions} from './region-arrival.ts';
const polygon=(x=0):[number,number][]=>[[x-2,-2],[x+2,-2],[x+2,2],[x-2,2]];
const place=(id:string,parent:string|null,kind:string,extra:Partial<Place>={}):Place=>({id,parent,kind,name:id,polygon:polygon(),level:0,enclosed:false,capacity:null,starting:false,...extra});
test('outdoor arrival uses physical building ancestry, deduplicates rooms, and leaves districts alone',()=>{
 const field=place('field','world','walkable'),building=place('hall','field','building',{semanticParent:'other-district'}),room=place('hall.room','hall','room',{enclosed:true}),unrelated=place('elsewhere','world','building',{semanticParent:'field',polygon:polygon(20)});
 const index=new PlaceIndex({contract:'place-data/1',world:'test',places:[place('world',null,'outdoor'),field,building,room,unrelated,place('town','world','district'),place('town.house','town','building')]});
 assert.deepEqual(outdoorRegionExclusions(index,'field'),[building.polygon]);
 assert.deepEqual(outdoorRegionExclusions(index,'town'),undefined);
 assert.deepEqual(outdoorRegionExclusions(index,'hall'),undefined);
 assert.deepEqual(outdoorRegionExclusions(index,'missing'),undefined);
});
