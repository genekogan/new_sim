// Lane LOOKS: new Souls in new worlds are born with a varied kit look (installBirthLooks), and the owner can set a
// Soul's look over PUT /v1/souls/:id/look (another owner gets 403); old worlds (no install) keep no body record.
import test from 'node:test';import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';import {EdgeLedger} from './edge/ledger/ledger.ts';import {buildApp} from './http.ts';
import {installBirthLooks,birthLook} from './god/birth-look.ts';import {LOOK_MODEL} from '../../web/src/humanoid/look.ts';
import type {Hub} from './hub.ts';

const born=async(f:ReturnType<typeof fixture>,owner:string,name:string)=>{await invite(f,owner);return accept(f.host,f.souls.create('dev:'+owner,{name,description:'scripted look test'}));};
const settle=async(f:ReturnType<typeof fixture>)=>{for(let i=0;i<6;i++){f.host.tickOnce();f.host.drainInputs();await new Promise(r=>setImmediate(r));}};

test('BIRTH LOOKS: installed worlds give each new Soul a varied seeded kit look; uninstalled worlds do not',async t=>{
 const old=fixture(':memory:');old.brain.quiesce();t.after(()=>{old.host.stop();old.db.close();});
 const o=await born(old,'a','Old A');await settle(old);assert.equal(old.host.engine.world.entities[o.entity_id].body,undefined,'old worlds keep today\'s classic looks');
 const f=fixture(':memory:');f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});installBirthLooks(f.host);
 const rows=[];for(const n of ['a','b','c','d'])rows.push(await born(f,n,'Look '+n));await settle(f);
 const bodies=rows.map(r=>f.host.engine.world.entities[r.entity_id].body as {model:string});
 for(const [i,b] of bodies.entries()){assert.ok(b&&LOOK_MODEL.test(b.model),JSON.stringify(b));assert.deepEqual(b,birthLook(rows[i].entity_id));}
 assert.equal(new Set(bodies.map(b=>b.model)).size,bodies.length,'every Soul looks different');
});

test('OWNER LOOK: PUT /v1/souls/:id/look sets the owner\'s Soul look; another owner is refused',async t=>{
 const f=fixture(':memory:');f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 const cfg={worldId:f.host.worldId,worldKey:'eden',worldPath:'/w/eden',brainMode:'fake',inviteRequired:true,build:'test'} as never;
 const a=await born(f,'a','Owner A');await born(f,'b','Owner B');
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});
 const {config}=await import('./config.ts');
 const app:Hono=buildApp({cfg:{...config,...(cfg as object)} as never,db:f.db,host:f.host,auth:f.auth,brain:f.brain,souls:f.souls,edge,hub:{refreshMe(){},clients:new Map(),joinMessages:[],upgradeHandlers:[]} as unknown as Hub});
 const put=(owner:string,look:unknown)=>accept(f.host,Promise.resolve(app.request(`/v1/souls/${a.id}/look`,{method:"PUT",headers:{host:"127.0.0.1:5733",authorization:`Bearer dev:${owner}`,"content-type":"application/json"},body:JSON.stringify(look)})));
 const r=await put('a',{random:true,seed:5});assert.equal(r.status,200,await r.clone().text());
 const body=f.host.engine.world.entities[a.entity_id].body as {model:string};assert.match(body.model,LOOK_MODEL);
 const denied=await put('b',{hat:'cap'});assert.equal(denied.status,403,await denied.clone().text());
 assert.deepEqual(f.host.engine.world.entities[a.entity_id].body,body,'the other owner changed nothing');
});
