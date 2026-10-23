import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
test('paired status refreshes actual child and parent guidance without creating or selecting a Soul',async()=>{
 const parent=mkdtempSync(join(tmpdir(),'eden-status-guide-')),child=join(parent,'eden-soul');mkdirSync(child);
 const requests=[],server=createServer((req,res)=>{requests.push({method:req.method,path:req.url});res.setHeader('content-type','application/json');res.end(JSON.stringify({edge:{enabled:true}}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  writeFileSync(join(child,'.eden-agent.json'),JSON.stringify({world:'http://127.0.0.1:'+server.address().port,soul:'s_fixture',token:'synthetic-guide-token'}));
  writeFileSync(join(parent,'CLAUDE.md'),'Preserve existing owner rules.\n');
  const proc=spawn(process.execPath,[resolve('tools/edge-skill/eden-agent.mjs'),'status'],{cwd:child,stdio:['ignore','pipe','pipe']});let output='',error='';proc.stdout.on('data',b=>output+=b);proc.stderr.on('data',b=>error+=b);
  assert.equal(await new Promise(r=>proc.on('exit',r)),0,error);const result=JSON.parse(output);assert.equal(result.soul,'s_fixture');assert.equal(result.paired,true);
  assert.ok(readFileSync(join(parent,'CLAUDE.md'),'utf8').startsWith('Preserve existing owner rules.\n'));
  assert.ok(readFileSync(join(parent,'CLAUDE.md'),'utf8').includes('cd eden-soul && node eden-agent.mjs status'));
  assert.ok(existsSync(join(child,'AGENTS.md')));assert.ok(requests.every(r=>r.method==='GET'));
 }finally{await new Promise(r=>server.close(r));}
});
