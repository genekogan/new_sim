import type {Context,Hono} from 'hono';
import type {Entity} from '@sim/engine-contract';
import {EDGE_CONTRACT,EdgeError,edgeBody,type EdgeDeps} from '../contract.ts';
import type {EdgeLedger} from '../ledger/ledger.ts';
import {admitBodyGLB,BodyAdmissionError,BODY_LIMITS} from './admission.ts';
import {FLOATER_MODELS} from '../../../../../mars/viewer/engine/bodies/models.ts';
import {addSchemaPart} from '../events/schema.ts';

export const BODY_PRESETS=[{id:'humanoid',name:'Humanoid',body:null},...FLOATER_MODELS.filter(m=>m.group==='floater').map(m=>{
  const modelUrl=`/world-assets/littlemartians/characters/${m.file}`;
  return {id:m.id,name:m.name,body:{family:'floater',type:'ceramic',model:m.id,modelUrl,avatar:{kind:'body',modelUrl,bodyType:'ceramic'},radius:.35,hoverHeight:1.45} as Entity['body']};
})];
const ASSET=/^body_[a-f0-9]{64}$/;
const MAX_UPLOAD_REQUEST=BODY_LIMITS.bytes+64*1024;

/** Read a bounded multipart request before invoking the platform's form parser. */
async function uploadForm(c:Context){
  const length=c.req.header('content-length');if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>MAX_UPLOAD_REQUEST))throw new EdgeError(413,'body.too-large','Body upload exceeds 16 MiB plus form metadata');
  if(!/^multipart\/form-data\s*;/i.test(c.req.header('content-type')??''))throw new EdgeError(400,'body.multipart','Use multipart model and manifest fields');
  const reader=c.req.raw.body?.getReader();if(!reader)throw new EdgeError(400,'body.multipart','Missing upload');
  const parts:Uint8Array[]=[];let size=0;
  try {for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>MAX_UPLOAD_REQUEST){await reader.cancel();throw new EdgeError(413,'body.too-large','Body upload exceeds 16 MiB plus form metadata');}parts.push(r.value);}}
  finally{reader.releaseLock();}
  const bytes=Buffer.concat(parts,size);
  try{return await new Request(c.req.url,{method:'POST',headers:{'content-type':c.req.header('content-type')!},body:bytes}).formData();}
  catch{throw new EdgeError(400,'body.multipart','Malformed multipart form');}
}

