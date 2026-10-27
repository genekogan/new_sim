import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {once} from 'node:events';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const {conversationStartBody,CONVERSATION_MAX_INVITEES,SKILL_VERSION}=await import(new URL('../../../tools/edge-skill/eden-agent.mjs',import.meta.url).href);

void test('conversation start keeps the old single form and adds explicit unique group recipients',()=>{
 assert.deepEqual(conversationStartBody('s_first','Hello','friend'),{op:'start',with:['s_first'],text:'Hello friend'});
 assert.deepEqual(conversationStartBody('s_first'),{op:'start',with:['s_first']});
 assert.deepEqual(conversationStartBody('--with',' s_first,s_second,s_first ','Hello both'),{op:'start',with:['s_first','s_second'],text:'Hello both'});
 assert.deepEqual(conversationStartBody(['s_first','s_second','s_first'],'Hello both'),{op:'start',with:['s_first','s_second'],text:'Hello both'});
 const ids=Array.from({length:8},(_,i)=>'s_'+i);assert.deepEqual(conversationStartBody('--with',ids.join(',')).with,ids);
 const backend=readFileSync(new URL('./edge/comms/converse.ts',import.meta.url),'utf8');
 assert.equal(Number(/MAX_INVITEES\s*=\s*(\d+)/.exec(backend)![1]),CONVERSATION_MAX_INVITEES,'CLI limit matches existing backend');
 const skill=readFileSync(new URL('../../../tools/edge-skill/SKILL.md',import.meta.url),'utf8');
 const metadata=/^metadata:\n  version: "(\d+\.\d+\.\d+)"\n  contract: (\S+)\n  apiContract: (\S+)$/m.exec(skill);
 assert.ok(metadata,'published skill has versioned wire-contract metadata');
 assert.equal(metadata[1],SKILL_VERSION,'served CLI and skill advertise the same release');
 assert.equal(metadata[2],'eden-edge/1');assert.equal(metadata[3],'eden-edge/1.1');
 assert.ok(skill.includes(`# Eden — skill ${SKILL_VERSION}\n`),'guide heading agrees with the served version');
 assert.match(skill,/wire contract remains `eden-edge\/1`/);
});

void test('invalid group entries refuse rather than losing a recipient or inventing a target',()=>{
 for(const list of ['',',','s_first,','s_first,,s_second','s_first,unknown','["s_first","s_second"]','--other'])assert.throws(()=>conversationStartBody('--with',list));
 assert.throws(()=>conversationStartBody('--with'));
 assert.throws(()=>conversationStartBody('--with',Array.from({length:9},(_,i)=>'s_'+i).join(',')),/at most 8/);
 assert.throws(()=>conversationStartBody(['s_first','']));assert.throws(()=>conversationStartBody(undefined));
});

void test('published group argv sends one invitation POST, preserves backend refusals, and never accepts peers for them',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cli-group-converse-')),sent:unknown[]=[],fixtureKey='synthetic-cli-only';
 const server=createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  if(!req.url?.endsWith('/converse')){res.statusCode=404;res.end('{}');return;}
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
  const body=JSON.parse(Buffer.concat(chunks).toString());sent.push(body);
  res.end(JSON.stringify(body.text==='too far'?{accepted:false,code:'conversation.out-of-range',reason:'Invitees must be within 6 m.'}:{accepted:true,conversation:'cv_synthetic',invited:body.with}));
 });
 try{
  server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');
  const cli=fileURLToPath(new URL('../../../tools/edge-skill/eden-agent.mjs',import.meta.url));
  writeFileSync(join(dir,'.eden-agent.json'),JSON.stringify({world:`http://127.0.0.1:${address.port}/w/eden`,soul:'s_synthetic',token:fixtureKey,mode:'edge'}),{mode:0o600});
  const run=async(...args:string[])=>{const {stdout}=await promisify(execFile)(process.execPath,[cli,'converse','start',...args],{cwd:dir,timeout:10000});assert.ok(!stdout.includes(fixtureKey));return JSON.parse(stdout);};
  assert.equal((await run('s_first','Hello friend')).accepted,true);
  const group=await run('--with','s_first,s_second,s_first','Hello both');assert.equal(group.accepted,true);assert.deepEqual(group.invited,['s_first','s_second']);assert.equal(group.members,undefined,'CLI does not manufacture joined membership');
  const refused=await run('--with','s_first,s_second','too far');assert.equal(refused.accepted,false);assert.equal(refused.code,'conversation.out-of-range');
  assert.deepEqual(sent,[{op:'start',with:['s_first'],text:'Hello friend'},{op:'start',with:['s_first','s_second'],text:'Hello both'},{op:'start',with:['s_first','s_second'],text:'too far'}]);
  await assert.rejects(run('--with','s_first,,s_second'));assert.equal(sent.length,3,'invalid group must issue no request');
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(dir,{recursive:true,force:true});}
});
