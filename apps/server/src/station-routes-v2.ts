// Explicit public candidate routes only; no new control or permission policy.
import type { Hono } from 'hono';
import type { CandidateStationV2 } from './station-v2.ts';
const missing={ok:false,code:'not-found'};
const safeInt=(s:string|undefined,optional=false)=>s===undefined&&optional?undefined:
  s!==undefined&&/^\d+$/.test(s)&&Number.isSafeInteger(Number(s))?Number(s):NaN;
export function mountStationRoutesV2(app:Hono,station?:CandidateStationV2){
  app.get('/v1/station-v2',c=>station?c.json(station.view(),200,{'Cache-Control':'no-store'}):c.json(missing,404,{'Cache-Control':'no-store'}));
  app.get('/v1/station-v2/history',c=>{
    const q=c.req.query(),tick=Number(q.tick),cutoff=safeInt(q.sourceCutoffSeq,true);
    if(!station||Object.keys(q).some(k=>!['worldId','epoch','rulesVersion','tick','sourceCutoffSeq'].includes(k))
      ||q.worldId!==station.host.worldId||!q.epoch||!q.rulesVersion||!q.tick?.trim()||!Number.isFinite(tick)||tick<0
      ||cutoff!==undefined&&!Number.isSafeInteger(cutoff))return c.json(missing,404,{'Cache-Control':'no-store'});
    try{return c.json(station.history({worldId:q.worldId,epoch:q.epoch,rulesVersion:q.rulesVersion},tick,cutoff),200,{'Cache-Control':'no-store'});}
    catch{return c.json(missing,404,{'Cache-Control':'no-store'});}
  });
  app.get('/v1/station-v2/eras',c=>{
    const q=c.req.query(),after=safeInt(q.afterSeq??'0'),limit=safeInt(q.limit??'64'),cutoff=safeInt(q.sourceCutoffSeq,true);
    if(!station||Object.keys(q).some(k=>!['worldId','epoch','afterSeq','limit','sourceCutoffSeq'].includes(k))
      ||q.worldId!==station.host.worldId||!q.epoch||!Number.isSafeInteger(after)||!Number.isSafeInteger(limit)
      ||cutoff!==undefined&&!Number.isSafeInteger(cutoff))return c.json(missing,404,{'Cache-Control':'no-store'});
    try{return c.json(station.eraPage({worldId:q.worldId,epoch:q.epoch},after!,limit!,cutoff),200,{'Cache-Control':'no-store'});}
    catch{return c.json(missing,404,{'Cache-Control':'no-store'});}
  });
}
