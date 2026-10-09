import assert from 'node:assert/strict';
import test from 'node:test';
import {join} from 'node:path';
import {WebSocket} from 'ws';
import {eventsFixture} from './edge/events/testing.ts';
import {freshBootClock} from './edge/boot/clock.ts';
import {PersonalReminders,normalizeReminder} from './edge/reminders/reminders.ts';
import {mountPersonalReminders} from './edge/reminders/routes.ts';
import {Db} from './db.ts';
const setup=(f:ReturnType<typeof eventsFixture>)=>{Object.assign(f.host,{living:{origin:0,dayTicks:72000},clockRate:1,paused:false});return new PersonalReminders(f.db.db,f.host.worldId,f.runtime.streams,()=>freshBootClock(f.host,f.clock.now));};
const world=(clientRef:string,time='06:03')=>({clientRef,text:'Private advisory reminder',at:{clock:'world',worldDayIndex:0,time}});

test('reminders: explicit dates only, equivalent ISO offsets normalize, no guessed tomorrow/local time or recipients',()=>{
 assert.equal(normalizeReminder({clientRef:'same',text:' note ',at:{clock:'real',time:'2026-10-09T09:00:00-04:00'}}).dueRealMs,Date.parse('2026-10-09T13:00:00Z'));
 for(const at of [{clock:'world',day:1,time:'06:03'},{clock:'world',worldDayIndex:1,time:'tomorrow'},{clock:'real',time:'2026-10-09T09:00:00'},{clock:'real',time:'2026-02-30T09:00:00Z'},{clock:'real',time:'2026-10-09T09:00:00+15:00'}])assert.throws(()=>normalizeReminder({clientRef:'bad',text:'note',at}));
 assert.throws(()=>normalizeReminder({...world('x'),soulId:'other'}));
});

test('reminders: native/world/wall units, changed rate, paused world versus real deadline, idempotency and private scope',()=>{
 const f=eventsFixture(['Alice','Bob']);try{
  const r=setup(f),alice=f.id('Alice'),bob=f.id('Bob'),w=r.create(alice,world('world')).reminder;
  const realInput={clientRef:'real',text:'Real reminder',at:{clock:'real',time:new Date(f.clock.now+1000).toISOString()}},real=r.create(alice,realInput).reminder;
  assert.equal(r.create(alice,world('world')).reminder.id,w.id);assert.throws(()=>r.create(alice,world('world','06:04')),(e:any)=>e.code==='reminder.client-ref-conflict');
  assert.equal(r.list(bob,'all').total,0);assert.throws(()=>r.cancel(bob,w.id),(e:any)=>e.status===404);
  f.host.paused=true;f.host.clockRate=20;f.clock.now+=2000;r.pump();
  assert.equal(r.list(alice,'all').items.find(x=>x.id===real.id)!.state,'delivered');assert.equal(r.list(alice,'all').items.find(x=>x.id===w.id)!.state,'active');
  f.host.engine.world.tick=149;r.pump();assert.equal(r.list(alice,'all').items.find(x=>x.id===w.id)!.state,'active');
  f.host.engine.world.tick=150;r.pump();assert.equal(r.list(alice,'all').items.find(x=>x.id===w.id)!.state,'active','paused world targets remain deferred even at their boundary');
  f.host.paused=false;f.host.clockRate=.5;r.pump();r.pump();
  assert.equal(r.list(alice,'all').items.find(x=>x.id===w.id)!.state,'delivered');assert.equal(r.create(alice,world('world')).reminder.id,w.id,'stable ref replays after target is past');
  const events=f.runtime.streams.read(alice,0).events.filter(e=>e.kind==='reminder.due');assert.equal(events.length,2);assert.equal(f.runtime.streams.read(bob,0).events.length,0);
  const event=events.find(e=>(e.reminder as any).id===w.id)!;assert.equal((event.clocks as any).absoluteWorldMinutes,363);assert.equal((event.clocks as any).nativeSecondsPerWorldMinute,2.5);assert.equal(event.untrusted,true);
  const cancelled=r.create(alice,world('cancel','06:04')).reminder;assert.equal(r.cancel(alice,cancelled.id).cancelled,true);assert.equal(r.cancel(alice,cancelled.id).cancelled,true);
  f.host.engine.world.tick=300;r.pump();assert.equal(f.runtime.streams.read(alice,0).events.filter(e=>e.kind==='reminder.due').length,2);assert.equal(r.cancel(alice,w.id).alreadyDelivered,true);
  assert.equal(f.actor.acts.length,0,'reminder delivery executes no body action');
 }finally{f.destroy();}
});

