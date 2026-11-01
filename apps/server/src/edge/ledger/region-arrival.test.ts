import test from 'node:test';
import assert from 'node:assert/strict';
import {PlaceIndex,type Place} from './places.ts';
import {outdoorRegionExclusions} from './region-arrival.ts';
const polygon=(x=0):[number,number][]=>[[x-2,-2],[x+2,-2],[x+2,2],[x-2,2]];
const place=(id:string,parent:string|null,kind:string,extra:Partial<Place>={}):Place=>({id,parent,kind,name:id,polygon:polygon(),level:0,enclosed:false,capacity:null,starting:false,...extra});
test('outdoor arrival uses physical building ancestry, deduplicates rooms, and leaves districts alone',()=>{
 const field=place('field','world','walkable',{polygon:[[-10,-10],[10,-10],[10,10],[-10,10]]}),building=place('hall','field','building',{semanticParent:'other-district'}),room=place('hall.room','hall','room',{enclosed:true}),unrelated=place('elsewhere','world','building',{semanticParent:'field',polygon:polygon(20)});
 const index=new PlaceIndex({contract:'place-data/1',world:'test',places:[place('world',null,'outdoor'),field,building,room,unrelated,place('town','world','district',{polygon:polygon(30)}),place('town.house','town','building',{polygon:polygon(30)})]});
 assert.deepEqual(outdoorRegionExclusions(index,'field'),[building.polygon]);
 assert.deepEqual(outdoorRegionExclusions(index,'town'),undefined);
 assert.deepEqual(outdoorRegionExclusions(index,'hall'),undefined);
 assert.deepEqual(outdoorRegionExclusions(index,'missing'),undefined);
});

test('coextensive outdoor peers exclude physically overlapping interiors, not disjoint or other-level places',()=>{
 const outline:[number,number][]=[[-10,-10],[10,-10],[10,10],[-10,10]];
 const field=place('field','world','walkable',{polygon:outline}),peer=place('peer','world','zone',{polygon:outline});
 const building=place('pavilion','peer','building'),room=place('pavilion.room','pavilion','room',{enclosed:true});
 const edge=place('edge','world','building',{polygon:polygon(10)});
 const index=new PlaceIndex({contract:'place-data/1',world:'test',places:[place('world',null,'outdoor'),field,peer,building,room,edge,
  place('disjoint','world','building',{polygon:polygon(30)}),place('upstairs','peer','room',{enclosed:true,level:1}),
  place('same-outline','world','building',{polygon:[...outline].reverse()}),
  place('same-subdivided-outline','world','building',{polygon:[[-10,-10],[0,-10],[10,-10],[10,10],[-10,10],[-10,-10]]}),
  place('plain-peer','world','outdoor',{polygon:outline})]});
 assert.deepEqual(outdoorRegionExclusions(index,'field'),[building.polygon,edge.polygon]);
 assert.deepEqual(outdoorRegionExclusions(index,'peer'),[building.polygon,edge.polygon],'physical zone identity has the same outdoor exclusions');
 assert.equal(outdoorRegionExclusions(index,'pavilion.room'),undefined,'explicit interior arrival is unaffected');
});

test('polygon crossings count without contained vertices; overlapping boxes alone do not',()=>{
 const field=place('field','world','outdoor',{polygon:[[-4,-1],[4,-1],[4,1],[-4,1]]});
 const crossing=place('crossing','world','building',{polygon:[[-1,-4],[1,-4],[1,4],[-1,4]]});
 const diagonal=place('diagonal','world','building',{polygon:[[3,3],[4,3],[4,4]]});
 const index=new PlaceIndex({contract:'place-data/1',world:'test',places:[place('world',null,'outdoor'),field,crossing,diagonal]});
 assert.deepEqual(outdoorRegionExclusions(index,'field'),[crossing.polygon]);
 const triangle=place('triangle','world','outdoor',{polygon:[[0,0],[10,0],[0,10]]});
 const separate=place('separate','world','building',{polygon:[[8,8],[9,8],[8,9]]});
 const other=new PlaceIndex({contract:'place-data/1',world:'test',places:[place('world',null,'outdoor'),triangle,separate]});
 assert.deepEqual(outdoorRegionExclusions(other,'triangle'),[]);
});

test('an explicit open area inside its enclosing building does not exclude its own ancestor',()=>{
 const building=place('building','world','building',{polygon:[[-10,-10],[10,-10],[10,10],[-10,10]]}),court=place('court','building','outdoor');
 const index=new PlaceIndex({contract:'place-data/1',world:'test',places:[place('world',null,'outdoor'),building,court]});
 assert.deepEqual(outdoorRegionExclusions(index,'court'),[]);
});
