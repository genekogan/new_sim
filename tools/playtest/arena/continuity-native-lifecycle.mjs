// Own only the passive exporter lifetime. Server capture must already be
// running before this is constructed; this never starts or mutates a world.
import {createNativeEvidenceExporter} from './continuity-native-evidence.mjs';
export function createTrialNativeEvidence(config,{createExporter=createNativeEvidenceExporter,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),schedule=setTimeout,cancel=clearTimeout,onFailure=()=>{}}={}){
 const exporter=createExporter(config);let timer,closed=false,started=false,failure=null,last=null;
 const failed=e=>{failure??=typeof e?.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(e.code)?e.code:'NATIVE_CAPTURE_LIFECYCLE_FAILED';onFailure(failure);};
 const poll=()=>{if(closed||failure)return null;try{last=exporter.poll();return last;}catch(e){failed(e);return null;}};
 const loop=()=>{timer=schedule(()=>{poll();if(!closed&&!failure)loop();},1000);};
 return {
  start(){if(started||closed)throw Error('NATIVE_LIFECYCLE_ALREADY_STARTED');started=true;const first=poll();if(!failure)loop();return {first,failure};},
  async finish({t0,cutoffAt}){
   if(closed)throw Error('NATIVE_LIFECYCLE_ALREADY_CLOSED');cancel(timer);
   let coverage=null;
   try{
    // Never move the trial cutoff or grant extra actor time. The caller closes
    // actors first; this waits only for the independent capture heartbeat.
    if(Number.isFinite(t0)&&Number.isFinite(cutoffAt)&&now()>=cutoffAt&&!failure){
     const final=poll(),deadline=now()+6000;
     if(final)for(let attempt=0;attempt<13;attempt++){
      coverage=exporter.audit(final,{t0,cutoffAt});
      if(coverage.status==='pass'||now()>=deadline||!coverage.missing.includes('capture heartbeat has not crossed snapshot boundary'))break;
      await sleep(Math.min(500,Math.max(0,deadline-now())));
     }
    }
   }catch(e){failed(e);}finally{closed=true;try{exporter.close();}catch(e){failed(e);}}
   return {schema:'continuity-native-lifecycle/1',status:!failure&&coverage?.status==='pass'?'pass':'unknown',failure,coverage,pollMs:1000,finalSnapshot:last?.snapshotId??null,limits:'Allowlisted source coverage only; no behavioral completeness or qualification inferred. Early cutoff remains unknown.'};
  },
 };
}