test('reminders: due outbox survives actual SQLite close/reopen; stream insert and delivered marker roll back together',async()=>{
 let f=eventsFixture(['Alice']);const dir=f.dir,clock=f.clock;let r=setup(f);const alice=f.id('Alice'),created=r.create(alice,world('restart')).reminder;
 f.host.engine.world.tick=150;assert.equal(r.collectDue(),1);assert.equal(f.runtime.streams.read(alice,0).events.length,0);
 f.close();f.db.db.close();f=eventsFixture(['Alice'],{existing:{dir,db:new Db(join(dir,'world.db')),clock}});r=setup(f);f.host.engine.world.tick=150;
 try{
  let notified=0;f.runtime.streams.onEvent(()=>notified++);
  const deliver=f.runtime.streams.deliver.bind(f.runtime.streams);f.runtime.streams.deliver=((...args)=>{deliver(...args);throw Error('injected after stream insert, before outer commit');}) as typeof deliver;
  assert.throws(()=>r.drain(),/injected/);assert.equal(f.runtime.streams.read(alice,0).events.length,0);assert.equal(r.list(alice,'all').items[0].state,'due');assert.equal(notified,0,'no reminder subscriber saw the rolled-back nested event');
  f.runtime.streams.deliver=deliver;assert.equal(r.pump(),1);r.pump();assert.equal(f.runtime.streams.read(alice,0).events.length,1);assert.equal(r.list(alice,'all').items[0].id,created.id);assert.equal(r.list(alice,'all').items[0].state,'delivered');assert.equal(notified,1,'one committed reminder notification across retry');await Promise.resolve();
 }finally{f.destroy();}
});

