// 1.9.17 (LINK): the Soul's public `now` line. --now "<line>" rides on act, say, ack, result (JSON body) and wait (query);
// `now "<line>"` / `now --clear` set it alone; status shows `now` and the owner's link state; the fade guard is gone.
import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {spawn} from 'node:child_process';import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {resolve,join} from 'node:path';
import {takeNowFlag,cleanNowText,NOW_MAX,SKILL_VERSION} from './eden-agent.mjs';
const json=(res,x,status=200)=>{res.statusCode=status;res.setHeader('content-type','application/json');res.end(JSON.stringify(x));};
const body=req=>new Promise(r=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>r(b?JSON.parse(b):null));});
async function mounted(t){const seen=[];const dir=mkdtempSync(join(tmpdir(),'now-'));
 const server=createServer(async(req,res)=>{const u=new URL(req.url,'http://fixture'),b=await body(req);seen.push({method:req.method,path:u.pathname,query:Object.fromEntries(u.searchParams),body:b});
  if(u.pathname==='/v1/edge/schema')return json(res,{events:{kinds:{}}});
  if(u.pathname==='/v1/edge/act')return json(res,{accepted:true,receipt:{id:'r_1',phase:'accepted',capability:'wander:here'}});
  if(u.pathname==='/v1/edge/say')return json(res,{said:{text:b?.text,heardBy:[]}});
  if(/^\/v1\/edge\/inbox\/[^/]+\/(ack|result)$/.test(u.pathname))return json(res,{inbox:{connected:true,latest:{id:'msg_1',text:'sit',state:'acknowledged',sentAt:1}}});
  if(u.pathname==='/v1/edge/wait')return json(res,{cursor:'c_3',events:[],ownerMark:5});
  if(u.pathname==='/v1/edge/self/now')return json(res,{ok:true,now:b.text===null?null:{text:b.text,at:7}});
  if(u.pathname==='/v1/edge/self/link')return json(res,{soulId:'s_pip',link:{state:'connected',reason:'listening',since:3,holder:{label:'eden-agent 1.9.17',since:2}},now:{text:'Rowing',at:7}});
  json(res,{});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 writeFileSync(join(dir,'.eden-agent.json'),JSON.stringify({world:'http://127.0.0.1:'+server.address().port,soul:'s_pip',token:'sim_fixture',cursor:'c_2'}));
 const run=async(args,want=0)=>{const child=spawn(process.execPath,[resolve(process.env.R006_CLI_SOURCE??'tools/edge-skill/eden-agent.mjs'),...args],{cwd:dir,env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>child.kill('SIGTERM'),8000);child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);const code=await new Promise(r=>child.once('exit',r));clearTimeout(timer);assert.equal(code,want,err);return {out,err,d:want===0?JSON.parse(out):null};};
 return {run,seen};}

test('takeNowFlag removes the flag and its value; the line is cleaned and limited to 140 characters',()=>{
 assert.deepEqual(takeNowFlag(['wander','--now','Heading out']),['wander']);
 assert.deepEqual(takeNowFlag(['msg_1','On my way']),['msg_1','On my way']);
 assert.throws(()=>takeNowFlag(['wander','--now']),/usage: --now/);
 assert.equal(cleanNowText('  two\nlines\tand\u0007bell  '),'two lines and bell');
 assert.equal(cleanNowText('x'.repeat(NOW_MAX)).length,140);
 assert.throws(()=>cleanNowText('x'.repeat(141)),/at most 140/);
 assert.equal(cleanNowText('   '),null);
});

test('--now rides on act, say, ack, result (body) and wait (query), once each, and is never sent elsewhere',async t=>{
 const m=await mounted(t);
 await m.run(['act','wander:here','--now','Heading out for a walk']);
 const act=m.seen.find(x=>x.path==='/v1/edge/act');assert.equal(act.body.now,'Heading out for a walk');assert.equal(act.body.capability,'wander:here');
 await m.run(['say','hello','there','--now','Saying hello']);
 assert.equal(m.seen.find(x=>x.path==='/v1/edge/say').body.now,'Saying hello');assert.equal(m.seen.find(x=>x.path==='/v1/edge/say').body.text,'hello there');
 await m.run(['ack','msg_1','On my way','--now','Heading to the bench']);
 const ack=m.seen.find(x=>x.path.endsWith('/ack'));assert.equal(ack.body.now,'Heading to the bench');assert.equal(ack.body.reply,'On my way');
 await m.run(['result','msg_1','done','Sat down','--now','Resting on the bench']);
 const res=m.seen.find(x=>x.path.endsWith('/result'));assert.equal(res.body.now,'Resting on the bench');assert.equal(res.body.text,'Sat down');
 await m.run(['wait','1','--now','Waiting for the boat']);
 assert.equal(m.seen.find(x=>x.path==='/v1/edge/wait').query.now,'Waiting for the boat');
 assert.equal(m.seen.filter(x=>x.path==='/v1/edge/self/now').length,0,'carried, never sent alone');
 assert.equal(m.seen.filter(x=>x.body&&Object.hasOwn(x.body,'now')).length,4);
});

test('now sets the line alone, --clear clears it; a too-long line refuses before any world call',async t=>{
 const m=await mounted(t);
 assert.deepEqual((await m.run(['now','Looking','for','someone','to','row','with'])).d.now,{text:'Looking for someone to row with',at:7});
 assert.deepEqual(m.seen.at(-1).body,{text:'Looking for someone to row with'});
 assert.equal((await m.run(['now','--clear'])).d.now,null);assert.deepEqual(m.seen.at(-1).body,{text:null});
 const before=m.seen.length;const r=await m.run(['act','wander:here','--now','y'.repeat(141)],1);
 assert.match(r.err,/at most 140/);assert.equal(m.seen.length,before,'no call made');
 await m.run(['now'],1);
});

test('status shows link and now, and no fade colour or keep-alive advice',async t=>{
 const m=await mounted(t);const {d}=await m.run(['status']);
 assert.deepEqual(d.link,{state:'connected',reason:'listening',since:3,holder:{label:'eden-agent 1.9.17',since:2}});
 assert.deepEqual(d.now,{text:'Rowing',at:7});
 assert.equal(d.fade,undefined);assert.equal(d.keepAlive,undefined);assert.equal(d.skillVersion,SKILL_VERSION);
});
