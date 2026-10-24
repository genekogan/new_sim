// SOUL3 controller: one delegated controller per Soul. Only a newly approved pairing/creation or an explicit owner revoke
// supersedes it; registration, sign-out, idle time and restarts keep it. A superseded token answers 401 control.revoked
// (with the Soul, when and how to pair again); a token the world never issued answers 401 control.unknown. Fake world, $0.
import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {buildApp} from './http.ts';
import type {Hub} from './hub.ts';
import type {AccountIdentity} from './accounts/store.ts';
import {WorldAccounts} from './accounts/service.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {EDGE_CONTRACT} from './edge/contract.ts';
import {Db} from './db.ts';
import {hashToken} from './auth.ts';
import {marsFactory,GREEN_FIELD_WORLD} from '@sim/engine-mars';
const factory=await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true});
const ISO=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

function accountWorld(t:TestContext){
 const f=fixture(':memory:',factory);f.brain.quiesce();f.souls.enableLifecycle();t.after(()=>{f.host.stop();f.db.close();});
 f.souls.cfg.accountAuthRequired=true;f.souls.cfg.inviteRequired=false;
 const id='did:privy:alice';f.db.upsertUser({id,email:null,wallet:null,role:'user'});
 const identity:AccountIdentity={id,issuer:'privy.io/test-app',subject:id,verifiedAt:Date.now(),expiresAt:Date.now()+600000};
 f.auth.accountFromToken=async token=>token==='alice'?{identity,user:f.db.user(id)!}:null;
 const originalAuth=f.auth.userFromToken.bind(f.auth);f.auth.userFromToken=async token=>token==='alice'?f.db.user(id)!:originalAuth(token);
 const make=()=>buildApp({cfg:f.souls.cfg,db:f.db,host:f.host,souls:f.souls,brain:f.brain,auth:f.auth,edge:new EdgeLedger(f.host,f.db),hub:{clients:new Map(),refreshMe(){}} as unknown as Hub});
 let app=make();
 const request=async(path:string,body?:unknown,token?:string)=>{const res=await app.request(path,{method:body===undefined?'GET':'POST',headers:{host:'127.0.0.1:4956',...(token?{authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:res.status,body:await res.json() as any};};
 let n=0;
 const start=async(input:{name?:string;soulId?:string},label='agent one')=>{const secret=randomBytes(32).toString('base64url');const r=await request('/v1/agent/approval/start',{agentLabel:label,idempotencyKey:'controller-test-key-'+(n++).toString().padStart(4,'0'),pollSecret:secret,...input});assert.equal(r.status,200,JSON.stringify(r.body));return {id:r.body.approval.id as string,secret};};
 const poll=async(a:{id:string;secret:string})=>{let out:any;for(let i=0;i<50;i++){await setImmediate();f.host.drainInputs();out=(await request('/v1/agent/approval/poll',{approvalId:a.id,pollSecret:a.secret})).body;if(out.token)break;}return out;};
 const pair=async(input:{name?:string;soulId?:string},label?:string)=>{const a=await start(input,label);assert.equal((await request('/v1/account/approvals/'+a.id+'/approve',{},'alice')).status,200);const out=await poll(a);assert.ok(out.token,JSON.stringify(out));return {token:out.token as string,soulId:out.soulId as string,approval:a};};
 return {...f,request,start,pair,restart(){f.souls.accounts=new WorldAccounts(f.host,f.souls);app=make();}};
}

test('account controller: registration, idle views and restart keep it; approved replacement and owner revoke answer control.revoked',async t=>{
 const f=accountWorld(t);
 const first=await f.pair({name:'Ada Lovelace'}),sid=first.soulId;
 const me=await f.request('/v1/agent/me',undefined,first.token);assert.equal(me.status,200);
 assert.equal(me.body.paired_as,'agent one','paired_as is the delegated grant label');
 assert.equal(typeof me.body.since,'number');assert.match(me.body.since_at,ISO);assert.equal(new Date(me.body.since_at).getTime(),me.body.since);
 assert.equal((await f.request('/v1/edge/observe',undefined,first.token)).status,200,'edge route accepts the controller');
 // A fresh registration (another Soul approved for the same account) and a pending-then-cancelled re-pair keep the controller.
 const other=await f.pair({name:'Second Soul'},'agent two');assert.notEqual(other.soulId,sid);
 const pending=await f.start({soulId:sid},'agent three');assert.equal((await f.request('/v1/agent/approval/cancel',{approvalId:pending.id,pollSecret:pending.secret})).status,200);
 // The owner's browser viewing the approval while the Soul is momentarily not ready must not end the grant.
 const ready=f.souls.controlReady.bind(f.souls);f.souls.controlReady=()=>false;await f.request('/v1/account/approvals/'+first.approval.id,undefined,'alice');f.souls.controlReady=ready;
 assert.equal((await f.request('/v1/agent/me',undefined,first.token)).status,200,'controller survives registration, cancel and a not-ready view');
 assert.equal((await f.request('/v1/agent/me',undefined,other.token)).status,200);
 // Approved replacement supersedes.
 const second=await f.pair({soulId:sid},'agent four');assert.equal(second.soulId,sid);
 const now=await f.request('/v1/agent/me',undefined,second.token);assert.equal(now.status,200);assert.equal(now.body.paired_as,'agent four');
 const old=await f.request('/v1/agent/me',undefined,first.token);assert.equal(old.status,401);assert.equal(old.body.code,'control.revoked');
 assert.equal(old.body.soul.name,'Ada Lovelace');assert.match(old.body.revokedAt,ISO);assert.equal(old.body.replacedAt,now.body.since_at);
 assert.match(old.body.message,/Ada Lovelace/);assert.ok(old.body.message.includes(now.body.since_at),old.body.message);
 assert.equal(old.body.hint,`Ask your human for a new code, then: node eden.mjs pair ${sid} --for CODE`);
 assert.equal((await f.request('/v1/agent/soul',undefined,first.token)).body.code,'control.revoked','profile/dashboard route agrees');
 const edge=await f.request('/v1/edge/observe',undefined,first.token);assert.equal(edge.status,401);assert.equal(edge.body.contract,EDGE_CONTRACT);
 assert.equal(edge.body.error.code,'control.revoked');assert.equal(edge.body.error.revokedAt,old.body.revokedAt);assert.equal(edge.body.error.hint,old.body.hint);
 // Unknown is different from revoked.
 const unknown='sim_'+sid+'_'+'0'.repeat(64);
 assert.equal((await f.request('/v1/agent/me',undefined,unknown)).body.code,'control.unknown');
 const unknownEdge=await f.request('/v1/edge/observe',undefined,unknown);assert.equal(unknownEdge.status,401);assert.equal(unknownEdge.body.error.code,'control.unknown');assert.equal(unknownEdge.body.error.soul,undefined);
 // Restart (fresh account service + routes over the same database) keeps both facts.
 f.restart();
 assert.equal((await f.request('/v1/agent/me',undefined,second.token)).body.paired_as,'agent four');
 assert.equal((await f.request('/v1/agent/me',undefined,first.token)).body.code,'control.revoked');
 assert.equal((await f.request('/v1/agent/me',undefined,other.token)).status,200);
 // Explicit owner revoke supersedes; no replacement time.
 assert.equal((await f.request('/v1/account/souls/'+sid+'/revoke',{},'alice')).status,200);
 const revoked=await f.request('/v1/agent/me',undefined,second.token);assert.equal(revoked.status,401);assert.equal(revoked.body.code,'control.revoked');
 assert.equal(revoked.body.replacedAt,null);assert.match(revoked.body.revokedAt,ISO);assert.match(revoked.body.message,/Ada Lovelace/);
 assert.equal((await f.request('/v1/agent/me',undefined,other.token)).status,200,'revoking one Soul leaves the other controller');
 assert.equal((await f.request('/v1/edge/observe',undefined,'not-a-soul-token')).body.error.code,'unauthorized','a non-Soul bearer keeps the old answer');
});

test('legacy controller: re-pair supersedes with control.revoked; the tombstone survives reopening the database without storing the token',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'soul-controller-')),path=join(dir,'world.db');
 const f=fixture(path,factory);f.brain.quiesce();let closed=false;t.after(()=>{if(!closed){f.host.stop();f.db.close();}});
 await invite(f,'alice');const row=await accept(f.host,f.souls.create('dev:alice',{name:'Basil',description:'Synthetic controller Soul'}));
 const pairOnce=async()=>{const code=(await (await f.request('/v1/souls/'+row.id+'/pair',{})).json() as any).code;const res=await f.app.request('/v1/agent/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code,agent:'legacy agent'})});return (await res.json() as any).token as string;};
 const a=await pairOnce();
 const meA=await (await f.app.request('/v1/agent/me',{headers:{authorization:'Bearer '+a}})).json() as any;assert.equal(meA.paired_as,'legacy agent');assert.match(meA.since_at,ISO);
 const b=await pairOnce();assert.notEqual(a,b);
 const old=await f.app.request('/v1/agent/me',{headers:{authorization:'Bearer '+a}}),body=await old.json() as any;
 assert.equal(old.status,401);assert.equal(body.code,'control.revoked');assert.equal(body.soul.name,'Basil');
 const meB=await (await f.app.request('/v1/agent/me',{headers:{authorization:'Bearer '+b}})).json() as any;assert.equal(body.replacedAt,meB.since_at);
 assert.equal((await f.app.request('/v1/agent/me',{headers:{authorization:'Bearer sim_'+row.id+'_nope'}})).status,401);
 f.host.stop();f.db.close();closed=true;
 const reopened=new Db(path);t.after(()=>reopened.close());
 const dump=JSON.stringify(reopened.db.prepare("SELECT * FROM soul_token_tombstones_v1").all());assert.ok(!dump.includes(a),'no bearer plaintext');assert.ok(dump.includes(hashToken(a)));
 assert.equal(reopened.tokenTombstone(hashToken(a))?.soul_id,row.id);assert.equal(reopened.tokenTombstone(hashToken(b)),undefined);
});
