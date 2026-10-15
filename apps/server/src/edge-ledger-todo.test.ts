import test from 'node:test';
import assert from 'node:assert/strict';
import {edenNavWorld} from '../test/eden-nav-fixture.ts';

test('todo gaits: ordinary acts run to a destination, jog a closed park route, and never complete before arrival', {timeout:600000}, async t => {
  const w=await edenNavWorld(1);t.after(()=>{w.f.host.stop();w.f.db.close();});
  const [s]=w.souls, body=()=>w.engine.world.entities[s.entityId];
  const run=await w.act(s,'go to the park running');
  assert.equal(run.accepted,true,JSON.stringify(run));if(!run.accepted)return;
  assert.equal(run.receipt.capability,'run:region-park');assert.notEqual(run.receipt.phase,'completed','accepted is not arrived');
  let running=0,peak=0,prev=[...body().pose.p];
  await w.run([{soulId:s.soulId,id:run.receipt.id}],3000,()=>{const e=body();if(e.human?.activity==='run'){running++;peak=Math.max(peak,Math.hypot(e.pose.p[0]-prev[0],e.pose.p[2]-prev[2])*20);}prev=[...e.pose.p];});
  assert.equal(w.ledger.receipt(s.soulId,run.receipt.id)?.phase,'completed');assert.ok(running>5,'run animation/activity observed');assert.ok(peak>3.8&&peak<=4.01,`run speed ${peak}`);
  const loop=await w.act(s,'go for a jog around the park');
  assert.equal(loop.accepted,true,JSON.stringify(loop));if(!loop.accepted)return;
  assert.match(loop.receipt.capability,/^jog-around:region-park$/);assert.notEqual(loop.receipt.phase,'completed');
  let jogging=0,loopStart:number[]|null=null,jogPeak=0;prev=[...body().pose.p];
  await w.run([{soulId:s.soulId,id:loop.receipt.id}],14000,()=>{const e=body();if(e.human?.activity==='jog'){jogging++;jogPeak=Math.max(jogPeak,Math.hypot(e.pose.p[0]-prev[0],e.pose.p[2]-prev[2])*20);if(e.pose.p[2]>85)loopStart??=[...e.pose.p];}prev=[...e.pose.p];});
  assert.equal(w.ledger.receipt(s.soulId,loop.receipt.id)?.phase,'completed');assert.ok(jogging>100,'jog visibly progresses through park');assert.ok(jogPeak>2.4&&jogPeak<=2.51,`jog speed ${jogPeak}`);
  const plan=w.f.db.events(w.f.host.worldId).find(e=>e.kind==='decision'&&(e.payload as any).trigger==='edge-act:'+loop.receipt.id)!.payload as any;
  const points=plan.steps.filter((s:any)=>s.verb==='walk_to').map((s:any)=>s.params.to);assert.deepEqual(points.at(-1),points[0],'loop closes at its first point');
  assert.deepEqual(w.engine.runtime.violations,[]);assert.equal(w.f.db.paidCost(),0);
  for(const words of ['run to the moon','row a boat','go fishing']){const no=await w.act(s,words);assert.equal(no.accepted,false,words);if(!no.accepted&&words==='row a boat')assert.equal(no.code,'ride.no-water-route');}
});
