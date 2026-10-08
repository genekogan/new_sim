// Bounded scripted acceptance: use only the published CLI, two synthetic owners,
// no live/model command and no direct engine/DB writes. Run after private-server QA.
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const [cliPath,world,output]=process.argv.slice(2);
if(!cliPath||!world||!output)throw Error('usage: node public-cli-acceptance.mjs /absolute/eden-agent.mjs http://127.0.0.1:495x /absolute/proof-dir');
const url=new URL(world);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.protocol!=='http:'||!/^495[0-9]$/.test(url.port))throw Error('explicit private loopback Eden495x required');
const cli=resolve(cliPath),out=resolve(output);mkdirSync(out,{recursive:true});
const a=mkdtempSync(join(out,'actor-')),b=mkdtempSync(join(out,'peer-'));
const suffix=Date.now().toString(36),nameA='Probe '+suffix+' A',nameB='Probe '+suffix+' B',results=[];
function run(cwd,args,timeout=75000){return new Promise((yes,no)=>{let stdout='',stderr='';const child=spawn(process.execPath,[cli,...args],{cwd,stdio:['ignore','pipe','pipe']});const timer=setTimeout(()=>child.kill('SIGTERM'),timeout);child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.on('error',no);child.on('close',code=>{clearTimeout(timer);if(code!==0)return no(Error('CLI '+args[0]+' failed; inspect owned folder (output intentionally withheld)'));try{yes(JSON.parse(stdout));}catch{no(Error('CLI '+args[0]+' returned non-JSON output'));}});});}
async function terminal(cwd,receipt,deadline){let rec=receipt;if(!rec?.id)return null;while(['started','waiting'].includes(rec.phase)&&Date.now()<deadline){const w=await run(cwd,['wait','20']);rec=w.lastReceipt??await run(cwd,['receipt',rec.id]);}return rec;}
async function request(words,{peer=false,refusal=false,seconds}={}){
 const started=Date.now(),deadline=started+180000;let asked=await run(a,['act',words,...(seconds?[JSON.stringify({seconds})]:[])]),acceptance;
 if(peer&&asked.accepted){const ob=await run(b,['observe']);const invitation=(ob.invites??[]).find(i=>(i.from?.name??i.from)===nameA)||(ob.invites??[])[0];if(invitation)acceptance=await run(b,['accept',invitation.id]);}
 let receipt=await terminal(a,asked.receipt,deadline);
 // CLI reports an ordinary approach separately from the requested gesture.
 if(asked.then&&receipt?.phase==='completed'&&Date.now()<deadline){asked=await run(a,['act',asked.then,...(seconds?[JSON.stringify({seconds})]:[])]);if(peer&&asked.accepted){const ob=await run(b,['observe']);const inv=(ob.invites??[])[0];if(inv)acceptance=await run(b,['accept',inv.id]);}receipt=await terminal(a,asked.receipt,deadline);}
 const here=await run(a,['here']);const outcome=!asked.accepted?'refused':receipt?.phase==='completed'?'completed':['failed','replaced'].includes(receipt?.phase)?receipt.phase:'limit';
 const passed=refusal?outcome==='refused':outcome==='completed';
 results.push({words,outcome,passed,code:asked.code??receipt?.code,receipt,peerAccepted:acceptance?.accepted,endedAt:here.me,elapsedSeconds:(Date.now()-started)/1000});
 writeFileSync(join(out,'summary.json'),JSON.stringify({contract:'public-cli-acceptance/1',world,results,scope:'Scripted synthetic owners; actual terminal receipts. Limit/refusal is never completion. Credential files stay in private actor/peer folders and are never printed.'},null,2)+'\n');
}
for(const [dir,name] of [[a,nameA],[b,nameB]]){await run(dir,['register',world]);await run(dir,['create-soul',name,'Synthetic local acceptance fixture; scripted at zero model spend.']);}
for(const words of ['eat at a picnic table','read a book in the library','use a computer','post a letter'])await request(words,{seconds:15});
await request('go fishing',{refusal:true});
await request('go to the campfire');await run(b,['act','go to the campfire']);await terminal(b,await run(b,['receipt']),Date.now()+180000);
for(const words of ['hug '+nameB,'shake hands with '+nameB,'dance with '+nameB,'go for a balloon ride with '+nameB])await request(words,{peer:true,seconds:15});
console.log(JSON.stringify({proof:join(out,'summary.json'),completed:results.filter(r=>r.outcome==='completed').length,passed:results.filter(r=>r.passed).length,total:results.length,limits:results.filter(r=>r.outcome==='limit').length}));
process.exitCode=results.every(r=>r.passed)?0:1;
