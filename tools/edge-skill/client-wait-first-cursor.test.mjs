// r3 resident-quality battery case 26: a guest folder that never read its stream ran `here`, the host's high-five
// invitation arrived, then the guest's first `wait` (no stored cursor) asked the server for events "from now" and the
// invitation was never delivered; it expired. The first wait now reads from c_0, so the invite is delivered at once.
import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {spawn} from 'node:child_process';import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {resolve,join} from 'node:path';
const json=(res,x)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(x));};
async function mounted(t,handler,initial){const dir=mkdtempSync(join(tmpdir(),'wait-first-'));const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 writeFileSync(join(dir,'.eden-agent.json'),JSON.stringify({world:'http://127.0.0.1:'+server.address().port,soul:'s_guest',...initial}));
 const run=async args=>{const child=spawn(process.execPath,[resolve(process.env.R006_CLI_SOURCE??'tools/edge-skill/eden-agent.mjs'),...args],{cwd:dir,env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>child.kill('SIGTERM'),5000);child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);const code=await new Promise(r=>child.once('exit',r));clearTimeout(timer);assert.equal(code,0,err);return JSON.parse(out);};
 return {run,state:()=>JSON.parse(readFileSync(join(dir,'.eden-agent.json'),'utf8'))};}
const stream=[{id:'c_1',kind:'arrival',text:'Sage Vale is near.'},{id:'c_2',kind:'invite',from:'Sage Vale',text:'Sage Vale offers you a high five',invite:{id:'inv_hf',what:'high-five',from:{soulId:'s_host',name:'Sage Vale'},expiresInSeconds:30,accept:'accept:inv_hf',decline:'decline:inv_hf'}}];
const server=seen=>(req,res)=>{const u=new URL(req.url,'http://fixture');if(u.pathname==='/v1/edge/schema')return json(res,{events:{kinds:{}}});
 if(u.pathname==='/v1/edge/wait'){const after=u.searchParams.get('after');seen.push(after);if(after===null)return json(res,{cursor:'c_2',events:[]});const n=Number(after.slice(2)),events=stream.filter(e=>Number(e.id.slice(2))>n);return json(res,{cursor:events.at(-1)?.id??after,events});}json(res,{});};
test('first wait in a folder with no stored cursor reads from c_0 and delivers an invitation that arrived before it',async t=>{
 const seen=[],m=await mounted(t,server(seen),{});const d=await m.run(['wait','2']);
 assert.equal(seen[0],'c_0','never "from now"');assert.ok(d.events.some(e=>e.kind==='invite'),JSON.stringify(d));
 assert.equal(d.invites?.[0]?.id,'inv_hf');assert.equal(d.invites[0].accept,'act accept:inv_hf');assert.equal(d.cursor,'c_2');assert.equal(m.state().cursor,'c_2');
});
test('a stored cursor is still honoured exactly',async t=>{
 const seen=[],m=await mounted(t,server(seen),{cursor:'c_1'});const d=await m.run(['wait','2']);
 assert.equal(seen[0],'c_1');assert.deepEqual(d.events.map(e=>e.kind),['invite']);
});
