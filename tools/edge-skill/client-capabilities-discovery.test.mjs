import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

async function mounted(t){
 const directory=mkdtempSync(join(tmpdir(),'capability-discovery-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const available=Array.from({length:120},(_,i)=>({id:'listen:seat-'+i,verb:'listen',label:'Listen at seat '+i,available:true}));
 available.push({id:'warm-by-fire:real-fire',verb:'warm-by-fire',label:'Warm up by the fire',available:true,params:{seconds:{type:'integer'}}});
 available.push({id:'wave:s_peer',verb:'wave',label:'Wave to Warming Willow',available:true});
 const blocked=Array.from({length:20},(_,i)=>({id:'sit:occupied-'+i,verb:'sit',label:'Occupied seat '+i,available:false,blocked:{code:'seat.occupied'}}));
 blocked.push({id:'warm-by-fire:closed-fire',verb:'warm-by-fire',label:'Warm up by the closed fire',available:false,blocked:{code:'fire.extinguished'}});
 const seen=[],server=createServer((req,res)=>{
  seen.push(req.method+' '+req.url);res.setHeader('content-type','application/json');
  if(req.url==='/v1/edge/here')return res.end(JSON.stringify({here:{}}));
  if(req.url==='/v1/edge/schema')return res.end(JSON.stringify({events:{kinds:{}}}));
  if(req.url==='/v1/edge/capabilities')return res.end(JSON.stringify({capabilities:[...available,...blocked]}));
  res.statusCode=404;res.end(JSON.stringify({error:{code:'not-found'}}));
 });
 const port=Number(process.env.EDEN_CAPABILITIES_TEST_PORT??0);assert.ok(Number.isInteger(port)&&port>=0&&port<=65535);
 await new Promise(r=>server.listen(port,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 writeFileSync(join(directory,'.eden-agent.json'),JSON.stringify({world:'http://127.0.0.1:'+server.address().port,soul:'s_fixture',token:'synthetic-token'}));
 const cli=resolve(process.env.EDEN_CAPABILITIES_TEST_CLI??'tools/edge-skill/eden-agent.mjs');
 const run=args=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[cli,'capabilities',...args],{cwd:directory,env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  const deadline=setTimeout(()=>{child.kill();reject(Error('capabilities fixture deadline'));},5000);
  child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.once('error',reject);
  child.once('exit',code=>{clearTimeout(deadline);resolve({code,stdout,stderr});});
 });
 const read=async args=>{const r=await run(args);assert.equal(r.code,0,r.stderr);return JSON.parse(r.stdout).canDo;};
 return {run,read,seen};
}

test('compact discovery discloses omissions and filters full offers before limiting them',async t=>{
 const {read,seen}=await mounted(t),compact=await read([]);
 assert.equal(compact.available.length,80);assert.equal(compact.blocked.length,15);
 assert.deepEqual(compact.totals,{available:122,blocked:21});
 assert.deepEqual(compact.matchingTotals,compact.totals);assert.deepEqual(compact.truncated,{available:true,blocked:true});
 assert.match(compact.hint,/omitted.*absence is not a refusal/);assert.match(compact.hint,/--search/);assert.match(compact.hint,/--verb/);
 assert.ok(!compact.available.some(c=>c.id.startsWith('warm-by-fire:')));
 for(const args of [['--search','WARM'],['--verb','warm-by-fire']]){
  const found=await read(args);assert.equal(found.available[0].id,'warm-by-fire:real-fire');
  assert.equal(found.blocked[0].id,'warm-by-fire:closed-fire');assert.equal(found.blocked[0].why,'fire.extinguished');
  assert.deepEqual(found.totals,{available:122,blocked:21});assert.deepEqual(found.truncated,{available:false,blocked:false});
  assert.deepEqual(found.matchingTotals,{available:args[0]==='--search'?2:1,blocked:1});
 }
 assert.ok(seen.every(path=>path.startsWith('GET ')),'discovery never dispatches a body action');
});

test('search matches full ID, verb and label, combines with an exact verb and distinguishes no matches',async t=>{
 const {read}=await mounted(t);
 assert.equal((await read(['--search','REAL-FIRE'])).available[0].id,'warm-by-fire:real-fire','case-insensitive ID search');
 assert.equal((await read(['--search','WARM-BY-FIRE'])).available.length,1,'verb text is searchable');
 assert.equal((await read(['--search','Warming Willow'])).available[0].id,'wave:s_peer','case-insensitive label search');
 assert.deepEqual((await read(['--search','warm','--verb','wave'])).available.map(c=>c.id),['wave:s_peer']);
 assert.deepEqual((await read(['--verb','warm'])).matchingTotals,{available:0,blocked:0},'verb filtering is exact');
 const missing=await read(['--search','not-present']);assert.deepEqual(missing.available,[]);assert.deepEqual(missing.blocked,[]);
 assert.deepEqual(missing.matchingTotals,{available:0,blocked:0});assert.deepEqual(missing.truncated,{available:false,blocked:false});
 assert.equal(missing.code,undefined,'empty search is not a canonical action refusal');assert.equal(missing.hint,undefined);
});

test('invalid discovery syntax refuses before reading world state',async t=>{
 const {run,seen}=await mounted(t);
 for(const args of [['warm'],['--search'],['--verb'],['--search',''],['--search','--verb','warm'],['--all'],['--verb','wave','--verb','listen']]){
  const result=await run(args);assert.equal(result.code,1,JSON.stringify(args));assert.match(result.stderr,/usage: capabilities/);
 }
 assert.deepEqual(seen,[],'malformed commands must not silently query a different capability view');
});
