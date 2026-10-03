// Accelerated real host/minds; no action driver or timetable. Decisions are the fake/fallback chooser.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { marsFactory } from '../packages/engine-mars/src/index.ts';
import { kernelHash } from '../packages/kernel/src/index.ts';
import { Db } from '../apps/server/src/db.ts';
import { WorldHost } from '../apps/server/src/world.ts';
import { LivingWorld } from '../apps/server/src/living.ts';
import { CampCards } from '../apps/server/src/camp.ts';
import { Brain } from '../apps/server/src/brain.ts';
import { config } from '../apps/server/src/config.ts';
import { worldDefinition } from '../apps/server/src/world-config.ts';

const days = Number(process.env.SOAK_DAYS ?? 48), dir = process.env.SOAK_DIR;
if (!dir) throw new Error('SOAK_DIR is required and must be an isolated proof directory');
mkdirSync(dir,{recursive:true});
const db = new Db(join(dir,'sim.db')), factory = await marsFactory(), def = worldDefinition('mars');
const host = new WorldHost(db,factory,'camp-soak',6000,'mars-1'); host.boot();
void host.enqueue('rules','world',{runtimePolicy:{sleepBlockTicks:1200},why:'bounded live-card sleep blockage, applied prospectively'});
const living = new LivingWorld(host); living.camp = true; void living.install(def.customs);
const pack = new CampCards(host); void pack;
for (const n of def.cast) {
  db.createSoul({id:`s_${n.name}`,entityId:`h_${n.name}`,worldId:host.worldId,owner:'proof-owner',name:n.name,description:n.description,native:false});
  void host.enqueue('birth','test',{soulId:`s_${n.name}`,entityId:`h_${n.name}`,owner:'proof-owner',name:n.name,description:n.description});
}
const brain = new Brain(host,db,{...config,brainMode:'fake',budgetUsdPerDay:1,typesafeKey:undefined,anthropicKey:undefined},{clients:()=>0,onCall:()=>{},onCamera:()=>{},onTicker:()=>{},onNarrative:()=>{},onTalk:()=>{}});
void brain;
const starts = new Map<string,{card:string;soul:string}>(), success: Record<string, Record<string,number>> = {}, failures: Record<string,number> = {}, attendance:Record<string,Set<string>> = {};
host.listeners.push({onApplied:e=>{
  if(e.payload?.recovery){writeFileSync(join(dir,'recovery-failure.json'),JSON.stringify(e,null,2));throw Error(`Physical recovery is a failed soak: ${e.payload.recovery.reason}`);}
  if (e.kind==='decision' && !e.payload.continue) {
    const p = e.payload, m = host.minds.get(p.soulId); if (m?.pending) starts.set(m.pending.program,{card:p.card??p.option,soul:m.name});
  }
},onProgram: ev=> {
  const st = starts.get(ev.id); if (!st || !['completed','failed','cancelled'].includes(ev.kind)) return;
  starts.delete(ev.id);
  const day = Math.floor(ev.tick / 72000);
  if (ev.kind==='completed') {
    const key=`${day}:${st.soul}`, counts=success[key]??={}; counts[st.card]=(counts[st.card]??0)+1;
    if (/shared meal|fire circle|warmup|class session|computer music/.test(st.card)) {
      const key = `${day}:${st.card.replace(/ (alice|bob|carol|david)$/,'')}`;
      const set=attendance[key]??=new Set();
      for (const m of host.minds.values()) if (/talk|eat|warm|listen|watch|exercise/.test(host.engine.world.entities[m.entityId].human!.activity)) set.add(m.name);
      set.add(st.soul);
    }
  } else if (ev.kind==='failed') failures[ev.code??'unknown']=(failures[ev.code??'unknown']??0)+1;
}});
let restarted=false;
const rows: unknown[] = [];
for (let day=1;day<=days;day++) {
  const begin=performance.now(), samples: number[]=[];
  while (host.engine.world.tick < day*72000) {
    const start=performance.now(); host.tickOnce(); samples.push(performance.now()-start);
    if (samples.length>72000) samples.shift();
    // Let journal enqueue/settle and error callbacks complete at a bounded cadence.
    if (host.engine.world.tick%100===0) await setImmediate();
    if (!restarted && [...host.engine.runtime.records.values()].some(r=>r.verb==='shared_food_break' && ['executing','blocked'].includes(r.status) && r.phase==='eating')) {
      void host.enqueue('rules','proof',{checkpoint:'mid-supper'}); host.drainInputs();
      const fresh = new WorldHost(db,factory,'camp-soak',6000,host.worldId); fresh.boot();
      assert.equal(fresh.engine.stateHash(),host.engine.stateHash(),'mid-supper exact engine restart');
      assert.equal(kernelHash(fresh.kernel),kernelHash(host.kernel),'mid-supper exact meaning restart');
      for (const [id,m] of host.minds) assert.deepEqual(fresh.minds.get(id)?.life,m.life,'mid-supper needs/journal restart');
      restarted=true;
    }
    for (const r of host.engine.runtime.records.values()) if (r.verb==='shared_food_break' && r.phase==='eating' && ['executing','blocked'].includes(r.status)) {
      const key=`${Math.floor(host.engine.world.tick/72000)}:shared-supper:${r.id}`, set=attendance[key]??=new Set();
      for (const q of (r.params as {participants?:{actor:string}[]}).participants??[]) { const m=host.mindByEntity.get(q.actor); if(m) set.add(m.name); }
    }
    if (host.engine.runtime.violations.length) writeFileSync(join(dir,'failure.json'),JSON.stringify({violations:host.engine.runtime.violations,world:host.engine.world,records:[...host.engine.runtime.records.values()],events:db.tailEvents(host.worldId,50)},null,2));
    assert.equal(host.engine.runtime.violations.length,0,JSON.stringify(host.engine.runtime.violations));
  }
  globalThis.gc?.();
  const row={day,tick:host.engine.world.tick,wallSec:(performance.now()-begin)/1000,msPerTick:samples.reduce((a,b)=>a+b,0)/samples.length,heap:process.memoryUsage().heapUsed,records:host.engine.runtime.records.size,quiet:host.quietBarrier,lastCompactedDay:host.living?.lastDay,faults:structuredClone(host.extra.cardFaults??{}),needs:structuredClone(Object.fromEntries([...host.minds.values()].map(m=>[m.name,m.life?.needs]))),journals:Object.fromEntries([...host.minds.values()].map(m=>[m.name,m.life?.journal])),activities:Object.fromEntries(def.cast.map(n=>[n.name,success[`${day-1}:${n.name}`]??{}]))};
  rows.push(row); console.log(JSON.stringify(row));
  writeFileSync(join(dir,'report.json'),JSON.stringify({days:day,rows,restarted,failures,attendance:Object.fromEntries(Object.entries(attendance).map(([k,s])=>[k,[...s]])),spend:db.paidCost(),built:Object.fromEntries(Object.entries(host.engine.world.entities).filter(([id])=>/^(upright-|beam-|joist-|sheet-|lookout-stair|tread-)/.test(id)).map(([id,e])=>[id,{phase:(e as any).phase,support:(e as any).support}]))},null,2));
}
assert.equal(db.paidCost(),0);
assert.ok(restarted,'actual mid-supper engine, meaning and mind restart was observed');
const typed=rows as {day:number;heap:number;msPerTick:number;lastCompactedDay:number;activities:Record<string,Record<string,number>>}[];
for (const r of typed) assert.ok(r.lastCompactedDay>=r.day-2,'daily quiet barrier continues to release');
const avg=(rs:typeof typed,key:'heap'|'msPerTick')=>rs.reduce((s,r)=>s+r[key],0)/rs.length;
const first=typed.slice(0,4),last=typed.slice(-4);
assert.ok(avg(last,'heap') <= avg(first,'heap')*1.25+5_000_000,'heap remains bounded');
assert.ok(avg(last,'msPerTick') <= avg(first,'msPerTick')*1.2,'late tick time within twenty percent');
const coherence=def.cast.map(n=>{
  const sets=typed.map(r=>new Set(Object.keys(r.activities[n.name])));
  const similarities=sets.slice(1).map((b,i)=>{const a=sets[i],u=new Set([...a,...b]);return u.size?[...a].filter(x=>b.has(x)).length/u.size:1;});
  const variety=sets.map(s=>s.size); assert.ok(variety.every(v=>v>=3),`${n.name} has daily variety`);
  return {soul:n.name,variety,daySimilarity:similarities};
});
writeFileSync(join(dir,'qualification.json'),JSON.stringify({days,spend:0,restarted,earlyMs:avg(first,'msPerTick'),lateMs:avg(last,'msPerTick'),earlyHeap:avg(first,'heap'),lateHeap:avg(last,'heap'),coherence,sharedMoments:Object.fromEntries(Object.entries(attendance).map(([k,v])=>[k,[...v]]))},null,2));
db.close();
