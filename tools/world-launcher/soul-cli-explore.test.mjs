import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const CLI=fileURLToPath(new URL('./soul/eden.mjs',import.meta.url));

test('explore and around preserve query routes, unknown candidates and explicit missing-route diagnostics',async t=>{
 const seen=[],around={places:[{id:'commons',name:'Local Commons'}]};
 const routes={
  'harbour west pier':{query:'harbour west pier',found:true,to:{id:'pier',name:'West Pier'},walk:'walk:pier',distance:172},
  'live music':{query:'live music',found:true,kind:'purpose',code:'capability.choose',candidates:[{capability:'walk:stage',name:'Performance Stage',available:true,matched:['live','music'],unverified:[]}],note:'Purpose does not confirm an event is happening now.'},
  'unknown place':{query:'unknown place',found:false,reason:'No destination matches',candidates:[{id:'other',name:'Other Place'}]},
 };
 const server=createServer((req,res)=>{const url=new URL(req.url,'http://localhost'),query=url.searchParams.get('to');seen.push({path:url.pathname,query});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({around,...(routes[query]?{route:routes[query]}:{})}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const dir=mkdtempSync(join(tmpdir(),'eden-explore-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 writeFileSync(join(dir,'.eden-agent.json'),JSON.stringify({world:`http://127.0.0.1:${server.address().port}`,token:'test-token'}));
 const cli=(...args)=>new Promise((yes,no)=>execFile(process.execPath,[CLI,...args],{cwd:dir},(err,out,stderr)=>err?no(Error(stderr||err.message)):yes(JSON.parse(out))));
 assert.deepEqual(await cli('explore'),around,'no-query surroundings remain compatible');
 for(const command of ['explore','around']){
  assert.deepEqual(await cli(command,'harbour','west','pier'),{...around,route:routes['harbour west pier']});
  assert.deepEqual(await cli(command,'live music'),{...around,route:routes['live music']},'purpose choices retain executable IDs and evidence');
  assert.deepEqual(await cli(command,'unknown place'),{...around,route:routes['unknown place']},'unknown routes and ranked candidates must not disappear');
 }
 const missing=await cli('explore','old server query');assert.equal(missing.route.query,'old server query');assert.equal(missing.route.found,false);assert.match(missing.route.reason,/resolve.*caps/);
 assert.deepEqual(seen.map(x=>x.query),[null,'harbour west pier','live music','unknown place','harbour west pier','live music','unknown place','old server query']);assert.ok(seen.every(x=>x.path==='/v1/edge/around'));
});
