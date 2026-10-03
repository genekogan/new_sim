import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Db} from './db.ts';
import {TakeArchive,type ArchiveStore} from './take-archive.ts';

function fixture(){
 const db=new Db(':memory:'),objects=new Map<string,Uint8Array>();let gets=0;
 const store:ArchiveStore={async put(k,b){objects.set(k,b);},async get(k){gets++;const b=objects.get(k);if(!b)throw Error('Missing object');return b;}};
 const archive=new TakeArchive(db,'w',store,'test');
 const fill=(segment:number)=>{for(let t=segment*6000;t<(segment+1)*6000;t+=20)db.saveTake('w',{fromTick:t,toTick:t+20,take:{frames:[{tick:t,public:'pose'}]}});};
 return {db,objects,store,archive,fill,gets:()=>gets};
}
test('verified archives round trip and paginate after local pruning',async()=>{
 const f=fixture();try{
  f.fill(0);f.fill(1);f.fill(2);f.fill(300);
  for(let i=0;i<3;i++)assert.equal(await f.archive.archiveOne(1806000),true);
  assert.equal((f.db.db.prepare('SELECT COUNT(*) AS n FROM take_chunks WHERE to_tick<=18000').get() as {n:number}).n,0);
  const ticks:number[]=[];let from=0;
  for(let i=0;i<10;i++){const p=await f.archive.read(from,18000,120);ticks.push(...p.chunks.map(c=>c.toTick));if(p.next===null)break;assert.ok(p.next>from);from=p.next;}
  assert.equal(ticks.length,900);assert.equal(new Set(ticks).size,900);assert.equal(ticks[0],20);assert.equal(ticks.at(-1),18000);
  const before=f.gets();const recent=await f.archive.read(1800000,1806000,120);assert.equal(recent.chunks.length,120);assert.equal(f.gets(),before);
 }finally{f.db.close();}
});
test('failed upload never creates a receipt or removes local replay',async()=>{
 const f=fixture();try{f.fill(0);const a=new TakeArchive(f.db,'w',{...f.store,async put(){throw Error('offline');}});await assert.rejects(a.archiveOne(1806000),/offline/);assert.equal(f.db.takes('w',0,6000,1000).chunks.length,300);assert.equal((f.db.db.prepare('SELECT COUNT(*) AS n FROM take_archives').get() as {n:number}).n,0);}finally{f.db.close();}
});
test('absent R2 keeps all local history; checksum damage is rejected',async()=>{
 const f=fixture();try{f.fill(0);const offline=new TakeArchive(f.db,'w',null);assert.equal(await offline.archiveOne(1806000),false);assert.equal((await offline.read(0,6000,120)).chunks.length,120);await f.archive.archiveOne(1806000);const key=[...f.objects.keys()][0];f.objects.set(key,new Uint8Array([1,2,3]));await assert.rejects(f.archive.read(0,6000,120),/checksum/);}finally{f.db.close();}
});
test('archives are world isolated and recent replay needs no network',async()=>{
 const f=fixture();try{f.fill(0);f.db.saveTake('other',{fromTick:0,toTick:20,take:{secret:'another world'}});await f.archive.archiveOne(6000);f.store.get=async()=>{throw Error('offline');};const p=await f.archive.read(0,6000,120);assert.equal(p.chunks.length,120);assert.ok(p.chunks.every(c=>(c.take as {frames:unknown}).frames));assert.equal(f.db.takes('other',0,20,1).chunks.length,1);}finally{f.db.close();}
});
test('staging and production archives cannot share object keys',async()=>{
 const f=fixture();try{f.fill(0);await f.archive.archiveOne(6000);f.db.db.exec('DELETE FROM take_archives');const staged=new TakeArchive(f.db,'w',f.store,'test/staging');await staged.archiveOne(6000);assert.equal(f.objects.size,2);assert.ok(f.objects.has('test/w/0.json.gz'));assert.ok(f.objects.has('test/staging/w/0.json.gz'));}finally{f.db.close();}
});
