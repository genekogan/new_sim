import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {recordedBody,admittedBodyUrl} from '../../../mars/viewer/app/engine-view/recorded-body.ts';
import {recordedGame,recordedGameObjects} from '../../../mars/viewer/app/engine-view/recorded-games.ts';
import {activityFrame,propFor,makeProp} from '../../../mars/viewer/app/engine-view/activity-poses.ts';
import {validateBodyRig} from '../../../mars/viewer/app/engine-view/body-rig.ts';
import {templateFromGltf} from '../../../mars/viewer/app/engine-view/people.ts';
import {FloaterView} from '../../../mars/viewer/app/engine-view/floaters.ts';
import {WorldGames} from '../src/WorldGames.ts';
import {buildingUrl,parseSceneInfo,WorldGeometry} from '../src/WorldGeometry.ts';
import {sampleTake,type SampledEntity} from '../../../mars/viewer/engine/take/replay.ts';
import type {Take} from '../../../mars/viewer/engine/take/types.ts';

const asset='/v1/edge/body/assets/body_'+ 'a'.repeat(64)+'.glb';
const ceramic={family:'floater' as const,type:'ceramic' as const,model:'verdelis',radius:.5,hoverHeight:1};
const entity=(p:[number,number,number],game?:unknown):SampledEntity=>({p,yaw:0,pitch:0,roll:0,state:game?{game}:{}});
const game={kind:'frisbee' as const,group:'court',players:['a','b'],from:'a',to:'b',throwTick:100,landTick:130};

test('take body changes retain pre-swap shape and explicit legacy reset while scrubbing',()=>{
 const take={startTick:1000,ticks:30,dt:.05,tracks:{a:[[0,0,5000,0,0],[30,0,5000,0,0]]},changes:[[0,'a','present',true],[0,'a','body',null],[10,'a','body',ceramic],[20,'a','body',null]],finalState:{entities:{a:{body:ceramic}}}} as unknown as Take;
 const at=(tick:number)=>recordedBody(ceramic,sampleTake(take,tick*.05).entities.a.state);
 assert.equal(at(5),null);assert.deepEqual(at(15),ceramic);assert.equal(at(25),null);assert.deepEqual(at(15),ceramic);
 assert.deepEqual(recordedBody(ceramic,{}),ceramic);
});

test('uploaded body requests stay at admitted same-origin hashes, preserving per-world route',()=>{
 assert.equal(admittedBodyUrl(asset,'/w/mars'),'/w/mars'+asset);
 assert.equal(admittedBodyUrl('/w/littlemartians'+asset,'/w/eden'),'/w/littlemartians'+asset);
 for(const unsafe of ['https://x.example'+asset,asset+'?redirect=http://x',asset.replace('body_','../body_'),'/v1/edge/body/assets/not-admitted.glb'])assert.equal(admittedBodyUrl(unsafe),null);
});

test('custom floater replaces a preset mid-take, loads world prefix, and reset removes stale model',async()=>{
 const requests:string[]=[],root=new THREE.Group();
 const loader={loadAsync:async(url:string)=>{requests.push(url);return {scene:new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(1,2,1),new THREE.MeshBasicMaterial()))};}};
 const v=new FloaterView(root,{baseUrl:'/world-assets/littlemartians/characters',loader:loader as never});
 v.sync(new Map([['a',ceramic]]));await v.ready();const before=v.object('a');
 v.sync(new Map([['a',{...ceramic,model:'body_'+ 'a'.repeat(64),modelUrl:'/w/mars'+asset}]]));await v.ready();
 assert.notEqual(v.object('a'),before);assert.ok(requests.includes('/w/mars'+asset));
 v.update({a:entity([3,5,7])},100,.05);assert.ok(v.object('a')!.position.y>=6-.2);
 v.sync(new Map());assert.equal(v.object('a'),undefined);v.dispose();assert.equal(root.children.length,0);
});

test('one replay-stable flight is drawn per court and follows elevated players',()=>{
 const entities={a:entity([0,5,0],game),b:entity([10,5,0],game)};
 assert.deepEqual(recordedGameObjects(entities,99),[]);
 const start=recordedGameObjects(entities,100),middle=recordedGameObjects(entities,115);
 assert.equal(start.length,1);assert.equal(start[0].p[1],6.05);assert.equal(middle.length,1);assert.equal(middle[0].p[0],5.43);assert.ok(middle[0].p[1]>6.05);
 assert.deepEqual(middle,recordedGameObjects(entities,115));assert.deepEqual(recordedGameObjects(entities,130),[]);
 const draw=new WorldGames();draw.update(entities,115);assert.equal(draw.group.children.length,1);draw.update({a:entity([0,5,0])},116);assert.equal(draw.group.children.length,0);draw.dispose();
});

