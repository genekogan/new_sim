// Operator-only proxy process. No writer/tunnel signals, credentials or DB access.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const BASE='5e478f8a1d999e2fd1dffc1901e4440198bfcd76',ARTIFACT='a7d1aced3fda84ad08fd89f8274b4bfccc937d8f';
const KEYS=['eden','mars','littlemartians'],PORTS={eden:4950,mars:4963,littlemartians:4964};
export const sha256=b=>createHash('sha256').update(b).digest('hex');
const check=(v,m)=>{if(!v)throw Error(m);};
function pinned(pin){check(pin&&typeof pin.path==='string'&&pin.path.startsWith('/')&&/^[a-f0-9]{64}$/.test(pin.sha256),'absolute hash pin required');const b=readFileSync(pin.path);check(sha256(b)===pin.sha256,'pinned file differs');return b;}
const json=pin=>JSON.parse(pinned(pin));
function age(utc,now,max){const time=Date.parse(utc);return Number.isFinite(time)&&time<=now&&now-time<=max;}
export const systemProbe={
 identity(pid){const pgid=Number(execFileSync('/bin/ps',['-p',String(pid),'-o','pgid='],{encoding:'utf8'}).trim());const command=execFileSync('/bin/ps',['-p',String(pid),'-o','command='],{encoding:'utf8'}).trim();return{pgid,commandSHA256:sha256(command)};},
 absent(pid){try{process.kill(pid,0);return false;}catch(e){if(e.code==='ESRCH')return true;throw e;}},
 owns(pid,port){const r=spawnSync('/usr/sbin/lsof',['-t','-a','-p',String(pid),'-iTCP:'+port,'-sTCP:LISTEN'],{encoding:'utf8'});check(!r.error&&r.status===0&&!r.stderr.trim(),'listener owner probe failed');return r.stdout.trim().split(/\s+/).every(p=>Number(p)===pid)&&!!r.stdout.trim();},
 vacant(port){const r=spawnSync('/usr/sbin/lsof',['-nP','-iTCP:'+port,'-sTCP:LISTEN'],{encoding:'utf8'});return !r.error&&r.status===1&&!r.stdout.trim()&&!r.stderr.trim();}
};
// Probe injection is solely for filesystem/stub unit tests; CLI always uses systemProbe.
export function validateProxyOperation(planPin,goPin,{now=Date.now(),probe=systemProbe,launcherPath=fileURLToPath(import.meta.url)}={}){
 const plan=json(planPin),go=json(goPin);check(go.status==='GO'&&go.humanNoticeGiven===true&&go.planSHA256===planPin.sha256&&go.launcherSHA256===sha256(readFileSync(launcherPath)),'trusted reviewed Root GO required');
 check(age(go.issuedAtUTC,now,300000)&&Date.parse(go.expiresAtUTC)>now&&Date.parse(go.expiresAtUTC)<=now+600000,'fresh finite Root GO required');
 check(plan.contract==='proxy-artifact-ops/1'&&['start','rollback'].includes(plan.mode)&&go.operation==='proxy-artifact-'+plan.mode,'explicit proxy operation required');
 const source=plan.mode==='start'?ARTIFACT:BASE;const qualification=json(go.qualificationReceipt);check(qualification.status==='QUALIFIED'&&qualification.source===source&&go.qualificationSource===source,'hash-pinned QUALIFIED receipt required; timeout is not qualification');
 const d=json(plan.descriptor);pinned(plan.proxyModule);check(d.port===4970&&d.exposure==='shared-preview'&&d.expectedBuild==='local-clerk-modern-context-5e478f8a-20261010'&&JSON.stringify(d.worlds)===JSON.stringify(PORTS),'existing backend ports/build required');
 check(plan.backendSource===BASE&&plan.artifactSource===source,'separate backend/artifact source required');
 if(plan.mode==='start'){check(d.artifactOverlay?.frontendSource===ARTIFACT&&d.artifactOverlay.cliSource===ARTIFACT,'exact overlay artifact source required');}
 else check(d.artifactOverlay===undefined,'rollback must select original backend artifacts without overlay');
 const seen=new Set();const identity=owner=>{check(owner&&Number.isInteger(owner.pid)&&owner.pid>1&&Number.isInteger(owner.pgid)&&owner.pgid>1&&!seen.has(owner.pid),'distinct owned process pins required');seen.add(owner.pid);const actual=probe.identity(owner.pid);check(actual.pgid===owner.pgid&&actual.commandSHA256===owner.commandSHA256,'actual PID/PGID/command differs');};
 for(const key of KEYS){const w=plan.writers?.[key];identity(w);const r=json(w.readyReceipt);check(r.pid===w.pid&&r.port===PORTS[key]&&r.worldId===d.expectedWorldIds?.[key]&&r.source===BASE&&r.build===d.expectedBuild,'writer READY/source/world differs');check(probe.owns(w.pid,PORTS[key]),'writer listener differs');}
 check(plan.ssh?.pid===46457&&plan.ssh.remotePort===4505,'retained SSH4505 identity required');identity(plan.ssh);
 const old=plan.oldProxy;check(old&&Number.isInteger(old.pid)&&old.pid>1&&!seen.has(old.pid)&&Number.isInteger(old.pgid)&&/^[a-f0-9]{64}$/.test(old.commandSHA256),'exact old proxy process required');const prior=json(old.readyReceipt);check(prior.pid===old.pid&&prior.port===4970,'old proxy READY differs');
 if(plan.mode==='start')check(old.pid===20627&&prior.source===BASE&&prior.build===d.expectedBuild,'current20627 proxy READY required; old83442 marker is not current closure');
 else check(prior.mode==='start'&&prior.backendSource===BASE&&prior.artifactSource===ARTIFACT,'rollback requires just-closed overlay READY');
 const closed=json(plan.closure);check(closed.closedPID===old.pid&&closed.pgid===old.pgid&&closed.commandSHA256===old.commandSHA256&&closed.port===4970&&closed.normalClosed===true&&closed.sshUnchanged===true&&closed.readyReceiptSHA256===old.readyReceipt.sha256&&age(closed.closedAtUTC,now,300000),'fresh exact old-proxy normal closure required');
 check(probe.absent(old.pid)&&probe.vacant(4970),'old proxy alive or4970 not vacant');
 check(typeof plan.outputDir==='string'&&plan.outputDir.startsWith('/'),'exclusive receipt directory required');return{plan,descriptor:d,qualification,go,protectedPIDs:[...seen],protectedPGIDs:[...Object.values(plan.writers).map(w=>w.pgid),plan.ssh.pgid]};
}
// Do not infer overlay activation merely from a descriptor an old module may ignore.
export async function openVerifiedProxy(module,descriptor,mode,isCancelled=()=>false){
 let proxy;
 try{
  proxy=await module.openWorldProxy(descriptor);check(!isCancelled(),'startup cancelled');
  const actual=proxy.artifactAttribution;
  if(mode==='start')for(const field of ['frontendSource','cliSource','webManifestSha256','cliSha256'])check(actual?.[field]===descriptor.artifactOverlay?.[field]&&typeof actual?.[field]==='string','returned artifact attribution differs: '+field);
  else check(mode==='rollback'&&actual==null,'rollback returned overlay authority');
  return proxy;
 }catch(e){if(proxy){await proxy.close();e.ownProxyClosed=true;}throw e;}
}
export async function runProxyOperation(planPin,goPin){
 const checked=validateProxyOperation(planPin,goPin);const {plan}=checked;mkdirSync(plan.outputDir,{recursive:false});
 let proxy,cancelled=false,closing;const close=()=>closing??=(proxy?proxy.close():Promise.resolve());const signal=()=>{cancelled=true;if(proxy)void close();};
 process.on('SIGTERM',signal);process.on('SIGINT',signal);
 const record=(name,r)=>writeFileSync(join(plan.outputDir,name),JSON.stringify({...r,atUTC:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
 try{
  // No children: cancellation during async bootstrap is remembered and the newly
  // opened listener is closed before READY. Existing writers/tunnel are untouched.
  const pgid=Number(execFileSync('/bin/ps',['-p',String(process.pid),'-o','pgid='],{encoding:'utf8'}).trim());check(pgid===process.pid&&!checked.protectedPGIDs.includes(pgid),'proxy requires its own detached process group');
  const module=await import(pathToFileURL(plan.proxyModule.path).href);check(!cancelled,'startup cancelled');
  proxy=await openVerifiedProxy(module,checked.descriptor,plan.mode,()=>cancelled);check(!cancelled,'startup cancelled');
  record('READY.json',{mode:plan.mode,pid:process.pid,pgid,port:4970,planSHA256:planPin.sha256,goSHA256:goPin.sha256,backendSource:BASE,artifactSource:plan.artifactSource,artifactAttribution:proxy.artifactAttribution??null,writers:plan.writers,sshPID:plan.ssh.pid});
  if(!cancelled)await new Promise(resolve=>{const finish=()=>resolve();process.once('SIGTERM',finish);process.once('SIGINT',finish);});
  await close();record('CLOSURE.json',{pid:process.pid,port:4970,normalClosed:true,onlyOwnProxyClosed:true});
 }catch(e){await close();record('FIRST-FAILURE.json',{pid:process.pid,error:e.message,ownProxyClosed:!!proxy||e.ownProxyClosed===true});throw e;}
 finally{process.removeListener('SIGTERM',signal);process.removeListener('SIGINT',signal);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [planPath,planSHA,goPath,goSHA]=process.argv.slice(2);
 try{await runProxyOperation({path:planPath,sha256:planSHA},{path:goPath,sha256:goSHA});}
 catch(e){console.error('Proxy operation refused:',e.message);process.exitCode=1;}
}
