import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,chmodSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {openClientQueue} from './client-queue.mjs';
const source='book:gardens-guide@1#p2',title="A Field Guide to Eden's Gardens";
const completedRead={id:'r_read',capability:'read:library',phase:'completed',acceptedTick:1,startedTick:1,endedTick:10,endedAt:{place:'library',placePath:['Library'],posture:'standing'},outcome:{contract:'eden-edge/1.1',kind:'read',summary:`Read ${title}, passage 2 of 3.`,learned:[{fact:'The fictional gardener leaves blank pages for later corrections.',source,provenance:'authored-content'}],detail:{book:{id:'book:gardens-guide',title,chapter:2,of:3},passage:'Original fictional passage.',contentVersion:'fixture/1'}}};
const report=`I actually read ${title}, passage 2 of 3, from ${source} (authored fiction). The return to Commons is still walking.`;
async function fixture(t,{reply,replies,liveArgs=[],requestText='Tell me what you actually read, with its source. Preserve the current return.',seedReading=false,completeReturn=false,walkAdmissionDelayMs=0}={}){
 const root=mkdtempSync(join(realpathSync(tmpdir()),'owner-report-mounted-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'bin'));
 const fake=join(root,'bin','claude');writeFileSync(fake,`#!${process.execPath}\nlet input='',i=0;const replies=${JSON.stringify(replies??[reply])},scripted=${!!replies};process.stdin.on('data',chunk=>{input+=chunk;let cut;while((cut=input.indexOf('\\n'))>=0){input=input.slice(cut+1);console.log(JSON.stringify({type:'result',result:JSON.stringify(replies[scripted?i++:0]??{do:[]}),usage:{input_tokens:100,output_tokens:20,cache_read_input_tokens:0,cache_creation_input_tokens:0}}));}});`);chmodSync(fake,0o700);
 const streams=new Set(),requests=[],timeline=[],timers=new Set(),startedAt=Date.now();let walkCompleted=false;
 const trace=(kind,extra={})=>timeline.push({ms:Date.now()-startedAt,kind,...extra});
 const later=(fn,ms)=>{const timer=setTimeout(()=>{timers.delete(timer);fn();},ms);timers.add(timer);};t.after(()=>{for(const timer of timers)clearTimeout(timer);});
 const sendCompletion=res=>{trace('completion-event');res.write('event: message\nid: c_walk\ndata: '+JSON.stringify({id:'c_walk',kind:'receipt.completed',salience:2,data:{receipt:walk()}})+'\n\n');};
 const walk=()=>({id:'r_walk',capability:'walk:commons',phase:walkCompleted?'completed':'started',...(completeReturn?{endedAt:{place:'commons',placePath:['Commons'],posture:'standing'},outcome:{summary:'walk completed at commons.'}}:{})});
 const here=()=>({tick:20,me:{place:seedReading?'library':'field',placePath:[seedReading?'Library':'Commons'],pos:[0,0],posture:seedReading?'walking':'standing',activity:{kind:seedReading?'walk':'idle'}},near:[],objects:[],doHere:[],exits:[]});
 const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://fixture').pathname;const json=x=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(x));};
  if(path==='/v1/me')return json({souls:[{id:'s_probe',name:'Probe'}]});
  if(path==='/v1/edge/here')return json({here:here()});
  if(path==='/v1/edge/boot')return json({worldId:'owner-report-fixture',apiContract:'eden-edge/1.1',staticEtag:'v1',static:{places:[{id:'field',name:'Commons',walkable:true},{id:'library',name:'Library',walkable:true}]},here:here()});
  if(path==='/v1/edge/schema')return json({events:{kinds:{}}});
  if(path==='/v1/edge/conversations')return json({conversations:[]});
  if(path==='/v1/edge/receipts/r_read')return json({receipt:completedRead});
  if(path==='/v1/edge/receipts/r_walk'){trace('canonical-walk-read',{phase:walk().phase});return json({receipt:walk()});}
  if(path==='/v1/edge/events'){res.writeHead(200,{'content-type':'text/event-stream'});res.write('event: hello\ndata: {}\n\n');trace('stream-connected');streams.add(res);req.on('close',()=>streams.delete(res));if(walkCompleted)sendCompletion(res);return;}
  if(path==='/v1/edge/wait')return setTimeout(()=>json({events:[],cursor:'c_1'}),20);
  if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push({path,body});if(path==='/v1/edge/act'&&body.capability==='walk:commons'&&seedReading){if(walkAdmissionDelayMs)await new Promise(r=>later(r,walkAdmissionDelayMs));trace('walk-admitted');json({accepted:true,receipt:walk()});if(completeReturn)later(()=>{walkCompleted=true;trace('walk-completed');for(const stream of streams)sendCompletion(stream);},250);return;}return json({accepted:false,code:'capability.refused',reason:'Actual fixture native admission refused.'});}
  res.statusCode=404;json({error:{code:'not-found'}});
 });const port=process.env.EDEN_OWNER_REPORT_TEST_PORT===undefined?0:Number(process.env.EDEN_OWNER_REPORT_TEST_PORT);assert.ok(Number.isInteger(port)&&port>=0&&port<=65535,'valid fixture port');await new Promise(r=>server.listen(port,'127.0.0.1',r));t.after(async()=>{for(const s of streams)s.end();await new Promise(r=>server.close(r));});
 const world='http://127.0.0.1:'+server.address().port;writeFileSync(join(root,'.eden-agent.json'),JSON.stringify({world,soul:'s_probe',identity:'synthetic-owner',token:'synthetic-token',...(seedReading?{lastReceipt:'r_read'}:{})}));
 if(seedReading){const queue=openClientQueue(root,{scope:world+'|s_probe',adapter:{send:async()=>({accepted:true,receipt:{...completedRead,phase:'started',outcome:undefined}})}});queue.enqueue([{act:'read:library',protected:true},{act:'walk:commons'}],{id:'req-prior',source:'owner'});await queue.pump();queue.close();writeFileSync(join(root,'OWNER-REPLIES.jsonl'),JSON.stringify({id:'req-prior',t:new Date().toISOString(),answer:'Read and return queued; not complete.',answerSource:'execution-verdict',results:[]})+'\n');}
 writeFileSync(join(root,'OWNER-REQUESTS.jsonl'),JSON.stringify({id:'req-report',t:new Date().toISOString(),text:requestText,force:false})+'\n');
 const cli=process.env.EDEN_OWNER_REPORT_TEST_CLI??resolve('tools/edge-skill/eden-agent.mjs');const child=spawn(process.execPath,[cli,'live','--engine','claude',...liveArgs,'--run-seconds','3'],{cwd:root,env:{...process.env,PATH:join(root,'bin')+':'+process.env.PATH},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);t.after(()=>child.kill());
 const exit=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('mounted fixture deadline '+output));},8000);child.once('exit',code=>{clearTimeout(timer);resolve(code);});});assert.equal(exit,0,output);
 const replyRows=readFileSync(join(root,'OWNER-REPLIES.jsonl'),'utf8').trim().split('\n').map(JSON.parse),rows=readFileSync(join(root,'live-log.jsonl'),'utf8').trim().split('\n').map(JSON.parse);const queue=JSON.parse(readFileSync(join(root,'.client-queue.json'),'utf8'));return {requests,replies:replyRows,rows,timeline,diagnostic:JSON.stringify({timeline,requests,replies:replyRows,queue,rows})};
}
test('real regression tuple: completed reading and running Commons keeps cited owner report with successful remember',async t=>{
 const f=await fixture(t,{seedReading:true,reply:{do:[],owner:report,remember:{self:[`Read ${title} from ${source}.`]}}});const answer=f.replies.find(r=>r.id==='req-report');assert.equal(answer.answerSource,'model-unverified');assert.match(answer.answer,/book:gardens-guide@1#p2/);assert.match(answer.answer,/return to Commons is still walking/);assert.deepEqual(answer.localResults,[{operation:'remember',accepted:true,line:'Memory judgment saved (self).'}]);assert.equal(answer.queue.steps[0].receipt.phase,'completed');assert.equal(answer.queue.steps[1].receipt.phase,'started');assert.ok(!f.requests.some(r=>r.path==='/v1/edge/say'||r.path==='/v1/edge/converse'),'private report/judgment never becomes public speech');
});
test('failed local memory is visible without suppressing independent factual book report',async t=>{
 const f=await fixture(t,{seedReading:true,reply:{do:[],owner:report,remember:{person:'s_unmet',note:'Private rejected judgment.'}}});const answer=f.replies.find(r=>r.id==='req-report');assert.match(answer.answer,/^Memory judgment not saved:/);assert.match(answer.answer,/book:gardens-guide@1#p2/);assert.equal(answer.answerSource,'model-unverified');assert.equal(answer.localResults[0].accepted,false);
});
test('failed native action retains authoritative refusal ahead of remember success and phantom completion',async t=>{
 const f=await fixture(t,{reply:{do:[{act:'walk:library'}],owner:'I arrived at the library and completed everything.',remember:{self:['Private impression.']}}});const answer=f.replies.find(r=>r.id==='req-report');assert.equal(answer.answerSource,'execution-verdict');assert.match(answer.answer,/refused|failed|not run/);assert.doesNotMatch(answer.answer,/I arrived|completed everything/);assert.equal(f.requests.filter(r=>r.path==='/v1/edge/act').length,1);
});
test('continued owner body refusal cannot publish phantom completion',async t=>{
 const f=await fixture(t,{requestText:'Go to the library.',liveArgs:['--idle-seconds','0.1','--idle-max-seconds','0.1'],replies:[{do:[],owner:'I will check the library.'},{do:[{act:'walk:library'}],owner:'I arrived at the library and completed everything.'},{do:[]}]});
 const continued=f.replies.find(r=>r.id==='req-report'&&r.continued);assert.ok(continued,'idle wake continues the acknowledged owner request');assert.equal(f.requests.filter(r=>r.path==='/v1/edge/act').length,1);assert.match(continued.results.join('; '),/capability\.refused/);assert.equal(continued.answerSource,'execution-verdict');assert.match(continued.answer,/refused|failed|not run/);assert.doesNotMatch(continued.answer,/I arrived|completed everything/);
});
test('local saved schedule does not promote claimed routine execution and keeps independent citation',async t=>{
 const f=await fixture(t,{seedReading:true,reply:{do:[],owner:`I read ${title} from ${source}. The routine ran and completed.`,schedule:'## Routines\n\n## Commitments\n\n## Reviews\n'}});const answer=f.replies.find(r=>r.id==='req-report');assert.match(answer.answer,/book:gardens-guide@1#p2/);assert.match(answer.answer,/does not confirm execution/);assert.doesNotMatch(answer.answer,/routine ran/);assert.equal(answer.answerSource,'model-unverified');
});
function assertFinalOwnerQueue(f){
 const final=f.replies.filter(r=>r.id==='req-prior'&&r.queueComplete);assert.equal(final.length,1,f.diagnostic);assert.equal(final[0].answerSource,'queue-and-receipt-evidence',f.diagnostic);assert.match(final[0].answer,/book:gardens-guide@1#p2/,f.diagnostic);assert.equal(final[0].finalReceipt.phase,'completed',f.diagnostic);assert.ok(f.replies.some(r=>r.id==='req-report'&&r.answerSource==='model-unverified'),f.diagnostic);
}
test('async final canonical queue result overrides historical model acknowledgement exactly once',async t=>{
 const f=await fixture(t,{seedReading:true,completeReturn:true,reply:{do:[],owner:report,remember:{self:['Private reading impression.']}}});assertFinalOwnerQueue(f);
});
test('late walk admission still publishes the canonical final queue result exactly once within the existing cohort',async t=>{
 // Delay admission beyond the old stream-relative event, retaining the same 3s cohort.
 const f=await fixture(t,{seedReading:true,completeReturn:true,walkAdmissionDelayMs:900,reply:{do:[],owner:report,remember:{self:['Private reading impression.']}}});assertFinalOwnerQueue(f);
 const stream=f.timeline.find(e=>e.kind==='stream-connected'),admitted=f.timeline.find(e=>e.kind==='walk-admitted'),completed=f.timeline.find(e=>e.kind==='walk-completed'),event=f.timeline.find(e=>e.kind==='completion-event');
 assert.ok(stream&&admitted&&completed&&event,f.diagnostic);assert.ok(admitted.ms-stream.ms>700,'admission follows the old stream-relative 700ms event: '+f.diagnostic);assert.ok(completed.ms>admitted.ms,f.diagnostic);assert.ok(event.ms>=completed.ms,f.diagnostic);assert.ok(f.timeline.some(e=>e.kind==='canonical-walk-read'&&e.phase==='completed'&&e.ms>=completed.ms),f.diagnostic);
});
