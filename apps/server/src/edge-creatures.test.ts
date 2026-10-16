// Creature bodies over the owner API (R11a): an owner picks a duck, a snail or a dog with `body set <species>`; the
// capability list speaks its gait (waddle, slide, trot) and offers settle; what the body cannot do is refused with the
// species' own reason and admits nothing; a dog follows its owner's other resident.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {fixture,invite,accept,factory} from '../test/native-owner-fixture.ts';import {EdgeLedger} from './edge/ledger/ledger.ts';import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';import {Hono} from 'hono';
import {CREATURES} from '../../../mars/viewer/engine/bodies/creatures.ts';

async function setup(t:any){
 const dir=mkdtempSync(join(tmpdir(),'creatures-api-')),f=fixture(join(dir,'sim.db'),factory,{durableClockV1:true});f.brain.quiesce();
 t.after(()=>{f.host.stop();if(f.db.db.isOpen)f.db.close();rmSync(dir,{recursive:true,force:true});});
 await invite(f,'a');const ss:any[]=[];
 // one owner, three residents: the dog follows its owner's other resident
 for(const name of ['Rex','Ana','Shelly']){const row=await accept(f.host,f.souls.create('dev:a',{name,description:'creature test'}));const p=f.souls.pairCode(row,'http://127.0.0.1:6050'),token=f.souls.pairExchange(p.code,'scripted').token;ss.push({row,token,soul:{soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner}});}
 const ledger=new EdgeLedger(f.host,f.db,undefined,{ambient:false}),app=new Hono();
 mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger,soul:edgeSoulResolver(f.host,f.souls,c=>c.req.header('authorization')?.replace(/^Bearer /,''))});
 const req=(s:any,url:string,data?:unknown,method=data===undefined?'GET':'POST')=>app.request('/v1/edge/'+url,{method,headers:{authorization:'Bearer '+s.token,...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});
 return {f,ss,ledger,req};
}
const setBody=async(w:any,s:any,preset:string)=>{const r:Response=await accept(w.f.host,w.req(s,'body',{preset},'PUT'));const j=await r.clone().json();assert.equal(r.status,200,await r.clone().text());return j.body;};

test('owners pick a duck, a snail or a dog; each speaks its own gait, offers settle and keeps no hand or seat actions',async t=>{
 const w=await setup(t),[rex]=w.ss;
 const catalog=await(await w.req(rex,'body')).json();
 for(const id of ['duck','snail','dog']){const p=catalog.presets.find((x:any)=>x.id===id);assert.ok(p,id);assert.equal(p.body.type,'creature');assert.equal(p.creature.speed,CREATURES[id as 'duck'].speed);}
 assert.ok(catalog.types.includes('creature'));
 for(const [id,Move] of [['duck','Waddle'],['snail','Slide'],['dog','Trot']] as const){
  const body=await setBody(w,rex,id);assert.deepEqual(body,{family:'floater',type:'creature',model:id,radius:CREATURES[id].radius,hoverHeight:CREATURES[id].eyeHeight});
  const caps=w.ledger.capabilities(rex.soul);
  const settle=caps.find(c=>c.id==='settle:here');assert.ok(settle,id);assert.match(settle!.label,new RegExp(CREATURES[id].settles));
  assert.ok(!caps.some(c=>c.verb==='hover'),`${id}: creatures settle, they do not hover`);
  assert.ok(!caps.some(c=>['sit','hug','pick-up','play-piano','dance-with','eat'].includes(c.verb)),`${id}: ${caps.map(c=>c.verb).join(',')}`);
  const walks=caps.filter(c=>c.verb==='walk');assert.ok(walks.length&&walks.every(c=>c.label.startsWith(Move)),`${id}: ${walks.map(c=>c.label).join(' | ')}`);
 }
});

