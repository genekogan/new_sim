// Physical rendering artifacts only. Models, owner words and journals never enter takes.
import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {S3Client,PutObjectCommand,GetObjectCommand,HeadObjectCommand} from '@aws-sdk/client-s3';
import type {Config} from './config.ts';
import type {Db} from './db.ts';
import type {WorldHost} from './world.ts';

const SEGMENT=6000, KEEP_TICKS=24*72000;
type Chunk={fromTick:number;toTick:number;take:unknown};
type Row={from_tick:number;to_tick:number;body:Uint8Array};
type Archive={world_id:string;segment:number;from_tick:number;to_tick:number;key:string;sha:string};
export interface ArchiveStore {put(key:string,body:Uint8Array,sha:string):Promise<void>;get(key:string):Promise<Uint8Array>}
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
function codec<T>(data:unknown):Promise<T> {
 return new Promise((resolve,reject)=>{const w=new Worker(new URL('./archive-codec.mjs',import.meta.url),{workerData:data});const timeout=setTimeout(()=>{void w.terminate();reject(Error('Take archive worker timed out'));},30000);w.once('message',value=>{clearTimeout(timeout);resolve(value);});w.once('error',e=>{clearTimeout(timeout);reject(e);});w.once('exit',code=>{clearTimeout(timeout);if(code)reject(Error(`Take archive worker exited ${code}`));});});
}
export function r2Store(cfg:Config):ArchiveStore|null {
 const r=cfg.r2;if(!r.account||!r.bucket||!r.access||!r.secret)return null;
 const s3=new S3Client({region:'auto',endpoint:r.endpoint||`https://${r.account}.r2.cloudflarestorage.com`,credentials:{accessKeyId:r.access,secretAccessKey:r.secret},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
 const store:ArchiveStore={async put(key,body,digest){await s3.send(new PutObjectCommand({Bucket:r.bucket,Key:key,Body:body,ContentType:'application/json',ContentEncoding:'gzip',Metadata:{sha256:digest}}),{abortSignal:AbortSignal.timeout(30000)});const head=await s3.send(new HeadObjectCommand({Bucket:r.bucket,Key:key}),{abortSignal:AbortSignal.timeout(30000)});if(head.Metadata?.sha256!==digest||head.ContentLength!==body.byteLength)throw Error('R2 archive receipt mismatch');if(sha(await store.get(key))!==digest)throw Error('R2 archive read-back mismatch');},async get(key){const r=await s3.send(new GetObjectCommand({Bucket:cfg.r2.bucket,Key:key}),{abortSignal:AbortSignal.timeout(30000)});if(!r.Body)throw Error('Empty take archive');const chunks:Uint8Array[]=[];let length=0;for await(const b of r.Body as AsyncIterable<Uint8Array>){length+=b.byteLength;if(length>16*1024*1024)throw Error('Take archive too large');chunks.push(b);}return Buffer.concat(chunks,length);}};
 return store;
}
export class TakeArchive {
 private work=new Set<Promise<unknown>>();
 async settled(){while(this.work.size)await Promise.allSettled([...this.work]);}
 db:Db;worldId:string;store:ArchiveStore|null;prefix:string;
 private busy=false;private timer:NodeJS.Timeout|null=null;
 private cache:{key:string;chunks:Chunk[]}|null=null;
 constructor(db:Db,worldId:string,store:ArchiveStore|null,prefix='sim/takes'){this.db=db;this.worldId=worldId;this.store=store;this.prefix=prefix.replace(/\/+$/,'');}
 start(host:WorldHost){if(!this.store||this.timer)return;this.timer=setInterval(()=>{void this.archiveOne(host.engine.world.tick).catch(()=>console.error('[takes] archive delayed; local replay retained'));},60000);this.timer.unref();}
 stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}
 async archiveOne(tick:number):Promise<boolean>{
  const work=this.archiveOneWork(tick);this.work.add(work);try{return await work;}finally{this.work.delete(work);}
 }
 private async archiveOneWork(tick:number):Promise<boolean>{
  if(!this.store||this.busy)return false;this.busy=true;
  try {
   const complete=Math.floor(tick/SEGMENT)*SEGMENT;
   const group=this.db.db.prepare('SELECT CAST((to_tick-1)/? AS INTEGER) AS segment FROM take_chunks t WHERE world_id=? AND to_tick<=? AND NOT EXISTS(SELECT 1 FROM take_archives a WHERE a.world_id=t.world_id AND a.segment=CAST((t.to_tick-1)/? AS INTEGER)) GROUP BY segment ORDER BY segment LIMIT 1').get(SEGMENT,this.worldId,complete,SEGMENT) as {segment:number}|undefined;
   if(!group)return false;
   const rows=this.db.db.prepare('SELECT from_tick,to_tick,body FROM take_chunks WHERE world_id=? AND to_tick>? AND to_tick<=? ORDER BY to_tick').all(this.worldId,group.segment*SEGMENT,(group.segment+1)*SEGMENT) as Row[];
   if(!rows.length||rows.length>1000)throw Error('Archive segment exceeds bounded chunk count');
   const bytes=await codec<Uint8Array>({mode:'pack',rows,worldId:this.worldId}),digest=sha(bytes),key=`${this.prefix}/${this.worldId}/${group.segment}.json.gz`;
   await this.store.put(key,bytes,digest);
   this.db.db.prepare('INSERT OR IGNORE INTO take_archives VALUES (?,?,?,?,?,?,?,?)').run(this.worldId,group.segment,rows[0].from_tick,rows.at(-1)!.to_tick,key,digest,bytes.byteLength,Date.now());
   // Remove only verified archived chunks older than a full day of replay buffer.
   this.db.db.prepare('DELETE FROM take_chunks WHERE world_id=? AND to_tick<? AND EXISTS(SELECT 1 FROM take_archives a WHERE a.world_id=take_chunks.world_id AND a.segment=CAST((take_chunks.to_tick-1)/? AS INTEGER))').run(this.worldId,tick-KEEP_TICKS,SEGMENT);
   return true;
  }finally{this.busy=false;}
 }
 async read(from:number,to:number,limit:number):Promise<{chunks:Chunk[];next:number|null}>{
  const local=this.db.takes(this.worldId,from,to,limit);
  if(!this.store)return local;
  // Recent replay is served directly, even during an R2 outage. Local chunks
  // are a contiguous tail: pruning removes only complete verified segments.
  const oldest=(this.db.db.prepare('SELECT MIN(from_tick) AS tick FROM take_chunks WHERE world_id=?').get(this.worldId) as {tick:number|null}).tick;
  if(oldest!==null&&from>=oldest)return local;
  const archives=this.db.db.prepare('SELECT * FROM take_archives WHERE world_id=? AND to_tick>? AND from_tick<? ORDER BY to_tick LIMIT 4').all(this.worldId,from,Math.min(to,oldest??to)) as Archive[];
  const chunks=[...local.chunks];let loaded=0;
  for(const a of archives.slice(0,3)){
   if(this.cache?.key!==a.key){const bytes=await this.store.get(a.key);if(sha(bytes)!==a.sha)throw Error('Take archive checksum mismatch');const body=await codec<{worldId:string;chunks:Chunk[]}>({mode:'unpack',body:bytes});if(body.worldId!==this.worldId)throw Error('Take archive belongs to another world');this.cache={key:a.key,chunks:body.chunks};}
   chunks.push(...this.cache.chunks.filter(c=>c.toTick>from&&c.fromTick<to));loaded++;
   if(chunks.filter(c=>c.toTick<=a.to_tick).length>limit)break;
  }
  const all=[...new Map(chunks.map(c=>[c.toTick,c])).values()].sort((a,b)=>a.toTick-b.toTick),page=all.slice(0,limit);
  return {chunks:page,next:page.length && (all.length>limit||local.next!==null||loaded<archives.length)?page.at(-1)!.toTick:null};
 }
}
