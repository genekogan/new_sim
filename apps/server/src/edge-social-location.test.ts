import test from 'node:test';
import assert from 'node:assert/strict';
import {edenNavWorld,WORLD_SPOTS} from '../test/eden-nav-fixture.ts';

test('pending named invitation survives the host leaving sight, without granting another guest access',async t=>{
 const w=await edenNavWorld(3),[a,b,c]=w.souls;t.after(()=>{w.f.host.stop();w.f.db.close();});
 const ask=await w.act(a,'read',{with:[b.soulId],seconds:60}) as any;assert.equal(ask.accepted,true,JSON.stringify(ask));
 const invite=w.ledger.together.invitesFor(b.soulId)[0];assert.ok(invite);
 const words=`accept ${a.name}'s invitation`;
 const initial=w.ledger.intents.dryRun(b,{capability:words}) as any;assert.equal(initial.would?.capability,'accept:'+invite.id);
 // Controlled fixture visibility transition: the still-pending host leaves the receiver's sight.
 const body=w.engine.world.entities[a.entityId],garden=w.ledger.places.byId.get('eden-gardens')!.polygon;body.pose.p[0]=garden.reduce((n,p)=>n+p[0],0)/garden.length;body.pose.p[2]=garden.reduce((n,p)=>n+p[1],0)/garden.length;w.ledger.invalidateBodies();
 assert.ok(!w.ledger.capabilities(b).some(x=>x.id==='go-near:'+a.soulId));
 const hidden=w.ledger.intents.dryRun(b,{capability:words}) as any;assert.equal(hidden.would?.capability,'accept:'+invite.id,JSON.stringify(hidden));
 const outsider=await w.act(c,'accept:'+invite.id) as any;assert.equal(outsider.accepted,false);
 const prior=w.f.host.soulNameRefusal;w.f.host.soulNameRefusal=ref=>ref.toLowerCase()===a.name.toLowerCase()?'soul.name-ambiguous':prior.call(w.f.host,ref);
 assert.equal((w.ledger.intents.dryRun(b,{capability:words}) as any).ok,false);
 w.f.host.soulNameRefusal=ref=>ref.toLowerCase()===a.name.toLowerCase()?'soul.name-stale':prior.call(w.f.host,ref);
 assert.equal((w.ledger.intents.dryRun(b,{capability:words}) as any).ok,false);w.f.host.soulNameRefusal=prior;
 const yes=await w.act(b,words) as any;assert.equal(yes.accepted,true,JSON.stringify(yes));assert.equal(yes.receipt.capability,'accept:'+invite.id);
});

test('invited cooking while host travels reaches the same cook place and cooperative group', {timeout:900000},async t=>{
 const w=await edenNavWorld(2,{cn5:true,spots:WORLD_SPOTS}),[a,b]=w.souls;t.after(()=>{w.f.host.stop();w.f.db.close();});
 const body=(s:{entityId:string})=>w.engine.world.entities[s.entityId];
 const p=w.ledger.places.byId.get('eden-north-woods')!.polygon;
 const at=[p.reduce((n,xy)=>n+xy[0],0)/p.length,p.reduce((n,xy)=>n+xy[1],0)/p.length];
 for(const [i,s] of [a,b].entries()){body(s).pose.p[0]=at[0]+i*2;body(s).pose.p[2]=at[1];}
 const ask=await w.act(a,`invite ${b.name} to cook together`,{seconds:300}) as any;assert.equal(ask.accepted,true,JSON.stringify(ask));
 const inv=w.ledger.together.invitesFor(b.soulId)[0];assert.equal(inv?.what,'cook-together');
 const yes=await w.act(b,'accept:'+inv.id) as any;assert.equal(yes.accepted,true,JSON.stringify(yes));
 let together=0,nearest=Infinity,locations:any=null,groups:any=null;
 await w.run([{soulId:a.soulId,id:ask.receipt.id},{soulId:b.soulId,id:yes.receipt.id}],20*420,()=>{
   const x=body(a),y=body(b);if(x.human?.activity==='cook'&&y.human?.activity==='cook'){
     const d=Math.hypot(x.pose.p[0]-y.pose.p[0],x.pose.p[2]-y.pose.p[2]);nearest=Math.min(nearest,d);
     const pa=w.ledger.placePathOf(a.soulId)[0]?.id,pb=w.ledger.placePathOf(b.soulId)[0]?.id;
     locations={a:pa,b:pb};groups={a:x.human.together?.group,b:y.human.together?.group};
     if(d<=4&&pa===pb&&groups.a===inv.id&&groups.b===inv.id)together++;
   }
 });
 const receipts=[w.ledger.receipt(a.soulId,ask.receipt.id),w.ledger.receipt(b.soulId,yes.receipt.id)];
 t.diagnostic(JSON.stringify({nearest,together,locations,groups,finalGap:Math.hypot(body(a).pose.p[0]-body(b).pose.p[0],body(a).pose.p[2]-body(b).pose.p[2]),hostCapability:ask.receipt.capability,phases:receipts.map(r=>({phase:r?.phase,code:r?.code,reason:r?.reason}))}));
 assert.ok(together>=20,'at least one second cooking in the same place/group within4m');
 assert.ok(receipts.every(r=>r?.phase==='completed'),JSON.stringify(receipts));assert.deepEqual(w.f.host.engine.runtime.violations,[]);
});


test('pending invitation preserves an internal apostrophe-s in the sender current name', async t => {
  const w = await edenNavWorld(2), [a, b] = w.souls;
  t.after(() => {w.f.host.stop(); w.f.db.close();});
  // Current metadata has a legitimate internal possessive; the final possessive belongs to the request.
  a.name = "Mars's son"; w.f.host.minds.get(a.soulId)!.name = a.name;
  const ask = await w.act(a, 'read', {with: [b.soulId], seconds: 60}) as any;
  assert.equal(ask.accepted, true, JSON.stringify(ask));
  const invitation = w.ledger.together.invitesFor(b.soulId)[0]; assert.ok(invitation);
  const body = w.engine.world.entities[a.entityId], garden = w.ledger.places.byId.get('eden-gardens')!.polygon;
  body.pose.p[0] = garden.reduce((n, p) => n + p[0], 0) / garden.length;
  body.pose.p[2] = garden.reduce((n, p) => n + p[1], 0) / garden.length;
  w.ledger.invalidateBodies();
  assert.ok(!w.ledger.capabilities(b).some(c => c.id === 'go-near:' + a.soulId));
  for (const possessive of ["'s", '’s']) {
    const resolved = w.ledger.intents.dryRun(b, {capability: `accept ${a.name}${possessive} invitation`}) as any;
    assert.equal(resolved.would?.capability, 'accept:' + invitation.id, JSON.stringify(resolved));
  }
  const accepted = await w.act(b, `accept ${a.name}’s invitation`) as any;
  assert.equal(accepted.accepted, true, JSON.stringify(accepted));
  assert.equal(accepted.receipt.capability, 'accept:' + invitation.id);
});
