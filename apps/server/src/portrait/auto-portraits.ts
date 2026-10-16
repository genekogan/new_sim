// Automatic profile portraits (resident looks v2): every live Soul wearing a core/humanoid@2 look gets a straight-on
// head-and-shoulders portrait, redrawn whenever its look changes, rendered on the server's CPU by a child process
// (render-worker.mjs; no browser, so eden2 needs no Chrome). It is the Soul's profile photo unless the owner uploaded
// one: a custom photo always wins, and clearing it (DELETE /v1/souls/:id/photo) goes back to the automatic portrait.
// Portraits are derived data, not world history: they live in their own table (one row per Soul), are never journaled,
// and a world copy without them simply draws them again.
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {existsSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {validateProfilePNG} from '../profile-png.ts';
import {LOOK_MODEL} from '../../../web/src/humanoid/look.ts';
import type {WorldHost} from '../world.ts';

/** Bumped when the renderer's framing or light changes (apps/web/src/humanoid/portrait.ts), so portraits are redrawn. */
export const AUTO_PORTRAIT_STYLE='portrait-cpu/1';
const WORKER=fileURLToPath(new URL('./render-worker.mjs',import.meta.url));
const KIT=fileURLToPath(new URL('../../../../mars/viewer/public/modular/humanoid/kit.json',import.meta.url));
export type AutoPortraitPhoto={hash:string;mime:'image/png';width:number;height:number;bytes:number};
type Job={soulId:string;key:string;look:unknown};

export function ensureAutoPortraitSchema(host:WorldHost){host.db.db.exec(`CREATE TABLE IF NOT EXISTS soul_auto_portraits_v1(world_id TEXT NOT NULL,soul_id TEXT NOT NULL,look_key TEXT NOT NULL,hash TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,image BLOB NOT NULL,PRIMARY KEY(world_id,soul_id)) WITHOUT ROWID;`);}

export class AutoPortraits{
 readonly host:WorldHost;readonly enabled:boolean;
 private queue=new Map<string,Job>();private failed=new Map<string,string>();private busy=false;
 private child:ChildProcessWithoutNullStreams|null=null;private ready:Promise<void>|null=null;private pending=new Map<string,(r:{ok:boolean;png?:string;error?:string})=>void>();
 private idle:ReturnType<typeof setTimeout>|null=null;private timer:ReturnType<typeof setInterval>|null=null;private seq=0;private crashes=0;private disposed=false;
 /** Called after a portrait is stored (tests and the hub use it). */
 onStored:(soulId:string)=>void=()=>{};
 constructor(host:WorldHost,opts:{enabled?:boolean;sweepMs?:number}={}){
  this.host=host;this.enabled=(opts.enabled??process.env.SIM_AUTO_PORTRAITS!=='0')&&existsSync(KIT);ensureAutoPortraitSchema(host);
  if(!this.enabled)return;
  host.autoProfilePhoto=id=>this.photo(id);
  // every body assignment (owner, agent, god births, travel, the legacy-look migration) asks for a redraw once applied
  host.listeners.push({onApplied:e=>{if(e.kind==='body-assignment-v1'&&typeof (e.payload as {soulId?:unknown})?.soulId==='string'){const id=(e.payload as {soulId:string}).soulId;setTimeout(()=>this.nudge(id),0).unref?.();}}});
  const sweepMs=opts.sweepMs??30000;
  // the first sweep waits 5-30 s at random, so the worlds of one host restarting together don't all render at once
  // (a renderer holds ~300 MB while busy and exits 10 s after its last portrait)
  if(sweepMs>0){setTimeout(()=>this.sweep(),Math.min(sweepMs,5000+Math.floor(Math.random()*55000))).unref();this.timer=setInterval(()=>this.sweep(),sweepMs);this.timer.unref();}
 }
 /** The look a Soul's current body draws with, or null (no body, a legacy unparameterised body, a creature, an upload). */
 private job(soulId:string):Job|null{
  const row=this.host.db.soul(soulId);if(!row||row.retired_at!==null||row.world_id!==this.host.worldId)return null;
  const body=this.host.engine.world.entities[row.entity_id]?.body as {family?:string;model?:string;params?:unknown}|null|undefined;
  if(!body||body.family!=='humanoid'||typeof body.model!=='string'||!LOOK_MODEL.test(body.model)||!body.params)return null;
  return {soulId,key:`${AUTO_PORTRAIT_STYLE}:${body.model}`,look:body.params};
 }
 private stored(soulId:string){return this.host.db.db.prepare('SELECT look_key,hash,width,height,length(image) bytes FROM soul_auto_portraits_v1 WHERE world_id=? AND soul_id=?').get(this.host.worldId,soulId) as {look_key:string;hash:string;width:number;height:number;bytes:number}|undefined;}
 /** The stored automatic portrait for a Soul whose body is a humanoid look (a portrait being redrawn stays until replaced). */
 photo(soulId:string):AutoPortraitPhoto|null{
  if(!this.job(soulId))return null;const s=this.stored(soulId);return s?{hash:s.hash,mime:'image/png',width:s.width,height:s.height,bytes:s.bytes}:null;
 }
 /** Is the stored portrait the current look's? */
 current(soulId:string){const j=this.job(soulId),s=this.stored(soulId);return !!j&&!!s&&s.look_key===j.key;}
 bytes(soulId:string,hash:string){return (this.host.db.db.prepare('SELECT image FROM soul_auto_portraits_v1 WHERE world_id=? AND soul_id=? AND hash=?').get(this.host.worldId,soulId,hash) as {image:Uint8Array}|undefined)?.image??null;}
 /** Ask for a Soul's portrait to be (re)drawn if its look changed. */
 nudge(soulId:string){
  if(!this.enabled||this.disposed||!this.host.db.db.isOpen)return;const j=this.job(soulId);if(!j||this.stored(soulId)?.look_key===j.key||this.failed.get(soulId)===j.key)return;
  this.queue.set(soulId,j);void this.pump();
 }
 /** Every live Soul of this world whose portrait is missing or stale. */
 sweep(){if(!this.enabled||this.disposed)return;for(const m of this.host.minds.values())this.nudge(m.soulId);}
 /** Resolves when the queue is empty (tests). */
 async drain(timeoutMs=30000){const end=Date.now()+timeoutMs;while((this.busy||this.queue.size)&&Date.now()<end)await new Promise(r=>setTimeout(r,20));}
 private async pump(){
  if(this.busy)return;this.busy=true;
  try{
   while(this.queue.size){
    const [soulId,j]=this.queue.entries().next().value as [string,Job];this.queue.delete(soulId);
    let r:{ok:boolean;png?:string;error?:string};
    try{r=await this.render(j.look);}catch(e){r={ok:false,error:e instanceof Error?e.message:String(e)};}
    if(this.disposed||!this.host.db.db.isOpen)return;
    const now=this.job(soulId);if(!now||now.key!==j.key){if(now)this.queue.set(soulId,now);continue;} // the look changed meanwhile
    if(!r.ok||!r.png){this.failed.set(soulId,j.key);console.warn('[portrait] render failed',soulId,(r.error??'').slice(0,200));continue;}
    let png:ReturnType<typeof validateProfilePNG>;
    try{png=validateProfilePNG('data:image/png;base64,'+r.png);}catch{this.failed.set(soulId,j.key);console.warn('[portrait] renderer produced an invalid PNG',soulId);continue;}
    this.host.db.db.prepare('INSERT INTO soul_auto_portraits_v1(world_id,soul_id,look_key,hash,width,height,image) VALUES(?,?,?,?,?,?,?) ON CONFLICT(world_id,soul_id) DO UPDATE SET look_key=excluded.look_key,hash=excluded.hash,width=excluded.width,height=excluded.height,image=excluded.image')
     .run(this.host.worldId,soulId,j.key,png.photo.hash,png.photo.width,png.photo.height,png.image);
    this.failed.delete(soulId);this.host.markSoulDirty(soulId);this.onStored(soulId);
   }
  }finally{this.busy=false;this.armIdle();}
 }
 private armIdle(){if(this.idle)clearTimeout(this.idle);this.idle=setTimeout(()=>this.stopWorker(),10000);this.idle.unref();}
 private stopWorker(){const c=this.child;this.child=null;this.ready=null;if(c){c.stdin.end();setTimeout(()=>{if(c.exitCode===null)c.kill();},5000).unref();}}
 private start(){
  if(this.crashes>=3)throw Error('portrait renderer disabled after repeated crashes');
  const child=spawn(process.execPath,[WORKER],{stdio:['pipe','pipe','pipe'],env:{...process.env,NODE_OPTIONS:''}});this.child=child;
  child.unref();(child.stdout as unknown as {unref?:()=>void}).unref?.();(child.stderr as unknown as {unref?:()=>void}).unref?.();(child.stdin as unknown as {unref?:()=>void}).unref?.();
  let err='';child.stderr.on('data',d=>{err=(err+d).slice(-2000);});
  this.ready=new Promise<void>((resolve,reject)=>{
   const rl=createInterface({input:child.stdout});
   rl.on('line',line=>{let m:{ready?:boolean;id?:string;ok?:boolean;png?:string;error?:string};try{m=JSON.parse(line);}catch{return;}
    if(m.ready){resolve();return;}const done=m.id?this.pending.get(m.id):undefined;if(done){this.pending.delete(m.id!);done({ok:!!m.ok,png:m.png,error:m.error});}});
   child.on('exit',code=>{if(this.child===child){this.child=null;this.ready=null;}if(code)this.crashes++;reject(Error('portrait renderer exited '+code+' '+err.slice(-300)));
    for(const [id,done] of this.pending){this.pending.delete(id);done({ok:false,error:'renderer exited '+code});}});
  });
  this.ready.catch(()=>{});return this.ready;
 }
 private async render(look:unknown){
  if(this.idle)clearTimeout(this.idle);
  if(!this.child||!this.ready)await this.start();else await this.ready;
  const id='p'+(++this.seq);
  return new Promise<{ok:boolean;png?:string;error?:string}>(resolve=>{
   const t=setTimeout(()=>{this.pending.delete(id);resolve({ok:false,error:'render timeout'});},30000);t.unref();
   this.pending.set(id,r=>{clearTimeout(t);resolve(r);});this.child!.stdin.write(JSON.stringify({id,look})+'\n');
  });
 }
 dispose(){this.disposed=true;if(this.timer)clearInterval(this.timer);if(this.idle)clearTimeout(this.idle);this.queue.clear();this.stopWorker();}
}
