// Uploaded-body URLs on launcher worlds (/worlds): the admission check once allowed only the four fixed slugs, so a
// Soul wearing an uploaded ceramic body on /w/<launcher-slug> failed the initial gate for every visitor
// ("The world could not be prepared"). Kept separate from world-body-games.test.ts, which Node 26 cannot strip.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {admittedBodyUrl} from '../../../mars/viewer/app/engine-view/recorded-body.ts';
import {FloaterView} from '../../../mars/viewer/app/engine-view/floaters.ts';

const asset='/v1/edge/body/assets/body_'+'a'.repeat(64)+'.glb';
const ceramic={family:'floater' as const,type:'ceramic' as const,model:'body_'+'a'.repeat(64),radius:.35,hoverHeight:1.45};

test('launcher-slug worlds admit their own uploaded body URLs; unsafe slugs stay refused',()=>{
 assert.equal(admittedBodyUrl('/w/modbody'+asset),'/w/modbody'+asset);
 assert.equal(admittedBodyUrl('/w/meetup-hollow-2'+asset,'/w/eden'),'/w/meetup-hollow-2'+asset);
 assert.equal(admittedBodyUrl(asset,'/w/modbody'),'/w/modbody'+asset);
 for(const fixed of ['eden','mars','littlemartians','toy'])assert.equal(admittedBodyUrl('/w/'+fixed+asset),'/w/'+fixed+asset);
 for(const unsafe of ['/w/Mod'+asset,'/w/2bad'+asset,'/w/a.b'+asset,'/w/'+'a'.repeat(33)+asset,'/w/x/y'+asset,'//x.example'+asset,'/w/'+asset,'/w/x'+asset+'?r=1'])assert.equal(admittedBodyUrl(unsafe),null,unsafe);
});

test('a ceramic body uploaded on a launcher world loads for the initial gate instead of failing it',async()=>{
 const requests:string[]=[],root=new THREE.Group();
 const loader={loadAsync:async(url:string)=>{requests.push(url);return {scene:new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(1,2,1),new THREE.MeshBasicMaterial()))};}};
 const v=new FloaterView(root,{baseUrl:'/world-assets/littlemartians/characters',loader:loader as never});
 v.sync(new Map([['a',{...ceramic,modelUrl:'/w/modbody'+asset}]]));
 await v.readyInitial(['a']);
 assert.deepEqual(requests,['/w/modbody'+asset]);assert.ok(v.object('a'));v.dispose();
});
