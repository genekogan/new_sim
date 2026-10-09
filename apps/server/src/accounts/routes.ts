import type {Hono,Context} from 'hono';
import {z} from 'zod';
import {ApiError} from '../souls.ts';
import type {Auth} from '../auth.ts';
import {AccountStoreError} from './store.ts';
import type {WorldAccounts} from './service.ts';

const startSchema=z.object({agentLabel:z.string().min(1).max(120),name:z.string().min(2).max(32),description:z.string().max(1200).optional(),idempotencyKey:z.string().min(16).max(256),pollSecret:z.string().regex(/^[A-Za-z0-9_-]{43}$/),soulId:z.string().regex(/^s_[a-zA-Z0-9_-]+$/).optional()}).strict();
const pollSchema=z.object({approvalId:z.string().regex(/^ap_[a-f0-9]{32}$/),pollSecret:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict();
export function mountAccountRoutes(app:Hono,deps:{accounts:WorldAccounts;auth:Auth;baseOf:(c:Context)=>string;limit:(c:Context,key:string,max:number,ms:number)=>void}){
 const {accounts,auth}=deps;
 const verified=async(c:Context)=>{const account=await auth.accountFromToken(c.req.header('authorization')?.replace(/^Bearer\s+/i,''));if(!account)throw new ApiError(401,'account-signin-required','Sign in with Google or email.');accounts.syncCanonical(account.identity);return account;};
 const json=async(c:Context)=>{try{return await c.req.json();}catch{throw new ApiError(400,'invalid','Body must be JSON.');}};
 const parse=<T>(schema:z.ZodType<T>,value:unknown):T=>{const result=schema.safeParse(value);if(!result.success)throw new ApiError(400,'invalid','Approval request format is invalid.');return result.data;};
 const wrap=async(c:Context,run:()=>unknown|Promise<unknown>)=>{c.header('Cache-Control','no-store');try{return c.json(await run());}catch(error){if(error instanceof AccountStoreError)throw new ApiError(error.code==='not-found'?404:error.code==='forbidden'?403:error.code==='identity'||error.code==='poll-secret'?401:error.code==='invalid'?400:409,error.code,error.message);throw error;}};
 const world=(c:Context)=>({id:accounts.host.worldId,name:accounts.souls.cfg.worldKey,url:deps.baseOf(c)});
 app.post('/v1/agent/approval/start',c=>wrap(c,async()=>{deps.limit(c,'account-start',6,60000);const p=parse(startSchema,await json(c)),{soulId,...input}=p;
  const approval=soulId?accounts.store.startRepairRequest(soulId,input):accounts.store.start(input);
  return {approval,world:world(c),approvalURL:`${deps.baseOf(c)}/#approve/${approval.id}`,intervalSeconds:3};}));
 app.post('/v1/agent/approval/poll',c=>wrap(c,async()=>{deps.limit(c,'account-poll',60,60000);const p=parse(pollSchema,await json(c));return {...accounts.poll(p.approvalId,p.pollSecret),world:world(c)};}));
 app.post('/v1/agent/approval/cancel',c=>wrap(c,async()=>{const p=parse(pollSchema,await json(c));return {approval:accounts.store.cancel(null,p.approvalId,p.pollSecret),world:world(c)};}));
 app.get('/v1/account/approvals/:id',c=>wrap(c,async()=>{const {identity}=await verified(c);return {approval:accounts.view(identity,c.req.param('id')),world:world(c)};}));
 app.post('/v1/account/approvals/:id/approve',c=>wrap(c,async()=>{const {identity}=await verified(c);deps.limit(c,'account-approve',10,60000);return {approval:accounts.approve(identity,c.req.param('id')),world:world(c)};}));
 app.post('/v1/account/approvals/:id/cancel',c=>wrap(c,async()=>{const {identity}=await verified(c);return {approval:accounts.store.cancel(identity,c.req.param('id')),world:world(c)};}));
 app.post('/v1/account/souls/:id/revoke',c=>wrap(c,async()=>{const {identity}=await verified(c),row=accounts.host.db.soul(c.req.param('id'));if(!row||!accounts.owns(identity.id,row))throw new ApiError(403,'forbidden','Not your Soul.');accounts.revoke(identity,row.id);return {ok:true,soulId:row.id};}));
}
