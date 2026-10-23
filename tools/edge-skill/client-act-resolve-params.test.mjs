import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

test('resolve and act preserve the same trailing JSON params and activity intent flags',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'eden-act-resolve-')),requests=[];
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const data=body?JSON.parse(body):null;requests.push({path:req.url,body:data});res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url==='/v1/edge/resolve'?{resolve:{ok:true,would:data}}:req.url==='/v1/edge/act'?{accepted:false,code:'fixture.no-action',reason:'captured only'}:{edge:{enabled:true},capabilities:[]}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 writeFileSync(join(folder,'.eden-agent.json'),JSON.stringify({world:'http://127.0.0.1:'+server.address().port,soul:'s_fixture',token:'synthetic-only'}));
 const run=async args=>{const child=spawn(process.execPath,[resolve(process.env.R006_CLI_SOURCE??'tools/edge-skill/eden-agent.mjs'),...args],{cwd:folder,stdio:['ignore','pipe','pipe']});let output='',err='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>err+=b);assert.equal(await new Promise(r=>child.once('exit',r)),0,err);return JSON.parse(output);};
 const params={seconds:60,with:['s_peer']};
 for(const args of [['read:library',JSON.stringify(params)],['read','--place','library','--seconds','60','--with','Fixture Peer']]){
  await run(['resolve',...args]);const dry=requests.filter(x=>x.path==='/v1/edge/resolve').at(-1).body;
  await run(['act',...args,'--force']);const act=requests.filter(x=>x.path==='/v1/edge/act').at(-1).body;delete act.clientRef;
  assert.deepEqual(dry,act,'dry run must send the same owner intent, not JSON embedded in capability words');
  if(args[0].includes(':'))assert.deepEqual(dry,{capability:'read:library',params});else assert.deepEqual(dry,{verb:'read',target:{place:'library',seconds:60,with:'Fixture Peer'}});
 }
 await run(['resolve','read:library','--force',JSON.stringify(params)]);
 assert.deepEqual(requests.filter(x=>x.path==='/v1/edge/resolve').at(-1).body,{capability:'read:library',params},'local force flag is not part of dry-run words');
});
