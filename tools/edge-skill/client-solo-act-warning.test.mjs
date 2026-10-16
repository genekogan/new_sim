import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

// Quality lane (Oct 14 base-14 / base-32): a manual `act dance:here` with targetSoul was accepted as a solo dance and then reported as
// "danced with" the partner. The CLI must say, in the accepted result itself, that a person reference did not make the act shared.
async function mounted(t){
 const directory=mkdtempSync(join(tmpdir(),'solo-act-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const acts=[],server=createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  let body='';for await(const c of req)body+=c;
  if(req.url==='/v1/edge/here')return res.end(JSON.stringify({here:{}}));
  if(req.url==='/v1/edge/schema')return res.end(JSON.stringify({events:{kinds:{}}}));
  if(req.url==='/v1/edge/capabilities')return res.end(JSON.stringify({capabilities:[{id:'dance:here',verb:'dance',label:'Dance here',available:true},{id:'dance-with:s_peer',verb:'dance-with',label:'Dance with Liora Venn',available:true}]}));
  if(req.url==='/v1/edge/act'){const b=JSON.parse(body);acts.push(b);return res.end(JSON.stringify({accepted:true,receipt:{id:'r_'+acts.length,capability:b.capability,phase:'started'}}));}
  res.statusCode=404;res.end(JSON.stringify({error:{code:'not-found'}}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 writeFileSync(join(directory,'.eden-agent.json'),JSON.stringify({world:'http://127.0.0.1:'+server.address().port,soul:'s_fixture',token:'synthetic-token'}));
 const cli=resolve(process.env.EDEN_CAPABILITIES_TEST_CLI??'tools/edge-skill/eden-agent.mjs');
 const act=(...args)=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[cli,'act',...args],{cwd:directory,env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  const deadline=setTimeout(()=>{child.kill();reject(Error('act fixture deadline'));},8000);
  child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.once('error',reject);
  child.once('exit',code=>{clearTimeout(deadline);assert.equal(code,0,stderr);resolve(JSON.parse(stdout));});
 });
 return {act,acts};
}

test('a person reference on a solo manual act is flagged in the accepted result',async t=>{
 const {act,acts}=await mounted(t);
 const solo=await act('dance:here','{"targetSoul":"s_peer","seconds":30}');
 assert.equal(solo.accepted,true);assert.match(solo.warning,/targetSoul.*did not make this a shared act.*dance:here is a solo action/);
 assert.equal(acts[0].capability,'dance:here');
 const plain=await act('dance:here','{"seconds":30}');assert.equal(plain.warning,undefined,'no warning without a person reference');
 const paired=await act('dance-with:s_peer','{"seconds":30,"targetSoul":"s_peer"}');assert.equal(paired.warning,undefined,'an offered partner capability is the paired act');
});
