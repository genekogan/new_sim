import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {RenderScene} from '@sim/engine-contract';
import type {Runtime} from '../../../mars/viewer/engine/runtime/runtime.ts';
import type {GroundField} from '../../../mars/viewer/engine/spatial/ground.ts';
import type {Entity} from '../../../mars/viewer/engine/world/types.ts';
import type {CarrierInstallSpec} from '../../../mars/viewer/engine/vehicles/carrier.ts';
import {deckedField} from '../../../mars/viewer/engine/spatial/tiled.ts';
import type {Ground} from '../../ground/src/index.ts';
import {groundFact,groundField} from './ground-bridge.ts';
import {previewPunt,puntCandidates} from './punt.ts';
import {previewPunt as legacyPreview,puntCandidates as legacyCandidates} from './punt-search-reference.fixture.ts';

type V2=[number,number];
const pond:V2[]=[[-15,-15],[15,-15],[15,15],[-15,15]];
const ground=(area:V2[]=pond,edge=1):Ground=>({schema:'ground/1',base:0,extent:[-60,-60,60,60],
  waters:[{id:'pond',area,level:-.2}],landforms:[{id:'bed',kind:'carve',area,bed:-1.4,edge}]});
const obstacle=(id:string,x:number,z:number):Entity=>({id,kind:'fixture',def:'eden-commons-table',pose:{p:[x,0,z],yaw:0}} as Entity);

/** Only the read-only search's dependencies: real ground geometry, without constructing navigation grids or a world host. */
function fixture(g:Ground,entities:Record<string,Entity>={},overlay?:(field:GroundField)=>GroundField){
  const fact=groundFact(g,0),base=groundField(fact.recipeHash),counts={water:0,height:0,medium:0,fields:0,entityScans:0};
  const counted=(source:GroundField):GroundField=>({...source,
    waterLevel:(x,z)=>{counts.water++;return source.waterLevel(x,z);},
    height:(x,z)=>{counts.height++;return source.height(x,z);},
    medium:(x,z)=>{counts.medium++;return source.medium(x,z);},
  });
  let field=counted(overlay?overlay(base):base);
  const spatial={ground:{get field(){counts.fields++;return field;}},epoch:0,sync(){return false;}};
  const world={groundV1:fact,entities:new Proxy(entities,{ownKeys(target){counts.entityScans++;return Reflect.ownKeys(target);}})};
  const rt={world,services:{spatial}} as unknown as Runtime;
  return {rt,counts,spatial,entities,setField(next:GroundField){field=counted(next);spatial.epoch++;},base};
}
function compare(g:Ground,entities:Record<string,Entity>={},overlay?:(field:GroundField)=>GroundField){
  const old=fixture(g,structuredClone(entities),overlay),now=fixture(g,structuredClone(entities),overlay);
  const expected=legacyCandidates(old.rt),actual=puntCandidates(now.rt);
  assert.deepEqual(actual,expected,'same ordered candidates, including every route key, bank coordinate and heading');
  for(const spec of actual){assert.equal(legacyPreview(old.rt,spec),null);assert.equal(previewPunt(now.rt,spec),null);}
  return {old,now,actual};
}

test('punt search matches frozen selection and order on absent, tiny, ordinary and multiple waters',()=>{
  assert.deepEqual(compare({...ground(),waters:[]}).actual,[]);
  assert.deepEqual(compare(ground([[0,0],[3,0],[3,3],[0,3]])).actual,[]);
  assert.equal(compare(ground()).actual.length,1);
  assert.equal(compare(ground([...pond].reverse())).actual.length,1);
  const second=pond.map(([x,z])=>[x+36,z] as V2),g=ground();
  g.waters.unshift({id:'second',area:second,level:-.2});
  g.landforms.push({id:'second-bed',kind:'carve',area:second,bed:-1.4,edge:1});
  const {actual}=compare(g);
  assert.equal(actual.length,2);assert.match(actual[0].id,/^punt-second-/);assert.match(actual[1].id,/^punt-pond-/);
});

test('shelf fallback, quay, furniture and deck geometry retain the same selected route or refusal',()=>{
  const shelf=ground(pond,8);
  assert.deepEqual(compare(shelf).actual,[]);
  const quay:Ground={...shelf,landforms:[...shelf.landforms,{id:'quay',kind:'carve',area:[[10,5],[15,5],[15,11],[10,11]],bed:-1.4,edge:.5}]};
  const {actual}=compare(quay);assert.equal(actual.length,1);assert.ok(actual[0].at[0]>9);
  const plain=compare(ground()).actual[0],door=plain.bank!.door;
  const blocked=compare(ground(),{table:obstacle('table',door[0],door[2])}).actual;
  assert.equal(blocked.length,1);assert.notDeepEqual(blocked[0].bank!.door,door,'blocked first side tries later sides in the original order');
  const ignored={marker:{...obstacle('marker',door[0],door[2]),kind:'marker'} as Entity,
    person:{...obstacle('person',door[0],door[2]),human:{}} as Entity};
  assert.deepEqual(compare(ground(),ignored).actual,[plain],'people and markers do not become bank furniture');
  compare(shelf,{},base=>deckedField(base,[{id:'quay-deck',level:0,y:0,obb:{c:[13,7],half:[3,2],yaw:Math.PI/16}}],'punt-test-deck'));
});

