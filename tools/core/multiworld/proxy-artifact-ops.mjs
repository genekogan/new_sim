// Operator-only proxy process. No writer/tunnel signals, credentials or DB access.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const BASE='5e478f8a1d999e2fd1dffc1901e4440198bfcd76',ROUTE='bb34df01ce327bc1abe40d4e439e3c8c9784bcd6',ROUTE_MODULE_SHA='e609654744b6e342cae6979fca2e41b1a6e662b6c0ef675159879e0ecb6415a2';
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
const exact=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function startupAllowed(go,{now=Date.now(),cancelled=false}={}){
 check(!cancelled,'startup cancelled');check(Date.parse(go.expiresAtUTC)>now,'startup GO expired');
}
function backendDescriptor(d){check(d.port===4970&&d.exposure==='shared-preview'&&d.expectedBuild==='local-clerk-modern-context-5e478f8a-20261010'&&exact(d.worlds,PORTS)&&d.worldsUpstreamPort===5340,'existing backend ports/build and worlds5340 required');}
// Probe injection is solely for filesystem/stub unit tests; CLI always uses systemProbe.
export function validateProxyOperation(planPin,goPin,{now=Date.now(),probe=systemProbe,launcherPath=fileURLToPath(import.meta.url)}={}){
 const plan=json(planPin),go=json(goPin);check(go.status==='GO'&&go.humanNoticeGiven===true&&go.planSHA256===planPin.sha256&&go.launcherSHA256===sha256(readFileSync(launcherPath)),'trusted reviewed Root GO required');
 check(age(go.issuedAtUTC,now,300000)&&Date.parse(go.expiresAtUTC)>now&&Date.parse(go.expiresAtUTC)<=now+600000,'fresh finite Root GO required');
 check(plan.contract==='proxy-artifact-ops/2'&&['start','rollback'].includes(plan.mode)&&go.operation==='proxy-artifact-'+plan.mode,'explicit proxy operation required');
 check(/^[a-f0-9]{40}$/.test(plan.releaseSource)&&plan.backendSource===BASE,'separate exact release/backend source required');
 const qualification=json(go.qualificationReceipt);check(qualification.status==='QUALIFIED'&&qualification.source===plan.releaseSource&&go.qualificationSource===plan.releaseSource,'hash-pinned QUALIFIED receipt required; timeout is not qualification');
 const d=json(plan.descriptor);pinned(plan.proxyModule);backendDescriptor(d);
 check(qualification.proxyModuleSHA256===plan.proxyModule.sha256,'qualified proxy module pin differs');
 const baseline=plan.baseline;const rollbackDescriptor=json(baseline?.descriptor);pinned(baseline?.proxyModule);backendDescriptor(rollbackDescriptor);
 check(baseline.source===ROUTE&&baseline.proxyModule.sha256===ROUTE_MODULE_SHA&&rollbackDescriptor.artifactOverlay===undefined,'rollback must retain exact current bb34 route without overlay');
 const withoutOverlay={...d};delete withoutOverlay.artifactOverlay;check(exact(withoutOverlay,rollbackDescriptor),'descriptor changes beyond artifact selection refused');
 if(plan.mode==='start'){
  check(go.startupFallbackAuthorized===true,'explicit startup fallback authorization required');
  check(d.artifactOverlay&&exact(d.artifactOverlay,qualification.artifactOverlay),'separately qualified artifact pins required');
  check(/^[a-f0-9]{40}$/.test(d.artifactOverlay.frontendSource)&&/^[a-f0-9]{40}$/.test(d.artifactOverlay.cliSource)&&d.artifactOverlay.guideArtifacts,'qualified web CLI and guides required');
 }else check(d.artifactOverlay===undefined&&plan.releaseSource===ROUTE&&plan.proxyModule.sha256===ROUTE_MODULE_SHA,'rollback must select current bb34 routing artifacts');
 const seen=new Set();const identity=owner=>{check(owner&&Number.isInteger(owner.pid)&&owner.pid>1&&Number.isInteger(owner.pgid)&&owner.pgid>1&&!seen.has(owner.pid),'distinct owned process pins required');seen.add(owner.pid);const actual=probe.identity(owner.pid);check(actual.pgid===owner.pgid&&actual.commandSHA256===owner.commandSHA256,'actual PID/PGID/command differs');};
 for(const key of KEYS){const w=plan.writers?.[key];check(w?.pid==={eden:14238,mars:14806,littlemartians:18341}[key],'current writer PID required');identity(w);const r=json(w.readyReceipt);check(r.pid===w.pid&&r.port===PORTS[key]&&r.worldId===d.expectedWorldIds?.[key]&&r.source===BASE&&r.build===d.expectedBuild,'writer READY/source/world differs');check(probe.owns(w.pid,PORTS[key]),'writer listener differs');}
 check(plan.ssh?.pid===46457&&plan.ssh.remotePort===4505,'retained SSH4505 identity required');identity(plan.ssh);
 const old=plan.oldProxy;check(old&&Number.isInteger(old.pid)&&old.pid>1&&!seen.has(old.pid)&&Number.isInteger(old.pgid)&&/^[a-f0-9]{64}$/.test(old.commandSHA256),'exact old proxy process required');const prior=json(old.readyReceipt);check(prior.pid===old.pid&&prior.pgid===old.pgid&&prior.port===4970&&prior.commandSHA256===old.commandSHA256&&prior.backendSource===BASE&&prior.worldsUpstreamPort===5340,'old proxy READY differs');
 if(plan.mode==='start')check((old.pid===52099||prior.mode==='fallback'&&prior.proxyModuleSHA256===ROUTE_MODULE_SHA)&&prior.proxySource===ROUTE&&prior.build===d.expectedBuild,'current52099 or owned bb34 fallback READY required');
 else check(prior.mode==='start'&&prior.artifactAttribution&&prior.proxyModuleSHA256===plan.promotedProxyModuleSHA256,'rollback requires just-closed promoted overlay READY');
 const closed=json(plan.closure);check(closed.closedPID===old.pid&&closed.pgid===old.pgid&&closed.commandSHA256===old.commandSHA256&&closed.port===4970&&closed.normalClosed===true&&closed.sshUnchanged===true&&closed.readyReceiptSHA256===old.readyReceipt.sha256&&age(closed.closedAtUTC,now,300000),'fresh exact old-proxy normal closure required');
 check(probe.absent(old.pid)&&probe.vacant(4970),'old proxy alive or4970 not vacant');
 check(typeof plan.outputDir==='string'&&plan.outputDir.startsWith('/'),'exclusive receipt directory required');return{plan,descriptor:d,rollbackDescriptor,qualification,go,protectedPIDs:[...seen],protectedPGIDs:[...Object.values(plan.writers).map(w=>w.pgid),plan.ssh.pgid]};
}
// Do not infer overlay activation merely from a descriptor an old module may ignore.
export async function openVerifiedProxy(module,descriptor,mode,isCancelled=()=>false,beforeListen=()=>{}){
 let proxy;
 try{
  proxy=await module.openWorldProxy({...descriptor,beforeListen});check(!isCancelled(),'startup cancelled');beforeListen();
  const actual=proxy.artifactAttribution;
  if(mode==='start')for(const field of ['frontendSource','cliSource','webManifestSha256','cliSha256'])check(actual?.[field]===descriptor.artifactOverlay?.[field]&&typeof actual?.[field]==='string','returned artifact attribution differs: '+field);
  else check(mode==='rollback'&&actual==null,'rollback returned overlay authority');
  if(mode==='start'){const guides=descriptor.artifactOverlay.guideArtifacts;check(actual?.guideSource===guides?.source,'returned guide source differs');for(const key of KEYS)for(const kind of ['skill','instructions'])check(actual?.guideHashes?.[key]?.[kind+'Sha256']===guides?.worlds?.[key]?.[kind]?.sha256,'returned guide hash differs');}
  return proxy;
 }catch(e){if(proxy){await proxy.close();e.ownProxyClosed=true;}throw e;}
}
// Small injectable recovery seam: production uses pinned modules and system probes.
export async function openWithRecovery({module,descriptor,mode,rollbackDescriptor,loadRecovery,ensureRecoverySafe,startup,isCancelled,onFailure}){
 try{return{proxy:await openVerifiedProxy(module,descriptor,mode,isCancelled,startup),fallback:false};}
 catch(error){
  await onFailure(error);if(mode!=='start'||isCancelled())throw error;
  ensureRecoverySafe();const recovery=await loadRecovery();
  return{proxy:await openVerifiedProxy(recovery,rollbackDescriptor,'rollback',isCancelled,()=>check(!isCancelled(),'startup cancelled')),fallback:true};
 }
}
export function checkProtectedProcesses(plan,probe=systemProbe){
 for(const key of KEYS){const w=plan.writers[key],actual=probe.identity(w.pid);check(actual.pgid===w.pgid&&actual.commandSHA256===w.commandSHA256&&probe.owns(w.pid,PORTS[key]),'writer changed during startup');}
 const ssh=probe.identity(plan.ssh.pid);check(ssh.pgid===plan.ssh.pgid&&ssh.commandSHA256===plan.ssh.commandSHA256,'SSH changed during startup');
}
export async function runProxyOperation(planPin,goPin){
 const checked=validateProxyOperation(planPin,goPin);const {plan}=checked;mkdirSync(plan.outputDir,{recursive:false});
 let proxy,cancelled=false,closing;const close=()=>closing??=(proxy?proxy.close():Promise.resolve());const signal=()=>{cancelled=true;if(proxy)void close();};
 process.on('SIGTERM',signal);process.on('SIGINT',signal);
 const record=(name,r)=>writeFileSync(join(plan.outputDir,name),JSON.stringify({...r,atUTC:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
 const startup=()=>startupAllowed(checked.go,{cancelled});
 try{
  const pgid=Number(execFileSync('/bin/ps',['-p',String(process.pid),'-o','pgid='],{encoding:'utf8'}).trim());check(pgid===process.pid&&!checked.protectedPGIDs.includes(pgid),'proxy requires its own detached process group');
  pinned(plan.proxyModule);const module=await import(pathToFileURL(plan.proxyModule.path).href);startup();
  const opened=await openWithRecovery({module,descriptor:checked.descriptor,mode:plan.mode,rollbackDescriptor:checked.rollbackDescriptor,isCancelled:()=>cancelled,startup,
   onFailure:error=>record('FIRST-STARTUP-FAILURE.json',{pid:process.pid,error:error.message,ownProxyClosed:error.ownProxyClosed===true}),
   ensureRecoverySafe:()=>{check(systemProbe.vacant(4970),'failed startup left listener; fallback refused');checkProtectedProcesses(plan);},
   loadRecovery:async()=>{pinned(plan.baseline.proxyModule);return import(pathToFileURL(plan.baseline.proxyModule.path).href);}});
  proxy=opened.proxy;const fallback=opened.fallback;
  checkProtectedProcesses(plan);
  check(!cancelled,'startup cancelled');if(!fallback)startup();
  record(fallback?'FALLBACK-READY.json':'READY.json',{mode:fallback?'fallback':plan.mode,pid:process.pid,pgid,commandSHA256:systemProbe.identity(process.pid).commandSHA256,port:4970,planSHA256:planPin.sha256,goSHA256:goPin.sha256,backendSource:BASE,proxySource:fallback?ROUTE:plan.releaseSource,proxyModuleSHA256:fallback?plan.baseline.proxyModule.sha256:plan.proxyModule.sha256,worldsUpstreamPort:5340,build:checked.descriptor.expectedBuild,artifactAttribution:proxy.artifactAttribution??null,writers:plan.writers,sshPID:plan.ssh.pid});
  if(!cancelled)await new Promise(resolve=>{const finish=()=>resolve();process.once('SIGTERM',finish);process.once('SIGINT',finish);});
  await close();record('CLOSURE.json',{closedPID:process.pid,pgid,commandSHA256:systemProbe.identity(process.pid).commandSHA256,port:4970,normalClosed:true,onlyOwnProxyClosed:true});
 }catch(e){await close();record('FIRST-FAILURE.json',{pid:process.pid,error:e.message,ownProxyClosed:!!proxy||e.ownProxyClosed===true});throw e;}
 finally{process.removeListener('SIGTERM',signal);process.removeListener('SIGINT',signal);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [planPath,planSHA,goPath,goSHA]=process.argv.slice(2);
 try{await runProxyOperation({path:planPath,sha256:planSHA},{path:goPath,sha256:goSHA});}
 catch(e){console.error('Proxy operation refused:',e.message);process.exitCode=1;}
}