export function mountBodyRoutes(app:Hono,deps:EdgeDeps&{ledger:EdgeLedger}){
  const db=deps.db.db,world=deps.host.worldId;
  const available=!!deps.host.engine.assignBodyV1&&!!deps.host.engine.bodyAssignmentProblemV1;
  const prefix=deps.souls.cfg.worldPath?.replace(/\/$/,'')??'';
  db.exec(`CREATE TABLE IF NOT EXISTS edge_body_assets_v1(world_id TEXT NOT NULL,asset_id TEXT NOT NULL,descriptor TEXT NOT NULL,content BLOB NOT NULL,PRIMARY KEY(world_id,asset_id)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS edge_body_owners_v1(world_id TEXT NOT NULL,owner TEXT NOT NULL,asset_id TEXT NOT NULL,descriptor TEXT NOT NULL,PRIMARY KEY(world_id,owner,asset_id)) WITHOUT ROWID;`);
  if(!(db.prepare('PRAGMA table_info(edge_body_owners_v1)').all() as {name:string}[]).some(c=>c.name==='descriptor')){
    db.exec('ALTER TABLE edge_body_owners_v1 ADD COLUMN descriptor TEXT');
    db.exec('UPDATE edge_body_owners_v1 SET descriptor=(SELECT a.descriptor FROM edge_body_assets_v1 a WHERE a.world_id=edge_body_owners_v1.world_id AND a.asset_id=edge_body_owners_v1.asset_id)');
  }
  const wrap=(fn:(c:Context)=>unknown|Promise<unknown>)=>async(c:Context)=>{
    c.header('Cache-Control','no-store');try{return c.json(edgeBody(await fn(c) as object));}
    catch(e){if(e instanceof BodyAdmissionError)return c.json({contract:EDGE_CONTRACT,error:{code:e.code,message:e.message}},400);
      if(e instanceof EdgeError)return c.json({contract:EDGE_CONTRACT,error:{code:e.code,message:e.message}},e.status as 400);
      console.error('[body] request failed',e instanceof Error?e.message:'unknown');return c.json({contract:EDGE_CONTRACT,error:{code:'body.unavailable',message:'Body admission is unavailable; retry'}},503);}
  };
  const current=(id:string)=>deps.host.engine.world.entities[id]?.body??null;
  const record=(id:string,owner:string)=>db.prepare('SELECT descriptor FROM edge_body_owners_v1 WHERE world_id=? AND owner=? AND asset_id=?').get(world,owner,id) as {descriptor:string}|undefined;
  app.get('/v1/edge/body',wrap(c=>{const s=deps.soul(c);return {available,body:current(s.entityId),types:available?['humanoid','ceramic','floater']:[],presets:available?BODY_PRESETS:[],limits:BODY_LIMITS,
    uploads:(db.prepare('SELECT descriptor FROM edge_body_owners_v1 WHERE world_id=? AND owner=? ORDER BY asset_id').all(world,s.owner) as {descriptor:string}[]).map(r=>JSON.parse(r.descriptor))};}));
  app.post('/v1/edge/body/uploads',wrap(async c=>{
    const s=deps.soul(c);if(!available)throw new EdgeError(503,'body.unavailable','This world engine cannot assign bodies');if(!deps.souls.limits.allow(`edge-body-upload:${s.soulId}`,2,60000).ok)throw new EdgeError(429,'rate-limited','At most two body uploads per minute');
    const form=await uploadForm(c);if(form.getAll('model').length!==1||form.getAll('manifest').length!==1)throw new EdgeError(400,'body.multipart','One model file and one manifest are required');
    const model=form.get('model'),raw=form.get('manifest');if(!model||typeof model==='string'||typeof raw!=='string'||raw.length>4096)throw new EdgeError(400,'body.multipart','One model file and one short JSON manifest are required');
    if(model.size>BODY_LIMITS.bytes)throw new EdgeError(413,'body.too-large','Body GLB exceeds 16 MiB');
    let manifest:unknown;try{manifest=JSON.parse(raw);}catch{throw new EdgeError(400,'body.manifest','Manifest must be JSON');}
    const bytes=Buffer.from(await model.arrayBuffer()),admitted=admitBodyGLB(bytes,manifest);
    const asset={...admitted,rightsConfirmed:true,modelUrl:`${prefix}/v1/edge/body/assets/${admitted.assetId}.glb`};
    // Recheck bearer after parsing/admission: revoked tokens cannot publish assets.
    const again=deps.soul(c);if(again.soulId!==s.soulId||again.owner!==s.owner)throw new EdgeError(401,'unauthorized','Body owner changed during upload');
    const existing=db.prepare('SELECT 1 FROM edge_body_owners_v1 WHERE world_id=? AND owner=? AND asset_id=?').get(world,s.owner,asset.assetId);
    const quota=db.prepare('SELECT COUNT(*) n,COALESCE(SUM(length(a.content)),0) bytes FROM edge_body_owners_v1 o JOIN edge_body_assets_v1 a USING(world_id,asset_id) WHERE world_id=? AND owner=?').get(world,s.owner) as {n:number;bytes:number};
    if(!existing&&(quota.n>=8||quota.bytes+bytes.length>64*1024*1024))throw new EdgeError(409,'body.storage-limit','This owner already has the maximum admitted body storage');
    db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT OR IGNORE INTO edge_body_assets_v1 VALUES(?,?,?,?)').run(world,asset.assetId,JSON.stringify(asset),bytes);db.prepare('INSERT INTO edge_body_owners_v1(world_id,owner,asset_id,descriptor) VALUES(?,?,?,?) ON CONFLICT(world_id,owner,asset_id) DO UPDATE SET descriptor=excluded.descriptor').run(world,s.owner,asset.assetId,JSON.stringify(asset));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    return {asset};
  }));
  app.put('/v1/edge/body',wrap(async c=>{
    const s=deps.soul(c),source=deps.db.soul(s.soulId);if(!source)throw new EdgeError(401,'unauthorized','Soul owner is unavailable');
    const raw=await c.req.json().catch(()=>null);if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==1)throw new EdgeError(400,'body.assignment','Choose exactly one preset or assetId');
    let body:Entity['body']|null;
    if(typeof raw.preset==='string'){const preset=BODY_PRESETS.find(p=>p.id===raw.preset);if(!preset)throw new EdgeError(400,'body.preset-unknown','Unknown body preset');body=preset.body;}
    else if(typeof raw.assetId==='string'&&ASSET.test(raw.assetId)){
      if(!db.prepare('SELECT 1 FROM edge_body_owners_v1 WHERE world_id=? AND owner=? AND asset_id=?').get(world,s.owner,raw.assetId))throw new EdgeError(403,'body.not-owned','This upload does not belong to the Soul owner');
      const row=record(raw.assetId,s.owner);if(!row)throw new EdgeError(404,'body.asset-not-found','No admitted body asset');const asset=JSON.parse(row.descriptor);
      const type=asset.type,modelUrl=asset.modelUrl;body={family:type==='humanoid'?'humanoid':'floater',type,model:asset.assetId,modelUrl,avatar:{kind:'body',modelUrl,bodyType:type},...(type==='humanoid'?{}:{radius:.35,hoverHeight:1.45})};
    }else throw new EdgeError(400,'body.assignment','Choose a preset or admitted assetId');
    const authority=():true=>{const row=deps.db.soul(s.soulId),mind=deps.host.minds.get(s.soulId);
      if(!row||row.retired_at!==null||row.owner!==source.owner||row.world_id!==world||row.entity_id!==s.entityId||row.token_hash!==source.token_hash||!mind||mind.owner!==row.owner||mind.entityId!==row.entity_id)throw new EdgeError(401,'unauthorized','Soul authority changed before body assignment');
      return true;};
    authority();deps.ledger.ownerControlGrace(s.soulId);
    const guard=():true=>{authority();
      if(deps.host.quietBarrier||!deps.ledger.bodyAssignmentReady(s))throw new EdgeError(409,'body.safe-standing-required','Finish the current commitment before changing bodies');
      if(!deps.host.engine.bodyAssignmentProblemV1)throw new EdgeError(503,'body.unavailable','This engine cannot assign bodies');
      const issue=deps.host.engine.bodyAssignmentProblemV1(s.entityId,body);if(issue)throw new EdgeError(409,issue,'Finish safely standing with free hands and clear space before changing bodies');return true;
    };
    guard();if(JSON.stringify(current(s.entityId))===JSON.stringify(body))return {body:current(s.entityId),changed:false};
    const event=await deps.host.enqueueChecked('body-assignment-v1','world:body',{contract:'body-assignment/1',worldId:world,soulId:s.soulId,entityId:s.entityId,body:structuredClone(body)},guard,()=>true);
    deps.ledger.invalidateBodies();return {body:current(s.entityId),changed:true,tick:event.tick,seq:event.seq};
  }));
  app.get('/v1/edge/body/assets/:file',c=>{
    const file=c.req.param('file');if(!/^body_[a-f0-9]{64}\.glb$/.test(file))return c.notFound();
    const row=db.prepare('SELECT content FROM edge_body_assets_v1 WHERE world_id=? AND asset_id=?').get(world,file.slice(0,-4)) as {content:Uint8Array}|undefined;if(!row)return c.notFound();
    return c.body(new Uint8Array(row.content),200,{'Content-Type':'model/gltf-binary','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"});
  });
  addSchemaPart('body',{contract:'body/1',types:['humanoid','ceramic','floater'],limits:BODY_LIMITS,endpoints:['GET /v1/edge/body','POST /v1/edge/body/uploads (multipart model+manifest)','PUT /v1/edge/body (preset|assetId)'],rig:'quaternius/1',safeSwap:'Standing, idle, free hands and no carriers/paired/construction commitments'});
}