test('native shore probe reuse retains the selected route and public refusal precedence',()=>{
  const source=JSON.parse(readFileSync(new URL('./fixtures/shore-bed.v1.json',import.meta.url),'utf8'));
  const render={shore:{terrain:source.terrain,water:source.water}} as unknown as RenderScene;
  const old=fixture({...ground(),waters:[]}),now=fixture({...ground(),waters:[]});
  const expected=legacyCandidates(old.rt,render),actual=puntCandidates(now.rt,render);
  assert.deepEqual(actual,expected);assert.equal(actual.length,1);
  const spec=actual[0];assert.equal(previewPunt(now.rt,spec,render),null);
  const variants:CarrierInstallSpec[]=[];
  const missing=structuredClone(spec);delete missing.bank;variants.push(missing);
  const noHome=structuredClone(spec);noHome.routeKeys![0].p[1]+=1;variants.push(noHome);
  const short=structuredClone(spec);short.routeKeys=short.routeKeys!.map(k=>({...k,t:k.t/100}));variants.push(short);
  const fast=structuredClone(spec);fast.routeKeys![1].p[0]+=10;variants.push(fast);
  const dry=structuredClone(spec);dry.routeKeys![8].p[2]=13;variants.push(dry);
  const bank=structuredClone(spec);bank.bank!.door[1]+=1;variants.push(bank);
  const far=structuredClone(spec);far.bank!.door[0]+=10;variants.push(far);
  for(const changed of variants){
    // Also break the bank: water/speed/period failures must retain their original diagnostic priority.
    if(changed.bank)changed.bank.door[1]+=1;
    const expectedIssue=legacyPreview(old.rt,changed,render);
    assert.ok(expectedIssue);assert.deepEqual(previewPunt(now.rt,changed,render),expectedIssue);
  }
});

test('a synchronous search shares geometry and obstacle enumeration, and failed hull probes short-circuit',()=>{
  const plain=compare(ground()).actual[0],door=plain.bank!.door;
  const {old,now,actual}=compare(ground(),{table:obstacle('table',door[0],door[2])});
  assert.equal(actual.length,1);
  assert.ok(now.counts.fields<old.counts.fields,`water contexts ${now.counts.fields} < ${old.counts.fields}`);
  assert.ok(now.counts.entityScans<old.counts.entityScans,`obstacle scans ${now.counts.entityScans} < ${old.counts.entityScans}`);
  const oldDry=fixture(ground()),nowDry=fixture(ground());
  // Every probe is inside the polygon, but the water is too shallow at the first point of every hull.
  const shallow={...oldDry.base,height:()=>-.25};oldDry.setField(shallow);nowDry.setField(shallow);
  const expected=legacyPreview(oldDry.rt,plain),issue=previewPunt(nowDry.rt,plain);
  assert.ok(issue);assert.deepEqual(issue,expected);
  assert.equal(oldDry.counts.water,16);assert.equal(nowDry.counts.water,1);
});

test('search-local geometry and furniture are refreshed after edits and spatial synchronization',()=>{
  const old=fixture(ground()),now=fixture(ground());
  const spec=legacyCandidates(old.rt)[0];assert.deepEqual(puntCandidates(now.rt),[spec]);
  const [x,,z]=spec.bank!.door;
  old.entities.table=obstacle('table',x,z);now.entities.table=obstacle('table',x,z);
  assert.deepEqual(previewPunt(now.rt,spec),legacyPreview(old.rt,spec));
  assert.match(previewPunt(now.rt,spec)!.message,/Furniture/);
  delete old.entities.table;delete now.entities.table;
  assert.equal(previewPunt(now.rt,spec),null);
  const dry={...now.base,waterLevel:()=>null};old.setField(dry);now.setField(dry);
  assert.deepEqual(puntCandidates(now.rt),legacyCandidates(old.rt));
  assert.ok(previewPunt(now.rt,spec));

  // A stale pre-sync field admits home probes but has no supporting bank on the long sides.
  // The fallback still enumerates that original surface, while route preview must see the newly dry field.
  const shelf=ground(pond,8);
  const quay:Ground={...shelf,landforms:[...shelf.landforms,{id:'quay',kind:'carve',area:[[10,5],[15,5],[15,11],[10,11]],bed:-1.4,edge:.5}]};
  const before=fixture(quay),after=fixture(quay);
  for(const f of [before,after])f.spatial.sync=()=>{f.setField({...f.base,waterLevel:()=>null});return true;};
  assert.deepEqual(legacyCandidates(before.rt),[]);assert.deepEqual(puntCandidates(after.rt),[]);
});