test('what a creature cannot do is refused with its own reason and admits no native input (a snail cannot hug)',async t=>{
 const w=await setup(t),[shelly,ana]=w.ss;await setBody(w,shelly,'snail');
 const head=w.f.host.seq,hash=w.f.host.engine.stateHash();
 const hug=await accept(w.f.host,w.ledger.act(shelly.soul,{capability:'hug:'+ana.row.id}));assert.equal(hug.accepted,false);assert.equal((hug as any).code,'body.unsupported');assert.match((hug as any).reason,/snail has no arms to hug/);
 const swim=await accept(w.f.host,w.ledger.act(shelly.soul,{capability:'swim:shore-water'}));assert.equal(swim.accepted,false);assert.match((swim as any).reason,/snail does not swim/);
 const sit=await accept(w.f.host,w.ledger.act(shelly.soul,{verb:'sit',target:{nearest:'seat'}}));assert.equal(sit.accepted,false);assert.match((sit as any).reason,/withdraws into its shell/);
 const eat=await accept(w.f.host,w.ledger.act(shelly.soul,{capability:'eat:held'}));assert.equal(eat.accepted,false);assert.match((eat as any).reason,/snail has no hands/);
 assert.equal(w.f.host.seq,head,'refusals admit no native input');assert.equal(w.f.host.engine.stateHash(),hash);
 // the duck has wings, not arms; a dog swims (the refusal is only the place: this fixture world has no water for it)
 await setBody(w,ana,'duck');const duckHug=await accept(w.f.host,w.ledger.act(ana.soul,{capability:'hug:'+shelly.row.id}));assert.match((duckHug as any).reason,/wings, not arms/);
 const settle=await accept(w.f.host,w.ledger.act(shelly.soul,{capability:'settle:here',params:{seconds:2}}));assert.ok(settle.accepted,JSON.stringify(settle));
});

test('a dog follows its owner\'s other resident on a stroll at its own trot and is at her side when she stops',async t=>{
 const w=await setup(t),[rex,ana]=w.ss;await setBody(w,rex,'dog');
 const caps=w.ledger.capabilities(rex.soul),follow=caps.find(c=>c.id==='follow:'+ana.row.id);assert.ok(follow,caps.map(c=>c.id).join(','));assert.equal(follow!.available,true);
 const out=await accept(w.f.host,w.ledger.act(rex.soul,{capability:'follow:'+ana.row.id,params:{seconds:120}}));assert.ok(out.accepted,JSON.stringify(out));
 // Ana walks off to a place; the dog keeps up
 const go=w.ledger.capabilities(ana.soul).find(c=>c.verb==='stroll'&&c.available);assert.ok(go,'Ana has somewhere to stroll');
 const walked=await accept(w.f.host,w.ledger.act(ana.soul,{capability:go!.id}));assert.ok(walked.accepted,JSON.stringify(walked));
 const E=w.f.host.engine.world.entities,dist=()=>Math.hypot(E[rex.row.entity_id].pose.p[0]-E[ana.row.entity_id].pose.p[0],E[rex.row.entity_id].pose.p[2]-E[ana.row.entity_id].pose.p[2]);
 const start=[...E[ana.row.entity_id].pose.p],dogStart=[...E[rex.row.entity_id].pose.p];let top=0,far=0;
 for(let i=0;i<20*60;i++){w.f.host.tickOnce();top=Math.max(top,(E[rex.row.entity_id] as any).human?.speed??0);far=Math.max(far,dist());}
 // she stops; the dog catches up and stays at her side
 const stop=await accept(w.f.host,w.ledger.act(ana.soul,{capability:'rest:here',params:{seconds:60}}));assert.ok(stop.accepted,JSON.stringify(stop));
 for(let i=0;i<20*30;i++)w.f.host.tickOnce();
 const moved=Math.hypot(E[ana.row.entity_id].pose.p[0]-start[0],E[ana.row.entity_id].pose.p[2]-start[2]),dogMoved=Math.hypot(E[rex.row.entity_id].pose.p[0]-dogStart[0],E[rex.row.entity_id].pose.p[2]-dogStart[2]);
 assert.equal(w.f.db.soul(ana.row.id)!.owner,w.f.db.soul(rex.row.id)!.owner,'same owner');
 assert.ok(moved>10,`Ana strolled ${moved.toFixed(1)} m`);assert.ok(dogMoved>moved-3,`the dog went with her: ${dogMoved.toFixed(1)} m`);
 assert.ok(dist()<3,`the dog is at her side once she stops: ${dist().toFixed(2)} m (at most ${far.toFixed(1)} m behind on the way)`);
 assert.ok(top>1.35&&top<=CREATURES.dog.speed+1e-9,`trot ${top}`);
 assert.deepEqual(w.f.host.engine.runtime.violations,[]);
});
