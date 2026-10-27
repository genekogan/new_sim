import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvedParts,knownPart} from './resolved-parts.ts';
test('discovery is bounded, ranks queried parts, hides secret anchors and never manufactures actions',()=>{
 const parts=Array.from({length:12},(_,i)=>({id:`p${i}`,title:i===11?'Reading nook':`View ${i}`}));
 parts.unshift({id:'secret',title:'Private room',target:{ref:'private'}} as never);
 const place={id:'public',ref:'public',parts},hidden={id:'hidden',ref:'private'};
 const L={places:{byId:new Map([['public',place],['hidden',hidden]])},knowledge:{knows:(_:string,id:string)=>id!=='hidden'},coreA:{binds:()=>({caps:[],plans:new Map()})},resolveOnDemand:()=>assert.fail('descriptive parts cannot be actions')} as any;
 const result=resolvedParts(L,{soulId:'s'} as any,'walk:public','reading nook') as any;
 assert.equal(result.parts.length,8);assert.equal(result.parts[0].id,'p11');assert.ok(result.parts.every((p:any)=>p.id!=='secret'&&!p.affordances));
 assert.deepEqual(resolvedParts(L,{soulId:'s'} as any,'walk:missing'),{});
});

test('privacy follows reference segments without confusing similar prefixes',()=>{
 const owner={id:'public',ref:'public'},hidden={id:'hidden',ref:'secret-room'};
 const L={places:{byId:new Map([['public',owner],['hidden',hidden]])},knowledge:{knows:(_:string,id:string)=>id!=='hidden'}} as any;
 assert.equal(knownPart(L,{soulId:'s'} as any,owner as any,{target:{ref:'secret-room/bench'}} as any),false);
 assert.equal(knownPart(L,{soulId:'s'} as any,owner as any,{target:{ref:'secret-roommate/bench'}} as any),true);
});
