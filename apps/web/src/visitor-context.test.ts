import test from 'node:test';import assert from 'node:assert/strict';
import {feedbackMoment,awayHasUpdates,type AwayReport} from './visitor-context.ts';
import {createWorldViewerHandle} from './WorldViewer.ts';
test('feedback captures detached public context at the observed frame, excluding private state',()=>{
 const position:[number,number,number]=[1,2,3],target:[number,number,number]=[4,5,6];
 const h={feedbackContext:()=>({camera:{position,target,fov:50},placeId:'region:garden'}),privateJournal:'PRIVATE'} as never;
 const state={selection:{soulId:'s_own',entityId:'h_own'},shownTick:123,room:{id:'other'},privateConversation:'PRIVATE'} as never;
 const moment=feedbackMoment(h,state,new Date('2026-10-15T12:00:00Z'));position[0]=99;target[0]=99;
 assert.deepEqual(moment,{residentId:'s_own',placeId:'region:garden',camera:{position:[1,2,3],target:[4,5,6],fov:50},tick:123,clientTime:'2026-10-15T12:00:00.000Z'});
 assert.doesNotMatch(JSON.stringify(moment),/PRIVATE/);
});
test('unavailable camera stays explicit and selected entity remains useful context',()=>{
 const moment=feedbackMoment({feedbackContext:()=>({camera:{position:[NaN,0,0]},placeId:null})} as never,{selection:{soulId:null,entityId:'bench'},shownTick:null} as never);
 assert.equal(moment.camera,null);assert.equal(moment.placeId,'bench');assert.equal(moment.tick,null);assert.equal(feedbackMoment(null,null).camera,null);
});
test('viewer feedback reads current public camera port on demand',()=>{
 let x=2;const handle=createWorldViewerHandle(()=>({feedbackContext:()=>({camera:{position:[x,0,0],target:[0,0,0],fov:50},placeId:null})}) as never);
 assert.equal(handle.feedbackContext?.()?.camera.position[0],2);x=4;assert.equal(handle.feedbackContext?.()?.camera.position[0],4);
});
test('empty and factual return windows distinguish updates without creating a story',()=>{
 const report:AwayReport={worldId:'world',since:1,through:2,firstVisit:false,residents:[],world:{owned:true,changes:[],incomplete:false},incomplete:false};
 assert.equal(awayHasUpdates(report),false);report.world.changes.push({id:1,at:2,kind:'weather',text:'Weather changed to cloudy.'});assert.equal(awayHasUpdates(report),true);
 report.world.changes=[];report.residents=[{id:'s',name:'Sam',events:[],places:[],conversations:1,incomplete:false}];assert.equal(awayHasUpdates(report),true);
});
