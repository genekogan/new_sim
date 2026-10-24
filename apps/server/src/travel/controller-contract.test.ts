import test from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {mountTravelRoutes} from './routes.ts';
import {TravelError,type Travel} from './travel.ts';

test('travel preserves the controller refusal contract and replacement details',async()=>{
 const app=new Hono(),revokedAt='2026-10-24T03:00:00.000Z',hint='Run: node eden-agent.mjs pair-soul s_test --for CODE';
 mountTravelRoutes(app,{travel:{} as Travel,siteKey:undefined,baseOf:()=> 'http://localhost/w/test',isGod:async()=>false,
  tokenSoul:()=>{throw new TravelError(401,'control.revoked',`Test's control moved to a newer pairing at ${revokedAt}.`,{revokedAt,hint});},
  ownerSoul:async()=>{throw new Error('unused');}});
 for(const method of ['GET','POST']){
  const r=await app.request('/v1/edge/travel',{method});assert.equal(r.status,401);
  const body=await r.json() as any;assert.equal(body.contract,'eden-edge/1');assert.equal(body.error.code,'control.revoked');assert.equal(body.error.revokedAt,revokedAt);assert.equal(body.error.hint,hint);
 }
});
