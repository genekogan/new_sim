import {hashOf} from '@sim/engine-contract';
import {realpathSync} from 'node:fs';
import type {VerifiedAccountIdentity} from '../auth.ts';
import {AccountStore,AccountStoreError,type AccountIdentity,type ApprovalDTO} from './store.ts';
import {tx} from '../edge/comms/store.ts';
import {ApiError,type Souls} from '../souls.ts';
import type {WorldHost} from '../world.ts';
import type {SoulRow} from '../db.ts';
/** Shared account associations; canonical birth ownership is never rewritten. */
export class WorldAccounts {
 readonly host:WorldHost;readonly souls:Souls;readonly store:AccountStore;
 private approving=new Set<string>();
 constructor(host:WorldHost,souls:Souls){
  if(host.db!==souls.db||host!==souls.host)throw Error('Account authority requires the same world and database');
  this.host=host;this.souls=souls;this.store=new AccountStore({db:host.db.db,tx:fn=>tx(host.db.db,fn,{immediate:!host.db.db.isTransaction})},host.worldId);
 }
 owns(accountId:string,row:SoulRow){if(row.world_id!==this.host.worldId)return false;const member=this.host.db.db.prepare('SELECT account_id FROM account_soul_memberships_v1 WHERE world_id=? AND soul_id=?').get(this.host.worldId,row.id) as {account_id:string}|undefined;const validLegacyOwner=row.owner===accountId&&accountId.startsWith('dev:')&&row.token_hash!==null;return member?member.account_id===accountId||validLegacyOwner:row.owner===accountId&&(!accountId.startsWith('dev:')||row.token_hash!==null);}
 rows(accountId:string){return this.host.db.liveSouls(this.host.worldId).filter(row=>this.owns(accountId,row));}
 associationIds(accountId:string){return (this.host.db.db.prepare('SELECT soul_id FROM account_soul_memberships_v1 WHERE world_id=? AND account_id=?').all(this.host.worldId,accountId) as {soul_id:string}[]).map(row=>row.soul_id);}
 revoke(identity:AccountIdentity,soulId:string){this.store.db.tx(()=>{this.store.revoke(identity,soulId);this.host.db.setSoulToken(soulId,null);});}
 canCreate(accountId:string){return this.approving.has(accountId);}
 /** Existing recorded provider ownership is exact identity evidence, unlike a
  * matching display name/email or a dev identity from the same computer. */
 syncCanonical(identity:AccountIdentity){const associated=new Set(this.associationIds(identity.id));for(const row of this.host.db.soulsOf(identity.id)){if(row.world_id!==this.host.worldId||associated.has(row.id)||!this.souls.controlReady(row))continue;
  const first=this.host.db.db.prepare("SELECT seq FROM events WHERE world_id=? AND kind='birth' AND json_extract(payload,'$.soulId')=? ORDER BY seq LIMIT 1").get(this.host.worldId,row.id) as {seq:number}|undefined,birth=first?this.host.db.events(this.host.worldId,first.seq-1,1)[0]:undefined;
  if(!birth||birth.payload.owner!==identity.id||birth.payload.entityId!==row.entity_id)continue;
  this.store.associate(identity,row.id,{attribution:'recorded-provider-owner',evidenceHash:hashOf(birth)});
 }}
 reconcile(id:string){const allocation=this.store.allocation(id);if(!allocation)return;
  const row=this.host.db.soul(allocation.soulId);if(!row||row.world_id!==this.host.worldId||!this.owns(allocation.accountId,row))throw new AccountStoreError('projection-conflict','Soul association unavailable');
  const op=allocation.requestId.startsWith('lc_')?this.souls.lifecycle?.journal.operationInWorld(this.host.worldId,allocation.requestId):undefined;
  if(op){if(op.scope.owner!==row.owner||op.scope.entityId!==row.entity_id)throw new AccountStoreError('projection-conflict','Creation identity changed');this.store.reconcile(id,{...allocation,lifecycleState:op.state,ready:op.state==='complete'&&this.souls.controlReady(row)});}
  else if(allocation.requestId.startsWith('ar_'))this.store.reconcile(id,{...allocation,lifecycleState:'legacy-ready',ready:this.souls.controlReady(row)});
  else throw new AccountStoreError('projection-conflict','Actual creation receipt unavailable');
 }
 view(identity:AccountIdentity,id:string){this.store.view(id,identity);this.reconcile(id);return this.store.view(id,identity);}
 approve(identity:AccountIdentity,id:string){
  this.syncCanonical(identity);
  const user=this.host.db.user(identity.id);if(!user)throw new ApiError(401,'unauthorized','Sign in first.');this.souls.requireInvited(user);
  const dto=this.store.db.tx(()=>{const dto=this.store.approve(identity,id,input=>{
   if(input.mode==='repair'){const row=input.soulId?this.host.db.soul(input.soulId):undefined;if(!row||!this.owns(identity.id,row)||row.retired_at!==null)throw new ApiError(403,'forbidden','Not your Soul.');if(row.name!==input.name)throw new ApiError(409,'soul-name-changed','This Soul has a different current name. Ask the agent for a fresh exact-ID/current-name request.');return {worldId:this.host.worldId,accountId:identity.id,requestId:input.requestId,soulId:row.id};}
   if(!this.souls.lifecycle)throw new ApiError(503,'arrival-unavailable','Account arrivals are unavailable in this world.');
   this.approving.add(identity.id);let op;try{op=this.souls.acceptLifecycleCreate(identity.id,{name:input.name,...(input.description?{description:input.description}:{})},input.requestId);}finally{this.approving.delete(identity.id);}
   return {worldId:this.host.worldId,accountId:identity.id,requestId:op.requestId,soulId:op.scope.soulId};
  });if(dto.mode==='repair'&&dto.soulId&&['creating','ready'].includes(dto.status))this.host.db.setSoulToken(dto.soulId,null);return dto;});this.reconcile(dto.id);return this.store.view(dto.id,identity);
 }
 poll(id:string,secret:string){
  // Validate the secret before reading private allocation/lifecycle scope.
  this.store.poll(id,secret);this.reconcile(id);const out=this.store.poll(id,secret);
  if(out.token){const row=this.host.db.soul(out.soulId!);if(!row||!this.souls.controlReady(row))throw new AccountStoreError('not-ready','The Soul is not ready.');}
  return out;
 }
 /** Only a source-reviewed attribution manifest and verified provider identity
  * may call this helper. Name/bio or caller-supplied email is never attribution. */
 associateAttributed(identity:VerifiedAccountIdentity,input:{worldId:string;dbPath:string;soulId:string;entityId:string;birthSeq:number;birthHash:string;evidenceHash:string;verifiedSubject:string;verifiedEmail:string}){
  if(identity.subject!==input.verifiedSubject||identity.verifiedEmail!==input.verifiedEmail.toLowerCase()||!identity.emailVerifiedAt||Date.now()-identity.emailVerifiedAt>300000||input.worldId!==this.host.worldId||realpathSync(this.host.db.path)!==realpathSync(input.dbPath))throw new ApiError(403,'forbidden','Verified attribution identity or public lineage differs.');
  const row=this.host.db.soul(input.soulId),event=this.host.db.events(this.host.worldId,input.birthSeq-1,1)[0];
  if(!row||row.entity_id!==input.entityId||row.native||!event||event.kind!=='birth'||event.payload.soulId!==row.id||event.payload.entityId!==row.entity_id||event.payload.owner!==row.owner||event.payload.owner==='system'||hashOf(event)!==input.birthHash)throw new ApiError(409,'attribution-unconfirmed','Historical creation attribution differs.');
  return this.store.associate(identity,row.id,{attribution:'reviewed-historical-creator',evidenceHash:input.evidenceHash});
 }
}
