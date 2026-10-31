// Read-only reconciliation. Missing evidence is unknown, never proof that a
// write did not execute. This endpoint cannot replay or initiate an action.
import type {Context,Hono} from 'hono';
import {EDGE_CONTRACT,EdgeError,type EdgeDeps,edgeErrorOf} from '../contract.ts';
import {IDEMPOTENCY_TTL_MS} from './idempotency.ts';
const ROUTE=/^POST \/v1\/edge\/(?:act|say|converse|objects\/[^/?#]+\/act)$/;
export function mountOperationLookup(app:Hono,deps:EdgeDeps,receiptByRef:(soulId:string,key:string)=>unknown,now=Date.now){
 app.get('/v1/edge/operations/:key',(c:Context)=>{
  c.header('Cache-Control','no-store');
  try{
   const soul=deps.soul(c),key=c.req.param('key')??'',route=c.req.query('route')??'';
   if(!/^[\x21-\x7e]{1,100}$/.test(key)||!ROUTE.test(route))throw new EdgeError(400,'invalid','Use the original operation key and supported POST route.');
   const limits=(deps.souls as {limits?:{allow(k:string,n:number,ms:number):{ok:boolean}}}).limits;
   if(limits&&!limits.allow(`edge-operation-lookup:${soul.soulId}`,120,60000).ok)throw new EdgeError(429,'rate-limited','Too many operation lookups.');
   const row=deps.db.db.prepare('SELECT status,body FROM edge_idempotency_v1 WHERE world_id=? AND soul_id=? AND route=? AND key=? AND at>=?')
    .get(deps.host.worldId,soul.soulId,route,key,now()-IDEMPOTENCY_TTL_MS) as {status:number;body:string}|undefined;
   if(row)return c.json({contract:EDGE_CONTRACT,state:'recorded',evidence:'idempotency-response',status:row.status,response:JSON.parse(row.body)});
   // Act receipts can survive a crash between accepting the effect and storing
   // the HTTP replay response. They are already scoped by the authenticated Soul.
   const receipt=route==='POST /v1/edge/act'?receiptByRef(soul.soulId,key):null;
   if(receipt)return c.json({contract:EDGE_CONTRACT,state:'recorded',evidence:'action-receipt',status:200,response:{accepted:true,receipt}});
   return c.json({contract:EDGE_CONTRACT,state:'unknown',note:'No retained outcome found. The operation may still have executed; do not automatically replay it.'});
  }catch(e){
   if(e instanceof EdgeError)return c.json({contract:EDGE_CONTRACT,error:edgeErrorOf(e)},e.status as 400);
   return c.json({contract:EDGE_CONTRACT,error:{code:'unavailable',message:'Operation lookup unavailable; no outcome inferred.'}},503);
  }
 });
}
