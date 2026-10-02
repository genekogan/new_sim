import test from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, servicesFor, ENGINE_INVARIANTS } from '../api/registry.ts';
import { livingDayWorld, livingDayScene, livingDayBindings, startLivingDay, tickLivingDay, readLivingDay, retryLivingDay, type LivingDayName } from '../scenarios/living-day.ts';
import { readPurposefulRoutine } from '../activities/purposeful-routine.ts';
import { readLivingIntention } from '../activities/living-intention.ts';
import { readBook } from '../objects/reading.ts';
import { readGarden } from '../objects/garden.ts';
import { heldBy } from '../items/model.ts';

function setup(name: LivingDayName) {
  const w=livingDayWorld(name);
  return new Runtime(w,createRegistry(),servicesFor({[w.base.campus]:livingDayScene(name)})(w),ENGINE_INVARIANTS);
}
function until(rt:Runtime,done:()=>boolean,max=18000) {
  for(let i=0;i<max&&!done();i++){rt.step();tickLivingDay(rt);if(rt.violations.length)break;}
  assert.deepEqual(rt.violations,[]);
  assert.ok(done(),JSON.stringify({day:readLivingDay(rt),active:[...rt.records.values()].filter(r=>rt.isActive(r.id))}));
}
function start(rt:Runtime,name:LivingDayName,assistant=false) {
  const r=startLivingDay(rt,name,{worker:assistant?'assistant':'original',workstation:'preferred'});
  assert.ok(!('code'in r));assert.notEqual(r.status,'failed',JSON.stringify(r));return r;
}
const routine=(rt:Runtime)=>readPurposefulRoutine(rt,readLivingDay(rt)!.routine!);
function control(rt:Runtime,verb:string,params:unknown){const r=rt.submit(verb,params,{preempt:false});assert.notEqual(r.status,'failed',JSON.stringify(r));}
function finished(rt:Runtime){until(rt,()=>readLivingDay(rt)?.phase==='completed');for(let i=0;i<2;i++)rt.step();assert.deepEqual(rt.violations,[]);for(const e of Object.values(rt.world.entities)){assert.deepEqual(rt.holder(`actor:${e.id}`),[]);assert.deepEqual(rt.holder(`entity:${e.id}`),[]);if(e.human)assert.deepEqual(heldBy(rt.world,e.id),[]);}assert.equal(rt.world.entities['water-bowl'].contents?.fraction,.25);}
for(const name of ['living-day-4','living-day-studio'] as LivingDayName[]) {
  test(`${name}: routine Pause/Resume preserves partial preparation and the same sleep purpose`,()=>{
    const rt=setup(name);start(rt,name,name==='living-day-studio');
    until(rt,()=> (routine(rt)?.preparation?.ingredients[0].deposited??0)>0);
    const id=readLivingDay(rt)!.routine!;
    control(rt,'purposeful_routine_control',{routine:id,intent:'pause'});until(rt,()=>routine(rt)?.mode==='paused');
    const prepared=structuredClone(routine(rt)!.preparation), work=structuredClone(routine(rt)!.progress);
    const quantities=Object.values(rt.world.entities).filter(e=>e.contents&&e.id!=='water-bowl').map(e=>[e.id,e.contents!.fraction]);
    for(let i=0;i<40;i++){rt.step();tickLivingDay(rt);}
    assert.deepEqual(routine(rt)!.preparation,prepared);assert.deepEqual(routine(rt)!.progress,work);
    assert.deepEqual(Object.values(rt.world.entities).filter(e=>e.contents&&e.id!=='water-bowl').map(e=>[e.id,e.contents!.fraction]),quantities);
    control(rt,'purposeful_routine_control',{routine:id,intent:'resume'});
    until(rt,()=>routine(rt)?.sleep?.mode==='sleeping'&&(routine(rt)?.sleep?.elapsed??0)>.5);
    const sleep=structuredClone(routine(rt)!.sleep!);
    control(rt,'purposeful_routine_control',{routine:id,intent:'pause'});until(rt,()=>routine(rt)?.mode==='paused');
    assert.equal(routine(rt)!.sleep!.action,sleep.action);assert.equal(routine(rt)!.sleep!.elapsed,sleep.elapsed);
    const actor=routine(rt)!.bindings.actor;assert.equal(rt.world.entities[actor].human!.sleepPose,undefined);assert.deepEqual(rt.holder(`actor:${actor}`),[]);assert.deepEqual(rt.holder('sleep-mat:mat'),[]);
    control(rt,'purposeful_routine_control',{routine:id,intent:'resume'});finished(rt);
    assert.equal(routine(rt)!.sleep!.action,sleep.action);assert.equal(routine(rt)!.preparation?.complete,true);assert.ok(routine(rt)!.progress.meal.every(p=>p.consumed&&p.returned));
  });
  test(`${name}: directing reader away retains the bookmark while carer continues independently`,()=>{
    const rt=setup(name);start(rt,name);
    until(rt,()=>{const b=readBook(rt,'book');return !('code'in b)&&b.elapsed>1&&b.elapsed<5;});
    const reader=readLivingDay(rt)!.independent[0],carer=readLivingDay(rt)!.independent[1];
    const direction=rt.submit('walk_to',{actor:'reader',x:14,z:7});assert.notEqual(direction.status,'failed');
    until(rt,()=>!rt.isActive(direction.id)&&readLivingIntention(rt,reader)?.mode==='paused');assert.equal(direction.status,'completed');
    const bookmark=structuredClone(readBook(rt,'book'));assert.ok(!('code'in bookmark));assert.equal(bookmark.status,'unfinished');
    until(rt,()=>{const p=readGarden(rt,'plant-a');return !('code'in p)&&p.cycles===1;});
    assert.deepEqual(readBook(rt,'book'),bookmark);assert.equal(readLivingIntention(rt,reader)?.mode,'paused');assert.notEqual(readLivingIntention(rt,carer)?.mode,'paused');
    control(rt,'living_intention_control',{intention:reader,intent:'resume'});finished(rt);
    const complete=readBook(rt,'book');assert.ok(!('code'in complete));assert.equal(complete.elapsed,24);assert.equal(complete.task,bookmark.task);assert.equal(complete.user,bookmark.user);
  });
  test(`${name}: occupied preferred computer selects only permitted auxiliary binding and preserves owner`,()=>{
    const rt=setup(name),b=livingDayBindings(name),owner=rt.submit('work_at',{...b.workBreak.work,actor:'day-neighbour',task:'Occupied preferred fixture',duration:120});
    assert.notEqual(owner.status,'failed',JSON.stringify(owner));start(rt,name,true);
    until(rt,()=>!!readLivingIntention(rt,readLivingDay(rt)!.initial)?.binding);
    const choice=readLivingIntention(rt,readLivingDay(rt)!.initial)!.binding!;
    assert.equal(choice.params.station,'aux-computer');assert.equal(choice.params.seat,'aux-chair#seat');assert.equal(choice.params.actor,'day-editor');assert.equal(rt.isActive(owner.id),true);assert.equal(owner.status,'executing');
    rt.cancel(owner.id);until(rt,()=>!rt.isActive(owner.id));finished(rt);assert.equal(routine(rt)!.bindings.work.station,'aux-computer');
  });
  test(`${name}: missing display declines transition, restoration requires explicit retry`,()=>{
    const rt=setup(name),id=livingDayBindings(name).session.displayId!,display=structuredClone(rt.world.entities[id]);delete rt.world.entities[id];start(rt,name);
    until(rt,()=>readLivingDay(rt)?.phase==='waiting');const refused=readLivingDay(rt)!;assert.equal(refused.diagnostic!.code,'object.unknown');assert.ok(refused.diagnostic!.subjects?.includes(id));assert.equal(rt.records.get(refused.session!)?.status,'failed');assert.equal(refused.routine,undefined);
    rt.world.entities[id]=display;for(let i=0;i<40;i++){rt.step();tickLivingDay(rt);}assert.equal(readLivingDay(rt)?.phase,'waiting');assert.equal(readLivingDay(rt)?.session,refused.session);
    assert.equal(retryLivingDay(rt),null);assert.equal(readLivingDay(rt)?.initial,refused.initial);assert.notEqual(readLivingDay(rt)?.session,refused.session);finished(rt);
  });
}
