// RECOFF: take recordings (take_chunks) are a pose-keyframe cache, off by default.
// The real main.ts on the Toy engine: with TAKES_PERSIST unset no take_chunks are written,
// the live buffer still feeds /v1/take, /v1/takes answers from that buffer (older moments empty),
// and the render scene a live take references is still stored for /v1/scenes/:hash.
import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';import {DatabaseSync} from 'node:sqlite';

async function run(t:import('node:test').TestContext,port:number,extra:Record<string,string>){
 const data=mkdtempSync(join(tmpdir(),'takes-persist-')),base=`http://127.0.0.1:${port}`,logs:string[]=[];
 const child=spawn(process.execPath,[new URL('./main.ts',import.meta.url).pathname],{env:{PATH:process.env.PATH,DATA_DIR:data,WORLD_ID:'takes-persist-fixture',WORLD_KEY:'toy',ENGINE:'toy',SEED_NATIVES:'0',BRAIN_MODE:'fake',BRAIN_BUDGET_USD_PER_DAY:'0',PORT:String(port),HOST:'127.0.0.1',PUBLIC_URL:base,...extra},stdio:['ignore','pipe','pipe']});
 child.stdout!.on('data',d=>logs.push(String(d)));child.stderr!.on('data',d=>logs.push(String(d)));
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');for(let i=0;i<100&&child.exitCode===null&&child.signalCode===null;i++)await delay(20);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}rmSync(data,{recursive:true,force:true});});
 let up=false;for(let i=0;i<300&&!up;i++){if(child.exitCode!==null)throw Error('startup failed: '+logs.join(''));try{up=(await fetch(base+'/healthz')).ok;}catch{}if(!up)await delay(20);}
 assert.ok(up,logs.join(''));
 let live:{chunks:{fromTick:number;toTick:number;take:{renderSceneRef?:{hash:string}}}[]}={chunks:[]};
 for(let i=0;i<100&&live.chunks.length<2;i++){await delay(100);live=await(await fetch(base+'/v1/take')).json() as typeof live;}
 await delay(300);
 const db=new DatabaseSync(join(data,'sim.db'),{readOnly:true});
 const count=(sql:string)=>(db.prepare(sql).get() as {n:number}).n;
 const out={base,live,takeRows:count('SELECT COUNT(*) AS n FROM take_chunks'),scenes:count('SELECT COUNT(*) AS n FROM render_scene_captures')};
 db.close();return out;
}

test('recordings off by default: no take_chunks, live buffer and scene captures still served',async t=>{
 const r=await run(t,5812,{});
 assert.ok(r.live.chunks.length>=2,'the in-memory live buffer still feeds /v1/take');
 assert.equal(r.takeRows,0,'no take_chunks are written');
 assert.ok(r.scenes>=1,'the live take render scene is still stored');
 const hash=r.live.chunks[0].take.renderSceneRef!.hash;
 assert.equal((await fetch(`${r.base}/v1/scenes/${hash}`)).status,200);
 const old=await(await fetch(`${r.base}/v1/takes?from=0&to=${r.live.chunks[0].fromTick}`)).json() as {chunks:unknown[];next:unknown};
 assert.deepEqual(old,{...old,chunks:[],next:null},'a moment older than the live buffer answers empty, not an error');
 const recent=await(await fetch(`${r.base}/v1/takes?from=${r.live.chunks[0].fromTick}`)).json() as {chunks:unknown[]};
 assert.ok(recent.chunks.length>=1,'a recent moment comes from the live buffer');
});

test('TAKES_PERSIST=1 keeps the recordings',async t=>{
 const r=await run(t,5813,{TAKES_PERSIST:'1'});
 assert.ok(r.takeRows>=2,'take_chunks are written when the flag is on');
});
