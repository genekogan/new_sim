import { z } from 'zod';

export const lifecycleRequestIdSchema=z.string().regex(/^lc_[0-9a-f]{32}$/);
export const lifecycleCursorSchema=z.string().regex(/^lc1_lc_[0-9a-f]{32}$/);
const id=z.string().min(1).max(128),integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const soulLifecycleSchema=z.object({
  contract:z.literal('soul-lifecycle/1'),worldId:id,requestId:lifecycleRequestIdSchema,soulId:id,entityId:id,
  name:z.string().min(2).max(32),operation:z.enum(['create','retire']),
  state:z.enum(['pending','admitted','refused','retiring','retired']),revision:integer.min(1),requestedAt:integer,
  fact:z.object({seq:integer.min(1),tick:integer}).strict().nullable(),ready:z.boolean(),
  reason:z.enum(['arrival-unavailable','reconciling','removal-pending','retirement-accepted']).nullable(),
  allocation:z.object({countsTowardLimit:z.boolean(),reservesName:z.boolean()}).strict(),
}).strict().superRefine((r,ctx)=>{
  const reject=(message:string)=>ctx.addIssue({code:'custom',message});
  const historicalRetired=r.operation==='create'&&r.state==='admitted'&&r.reason==='retirement-accepted';
  const held=r.operation==='create'&&['pending','admitted'].includes(r.state)&&!historicalRetired;
  if(r.allocation.countsTowardLimit!==held||r.allocation.reservesName!==held)reject('Allocation must match the lifecycle state');
  if(r.operation==='create'){
    if(!['pending','admitted','refused'].includes(r.state))reject('Create has an invalid state');
    if(r.state==='pending'&&(r.fact!==null||r.ready||r.reason!=='reconciling'))reject('Pending is unconfirmed');
    if(r.state==='admitted'&&(!r.fact||(historicalRetired?r.ready:r.reason!==(r.ready?null:'reconciling'))))reject('Admission needs a fact and current readiness');
    if(r.state==='refused'&&(r.fact!==null||r.ready||r.reason!=='arrival-unavailable'))reject('Refusal has no physical fact or readiness');
  }else{
    if(!['retiring','retired'].includes(r.state)||r.ready)reject('Retirement never supplies control readiness');
    if(r.state==='retiring'&&(r.fact!==null||!['removal-pending','reconciling'].includes(r.reason??'')))reject('Retiring has no terminal fact');
    if(r.state==='retired'&&(!r.fact||r.reason!==null))reject('Retired needs a confirmed terminal association');
  }
});
export type SoulLifecycle=z.infer<typeof soulLifecycleSchema>;
export const ownerLifecycleListSchema=z.object({contract:z.literal('owner-lifecycle-list/1'),worldId:id,
  requests:z.array(soulLifecycleSchema).max(20),nextCursor:lifecycleCursorSchema.nullable(),
}).strict().superRefine((r,ctx)=>{
  if(r.requests.some(q=>q.worldId!==r.worldId)||new Set(r.requests.map(q=>q.requestId)).size!==r.requests.length)
    ctx.addIssue({code:'custom',message:'Owner lifecycle page has inconsistent world or duplicate operation'});
});
export type OwnerLifecycleList=z.infer<typeof ownerLifecycleListSchema>;
