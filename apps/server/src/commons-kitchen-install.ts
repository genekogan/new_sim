import type {WorldHost} from './world.ts';
import type {Brain} from './brain.ts';
import {followCommonsKitchenBirths} from './commons-kitchen.ts';

/** Passive readiness observer. The HTTP server and native clock keep running;
 * no actor cancellation, model request, stock refill or quiet barrier is added. */
export function scheduleCommonsKitchenInstallation(host:WorldHost,brain:Brain){
  let closed=false,busy=false,lastProbe=-20,failure:unknown;
  let work=Promise.resolve(),births:Awaited<ReturnType<typeof followCommonsKitchenBirths>>|undefined;
  let state:{phase:'waiting'|'installing'|'installed'|'failed'|'closed';reason?:string}={phase:'waiting'};
  const waitable=new Set(['commons-kitchen.resumable-boundary-required','commons-kitchen.physical-conflict','commons-kitchen.source-moved']);
  const code=(error:unknown)=>error instanceof Error&&/^commons-kitchen\.[a-z-]+$/.test(error.message)?error.message:'commons-kitchen.installation-failed';
  const fail=(error:unknown)=>{failure=error;state={phase:'failed',reason:code(error)};console.error('commons-kitchen.installation-failed');};
  function poll(tick=host.engine.world.tick){
    if(closed||busy||state.phase==='installed'||state.phase==='failed'||tick-lastProbe<20)return;
    lastProbe=tick;
    try{
      const active=/\+commons-kitchen\/[12]$/.test(host.engine.rulesVersion);
      if(!active){
        const preview=host.engine.previewCommonsKitchenV1?.();
        if(!preview?.ok){const reason=preview?.diagnostic.code??'commons-kitchen.reader-required';if(waitable.has(reason)){state={phase:'waiting',reason};return;}throw Error(reason);}
      }
      busy=true;state={phase:'installing'};
      work=(async()=>{
        if(!active)await host.installCommonsKitchenV1();
        if(closed)return;
        births=await followCommonsKitchenBirths(host,brain);if(closed){births.close();return;}state={phase:'installed'};
      })().catch(error=>{const reason=code(error);if(waitable.has(reason))state={phase:'waiting',reason};else fail(error);}).finally(()=>{busy=false;});
    }catch(error){fail(error);}
  }
  const listener={afterTick:poll};host.listeners.push(listener);poll();
  return {poll,status:()=>({...state}),
    async settled(){await work;await births?.settled();if(failure)throw failure;},
    close(){closed=true;births?.close();const i=host.listeners.indexOf(listener);if(i>=0)host.listeners.splice(i,1);state={phase:'closed'};}};
}