test('reminder HTTP ownership/list/cancel and actual WS/wait delivery <=2s with independent timer while paused', {timeout:8000},async()=>{
 const f=eventsFixture(['Alice','Bob'],{comms:{now:Date.now}});Object.assign(f.host,{living:{origin:0,dayTicks:72000},clockRate:1,paused:true});
 const runtime=mountPersonalReminders(f.app,f.deps,f.runtime),ac=new AbortController();let ws:WebSocket|null=null;
 try{
  const host=await f.listen(),messages:any[]=[];ws=new WebSocket(`ws://${host}/v1/edge/events/ws`,{headers:{authorization:`Bearer ${f.id('Alice')}`}});
  ws.on('message',raw=>messages.push(JSON.parse(String(raw))));
  const until=(predicate:(m:any)=>boolean,ms=2000)=>new Promise<any>((resolve,reject)=>{
   const existing=messages.find(predicate);if(existing)return resolve(existing);
   const socket=ws!,done=()=>{clearTimeout(timer);socket.off('message',onMessage);socket.off('close',onClose);socket.off('error',onError);},onMessage=(raw:any)=>{const m=JSON.parse(String(raw));if(predicate(m)){done();resolve(m);}},onClose=()=>{done();reject(Error('WS closed before predicate'));},onError=()=>{done();reject(Error('WS error before predicate'));};
   const timer=setTimeout(()=>{done();reject(Error('WS message missed finite deadline'));},ms);socket.on('message',onMessage);socket.once('close',onClose);socket.once('error',onError);
  });
  await until(m=>m.type==='hello');
  const due=Date.now()+250,input={clientRef:'timer',text:'Private timed note',at:{clock:'real',time:new Date(due).toISOString()}},created=await f.post('Alice','/v1/edge/reminders',input);assert.equal(created.status,200);const id=created.body.reminder.id;
  assert.equal((await f.get('Bob','/v1/edge/reminders?state=all')).body.total,0);assert.equal((await f.del('Bob','/v1/edge/reminders/'+id)).status,404);assert.equal((await f.app.request('/v1/edge/reminders')).status,401);
  const event=await until(m=>m.type==='event'&&m.event?.kind==='reminder.due',Math.max(1,due-Date.now()+2000));const lateness=Date.now()-due;assert.ok(lateness>=0&&lateness<=2000,`due delivery ${lateness}ms late`);assert.equal(event.event.data.reminder.id,id);assert.equal(event.event.data.clocks.paused,true);
  const worldCreated=await f.post('Alice','/v1/edge/reminders',world('world-timer')),worldId=worldCreated.body.reminder.id;
  const worldBoundaryAt=Date.now(),worldArrives=until(m=>m.type==='event'&&m.event?.kind==='reminder.due'&&m.event.data.reminder.id===worldId,2000);
  f.host.paused=false;f.host.clockRate=5;f.host.engine.world.tick=150;
  const worldEvent=await worldArrives,worldLateness=Date.now()-worldBoundaryAt;assert.ok(worldLateness<=2000);assert.equal(worldEvent.event.data.clocks.absoluteWorldMinutes,363);
  const wait=await f.get('Alice','/v1/edge/wait?after=c_0&timeout=1');assert.ok(wait.body.events.some((e:any)=>e.kind==='reminder.due'&&e.reminder.id===id));assert.equal(f.actor.acts.length,0);
  runtime.close();assert.equal((await f.get('Alice','/v1/edge/reminders?state=all')).body.items[0].state,'delivered');console.log('REMINDER_TIMER_PROOF '+JSON.stringify({realLatenessMs:lateness,worldLatenessMs:worldLateness,realDeliveredWhilePaused:true,transport:'WS+wait',bodyActs:0}));
 }finally{runtime.close();ac.abort();ws?.terminate();f.destroy();}
});

test('existing calendar starting is atomic and once across repeat sweep and reload; legacy native-minute API retained',()=>{
 let f=eventsFixture(['Alice']);try{
  const calendar=f.runtime.objects.create({id:'test-calendar',kind:'calendar-item',name:'Calendar',placeId:'eden-commons',params:{title:'Meet',startsAtTick:101,durationTicks:100}});
  f.runtime.objects.act(calendar.id,f.deps.soul({req:{header:()=>`Bearer ${f.id('Alice')}`}} as any),{action:'interest',params:{}});
  f.host.engine.world.tick=101;const deliver=f.runtime.streams.deliver.bind(f.runtime.streams);
  f.runtime.streams.deliver=((...args)=>{deliver(...args);throw Error('calendar transport failure');}) as typeof deliver;
  assert.throws(()=>f.runtime.objects.sweep(),/calendar transport/);assert.equal((f.runtime.objects.all()[0].state as any).phase,'upcoming');assert.equal(f.runtime.streams.read(f.id('Alice'),0).events.filter(e=>e.kind==='schedule').length,0);
  f.runtime.streams.deliver=deliver;f.runtime.objects.sweep();f.runtime.objects.sweep();assert.equal(f.runtime.streams.read(f.id('Alice'),0).events.filter(e=>e.kind==='schedule').length,1);assert.equal(f.events.envelope(f.id('Alice'),f.runtime.streams.read(f.id('Alice'),0).events.find(e=>e.kind==='schedule')!).kind,'schedule.starting');
  const dir=f.dir,clock=f.clock;f.close();f.db.db.close();f=eventsFixture(['Alice'],{existing:{dir,db:new Db(join(dir,'world.db')),clock}});f.host.engine.world.tick=101;f.runtime.objects.sweep();assert.equal(f.runtime.streams.read(f.id('Alice'),0).events.filter(e=>e.kind==='schedule').length,1,'calendar phase survives real DB reopen without another starting event');
 }finally{f.destroy();}
});
