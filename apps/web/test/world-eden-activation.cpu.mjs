import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {edenExpansionCapture} from '../src/WorldEdenActivation.ts';
// Input: a retained core-east-lecture scene.json (not in the repo; eden-lecture-native.test.ts exports one with CORE_LECTURE_EXPORT_DIR).
if(!process.env.CORE_LECTURE_SCENE){console.log('skip: set CORE_LECTURE_SCENE to a core-east-lecture scene.json');process.exit(0);}
const raw=JSON.parse(readFileSync(process.env.CORE_LECTURE_SCENE,'utf8'));
// Pure consumer gate only. The mounted caller's WorldSceneHistory verifies the
// full capture hash/selected world before supplying these detached values.
const info={scene:raw.scene,ground:raw.ground,shore:{metadata:raw.shore,profile:'connected-commons-shore/1'}};
const ref={contract:'render-scene-ref/1',hash:'e188821345ef5bc4d8b639a584e472c0ff8f71aa60034c9880b2338f2f8226ec'};
for(const id of ['eden-local-lifecycle','stage-eden','production-eden']){
 const capture={contract:'render-scene-capture/1',worldId:id,ref};
 assert.equal(edenExpansionCapture(true,id,info,capture,false),true);
 assert.equal(edenExpansionCapture(false,id,info,capture,false),false);
 assert.equal(edenExpansionCapture(true,id,info,capture,true),false);
 assert.equal(edenExpansionCapture(true,'foreign-world',info,capture,false),false);
 assert.equal(edenExpansionCapture(true,id,info,null,false),false);
}
for(const mutate of [x=>{x.shore.metadata.physicalBase.campus='unrelated';},x=>{x.scene.surfaces=x.scene.surfaces.filter(s=>s.id!=='eden-east-ground');},x=>{x.scene.surfaces.find(s=>s.id==='eden-north-ground').obb.half[0]+=.1;},x=>{x.ground=undefined;},x=>{x.shore.profile=undefined;}]){
 const changed=structuredClone(info);mutate(changed);assert.equal(edenExpansionCapture(true,'stage-eden',changed,{contract:'render-scene-capture/1',worldId:'stage-eden',ref},false),false);
}
console.log('PASS: manifest request/selected capture/actual admitted surfaces; arbitrary qualified IDs, history/foreign/unbound/physical mismatch refusals. Not production or capture-codec proof.');
