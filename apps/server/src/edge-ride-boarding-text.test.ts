// D1 (playtest 121122 zed-019): "You are in the punt" was said at accept while the body still walked on the grass and
// rowing began ~10 s later. A rider is told it is in only once its body is seated; while it boards, nothing claims it is in.
import test from 'node:test';
import assert from 'node:assert/strict';
import {rideKind,type RideState} from './edge/comms/objects/ride.ts';

const view=(riders:{seat:string;entityId:string;soulId:string;name:string;phase:string}[])=>({id:'p1',def:'rowing-punt',capacity:2,phase:'boarding',holding:false,flights:0,seatsFree:2-riders.length,route:{id:'p1-loop',seconds:60},door:[0,0],departsInSeconds:30,waitSeconds:30,riders});
const ctx=(v:unknown)=>({tick:0,now:0,nameOf:()=>'x',carrier:()=>v}) as never;
const texts=(r:{events?:{text:string}[]}|null|undefined)=>(r?.events??[]).map(e=>e.text);

test('the punt says "You are in the punt" when the rider is seated, not while it boards',()=>{
 const s0=rideKind.initial({carrier:'p1'},ctx(view([]))) as RideState;
 const boarding=rideKind.advance!(s0,ctx(view([{seat:'a',entityId:'e1',soulId:'s1',name:'Zed',phase:'boarding'}])));
 assert.ok(boarding,'the state changed');assert.deepEqual(texts(boarding).filter((t:string)=>/You are in|climbs into/.test(t)),[]);
 const seated=rideKind.advance!(boarding!.state as RideState,ctx(view([{seat:'a',entityId:'e1',soulId:'s1',name:'Zed',phase:'seated'}])));
 assert.ok(texts(seated).some((t:string)=>/^You are in the punt\. It departs in about 30 seconds/.test(t)),JSON.stringify(texts(seated)));
 // already seated: nothing is said again
 assert.equal(rideKind.advance!(seated!.state as RideState,ctx(view([{seat:'a',entityId:'e1',soulId:'s1',name:'Zed',phase:'seated'}]))),null);
});
