// 1.9.8 (user report via the coordinator): a dashboard Soul mind on eden-2026 died at startup with "invalid place hierarchy":
// the world has 1,505 places and 1.9.7 refused any catalogue over 1,000. Real-size worlds build their hierarchy; one the client
// cannot use only turns arrivals off, and boot/wake go on.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {placeHierarchy,currentPlaceAncestors,PLACE_LIMIT} from './client-place-arrivals.mjs';
import {openClientPerception} from './client-perception.mjs';

/** world -> regions -> buildings -> rooms, n places in all (eden-2026 shape: rooms are a building's children) */
function world(n){
 const places=[{id:'eden',name:'Eden',parent:null,walkable:false,kind:'world'}];
 for(let i=1;places.length<n;i++){
  const region='region-'+i;places.push({id:region,name:'Region '+i,parent:'eden',walkable:true,kind:'outdoor'});
  for(let b=1;b<=6&&places.length<n;b++){const bldg=region+'-bldg-'+b;places.push({id:bldg,name:'Building '+b,parent:region,walkable:true,kind:'building'});
   for(let r=1;r<=4&&places.length<n;r++)places.push({id:'int-'+bldg+'.room-'+r,name:'Room '+r,parent:bldg,walkable:true,kind:'room'});}
 }
 return places;
}
const makeRoot=t=>{const dir=mkdtempSync(join(realpathSync(tmpdir()),'eden-large-places-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;};
const mockWorld=(places,place)=>async path=>path==='/v1/edge/boot'?{status:200,data:{apiContract:'eden-edge/1.1',staticEtag:'large-'+places.length,static:{places:places.filter(p=>p.walkable)},fullMap:{url:'/v1/edge/boot/places',etag:'large-'+places.length}}}
 :path==='/v1/edge/boot/places'?{status:200,data:{places}}:{status:200,data:{tick:100,me:{place,pos:[0,0]},doHere:[],exits:[]}};

for(const n of [1505,5000])test(n+'-place hierarchy builds, and a mind boots and counts the room\'s building and region as visited',async t=>{
 const places=world(n);assert.equal(places.length,n);
 const rows=placeHierarchy(places);assert.equal(Object.keys(rows).length,n);
 const room=places.at(-1).id,bldg=places.at(-1).parent;assert.deepEqual(currentPlaceAncestors(room,rows),[room,bldg,rows[bldg],'eden']);
 const p=openClientPerception(makeRoot(t),{call:mockWorld(places,room),scope:'synthetic'});await p.boot();await p.wake();
 assert.equal(p.coverage().visited,3,'room + building + region (the world itself is not a walkable visit)');
});

test('a hierarchy the client cannot use (over the limit, or a cycle) turns arrivals off; boot and wake never throw',async t=>{
 assert.ok(PLACE_LIMIT>=100_000);
 const over=Array.from({length:PLACE_LIMIT+1},(_,i)=>({id:'p-'+i,name:'P'+i,parent:null,walkable:true,kind:'outdoor'}));
 assert.throws(()=>placeHierarchy(over),/hierarchy/);
 const cycle=[...world(40),{id:'loop-a',name:'A',parent:'loop-b',walkable:true,kind:'outdoor'},{id:'loop-b',name:'B',parent:'loop-a',walkable:true,kind:'outdoor'}];
 for(const [places,place] of [[over,'p-5'],[cycle,'loop-a']]){
  const warned=[],warn=console.error;console.error=(...a)=>warned.push(a.join(' '));
  try{const p=openClientPerception(makeRoot(t),{call:mockWorld(places,place),scope:'synthetic'});await p.boot();const w=await p.wake();assert.equal(w.frame.me.place,place);assert.equal(p.coverage().visited,1,'only the place itself');}
  finally{console.error=warn;}
  assert.ok(warned.some(l=>/place arrivals off/.test(l)),'says so once, on stderr');
 }
});