test('pétanque draws its logged jack and landed boules, then only its current end',()=>{
 const pg={...game,kind:'petanque',to:null,jack:[8,2],at:[8.1,2.1],end:1,boules:[{by:'a',at:[8.2,2]}]};
 const objects=recordedGameObjects({a:entity([0,2,0],pg),b:entity([1,2,0],pg)},115);
 assert.equal(objects.length,3);assert.deepEqual(objects.find(o=>o.kind==='jack')?.p,[8,2.025,2]);assert.equal(objects.filter(o=>o.flight).length,1);
 const next=recordedGameObjects({a:entity([0,2,0],{...pg,end:2,boules:[]})},99);assert.equal(next.length,1);
 for(const invalid of [{...game,landTick:100},{...game,from:'absent'},{...game,at:[NaN,0]},{...game,boules:[{by:'a',at:[1]}]}])assert.equal(recordedGame(invalid),null);
});

test('recorded thrower, catcher and waiters have distinct synchronized arm poses',()=>{
 const opts={game,gameTick:100,gameDt:.05};
 const thrower=activityFrame('play-frisbee','idle',2,'a',{...opts,actorId:'a'}),catcher=activityFrame('play-frisbee','idle',2,'b',{...opts,actorId:'b'});
 assert.notDeepEqual(thrower?.hands,catcher?.hands);
 assert.equal(activityFrame('play-frisbee','idle',2,'a',{...opts,game:{...game,waiting:true},actorId:'a'})?.hands,null);
 assert.equal(propFor('play-petanque','boule'),'boule');assert.ok(makeProp('boule').children.length);
 assert.notDeepEqual(activityFrame('play-music','idle',2,'a',{instrument:'drums'})?.hands,activityFrame('play-music','idle',2,'a',{instrument:'violin'})?.hands);
});

test('isolated world asset roots and scales preserve source model transforms',async()=>{
 assert.equal(buildingUrl('tower','/world-assets/mars_2026'),'/world-assets/mars_2026/buildings/tower.glb');
 assert.equal(buildingUrl('tower','https://bad.example'),null);
 assert.equal(parseSceneInfo({assetRoot:'/world-assets/mars_2026',buildings:[{file:'tower',p:[0,0,0],scale:2}]}).buildings[0].scale,2);
 const g=new WorldGeometry(null,undefined,undefined,undefined,'/world-assets/mars');let url='';
 const model=new THREE.Group();model.scale.setScalar(3);model.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial()));
 assert.deepEqual(await g.addBuildings([{file:'tower',p:[1,4,2],scale:2}],{loadAsync:async(u:string)=>{url=u;return {scene:model};}} as never),[]);
 assert.equal(url,'/world-assets/mars/buildings/tower.glb');assert.deepEqual(model.scale.toArray(),[6,6,6]);assert.deepEqual(model.position.toArray(),[1,4,2]);g.dispose();
});

function rigFixture(){
 const scene=new THREE.Group(),bones=new Map<string,THREE.Bone>();
 const chains=[['Root','Body','Hips','Abdomen','Torso','Chest','Neck','Head'],...['L','R'].flatMap(s=>[['Chest','Shoulder'+s,'UpperArm'+s,'LowerArm'+s,'Wrist'+s,'Middle1'+s,'Middle2'+s],['Body','UpperLeg'+s,'LowerLeg'+s],['Root','Foot'+s]])];
 for(const chain of chains)for(let i=0;i<chain.length;i++){let b=bones.get(chain[i]);if(!b){b=new THREE.Bone();b.name=chain[i];bones.set(b.name,b);if(i)bones.get(chain[i-1])!.add(b);else scene.add(b);}}
 const geo=new THREE.BoxGeometry(1,2,1),count=geo.attributes.position.count;geo.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Uint16Array(count*4),4));const weight=new Float32Array(count*4);for(let i=0;i<count;i++)weight[i*4]=1;geo.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weight,4));
 const mesh=new THREE.SkinnedMesh(geo,new THREE.MeshBasicMaterial());mesh.bind(new THREE.Skeleton([...bones.values()]));scene.add(mesh);
 const animations=['Idle','Walk'].map(n=>new THREE.AnimationClip(n,1,[new THREE.VectorKeyframeTrack('Body.position',[0,1],[0,0,0,0,0,0])]));
 return {scene,animations,bones} as unknown as Parameters<typeof validateBodyRig>[0]&{bones:Map<string,THREE.Bone>};
}
test('custom humanoid consumer refuses a foot parented to a shin or missing clip',()=>{
 const valid=rigFixture();assert.doesNotThrow(()=>validateBodyRig(valid));
 valid.scene.traverse(o=>{if((o as THREE.SkinnedMesh).isSkinnedMesh)assert.equal((o as THREE.SkinnedMesh).boundingBox,null,'fitting measures its played Idle pose');});
 valid.bones.get('LowerLegL')!.add(valid.bones.get('FootL')!);
 assert.throws(()=>validateBodyRig(valid),/Incompatible body chain FootL/);
 const missing=rigFixture();missing.animations.pop();assert.throws(()=>validateBodyRig(missing),/Missing body animation Walk/);
});
test('structurally named but collapsed humanoid limbs cannot become a NaN world rig',()=>{
 const collapsed=rigFixture();assert.doesNotThrow(()=>validateBodyRig(collapsed));
 assert.throws(()=>templateFromGltf('collapsed-owned-body',collapsed),/collapsed|standing height|shoulders/);
});
