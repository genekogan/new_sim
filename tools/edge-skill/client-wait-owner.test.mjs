// 1.9.6 (SOULSIM-H F1): a Soul busy with a walk ran `act X; wait 60 >/dev/null`, so a message typed mid-walk waited up to
// 65 s. The world now ends the wait when the owner writes (ownerWrote); wait takes the messages at once (a quick listen),
// returns them, prints them on stderr (seen even with stdout discarded) and keeps the world's ownerMark for the next wait.
import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {spawn} from 'node:child_process';import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {resolve,join} from 'node:path';
const json=(res,x)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(x));};
async function mounted(t,handler,initial){const dir=mkdtempSync(join(tmpdir(),'wait-owner-'));const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 writeFileSync(join(dir,'.eden-agent.json'),JSON.stringify({world:'http://127.0.0.1:'+server.address().port,soul:'s_pip',token:'sim_fixture',...initial}));
 const run=async args=>{const child=spawn(process.execPath,[resolve(process.env.R006_CLI_SOURCE??'tools/edge-skill/eden-agent.mjs'),...args],{cwd:dir,env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>child.kill('SIGTERM'),8000);child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);const code=await new Promise(r=>child.once('exit',r));clearTimeout(timer);assert.equal(code,0,err);return {d:JSON.parse(out),err};};
 return {run,state:()=>JSON.parse(readFileSync(join(dir,'.eden-agent.json'),'utf8'))};}
const msg={id:'msg_bench',text:'actually sit on the bench',state:'sent',sentAt:1700};
const world=(seen,{wrote})=>(req,res)=>{const u=new URL(req.url,'http://fixture');if(u.pathname==='/v1/edge/schema')return json(res,{events:{kinds:{}}});
 if(u.pathname==='/v1/edge/wait'){seen.push({path:'wait',ownerSince:u.searchParams.get('ownerSince')});const answer=wrote?{cursor:'c_3',events:[],ownerWrote:1,ownerMark:1701}:{cursor:'c_3',events:[],ownerMark:2500};return setTimeout(()=>json(res,answer),wrote?100:900);}
 if(u.pathname==='/v1/edge/inbox/listen'){seen.push({path:'listen',timeoutMs:u.searchParams.get('timeoutMs')});return json(res,{inbox:{connected:true,latest:{...msg,state:'delivered'}},backlog:[{...msg,state:'delivered'}]});}
 json(res,{});};
test('wait returns at once with the owner message when the world says the owner wrote; mark kept, stderr shows it',async t=>{
 const seen=[],m=await mounted(t,world(seen,{wrote:true}),{cursor:'c_2',ownerMark:1500});const begun=Date.now(),{d,err}=await m.run(['wait','60']);
 assert.ok(Date.now()-begun<5000,'not the 60 s');
 assert.equal(seen[0].ownerSince,'1500','sends the stored mark');assert.deepEqual(seen.filter(x=>x.path==='listen').map(x=>x.timeoutMs),['0'],'one quick listen');
 assert.deepEqual(d.ownerMessages,[{id:'msg_bench',text:'actually sit on the bench',sentAt:1700}]);assert.match(d.ownerNote,/Ack each now/);
 assert.match(err,/OWNER MESSAGE \{"id":"msg_bench","text":"actually sit on the bench"/);assert.match(err,/Ack each now/);
 assert.equal(m.state().ownerMark,1701);assert.equal(m.state().cursor,'c_3');
});
test('without an owner message wait keeps waiting and takes no listen; a world without ownerMark leaves the state alone',async t=>{
 const seen=[],m=await mounted(t,world(seen,{wrote:false}),{cursor:'c_2'});const {d}=await m.run(['wait','2']);
 assert.equal(seen[0].ownerSince,null,'no mark yet: the world starts from now');assert.ok(seen.every(x=>x.path==='wait'));
 assert.equal(d.ownerMessages,undefined);assert.equal(m.state().ownerMark,2500);
});
