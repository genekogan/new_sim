import type {WorldHost} from './world.ts';
import type {Brain} from './brain.ts';
import {installSocialEdenCardsV1} from './social-eden.ts';
export function scheduleSocialEdenInstallationV1(host:WorldHost,brain:Brain){
 let closed=false,busy=false,last=-20,failure:unknown,work=Promise.resolve();let state:{phase:'waiting'|'installing'|'installed'|'failed'|'closed';reason?:string}={phase:'waiting'};
 const waitable=new Set(['social-eden.resumable-boundary-required','social-eden.physical-conflict','social-eden.source-moved']);
 function poll(tick=host.engine.world.tick){if(closed||busy||state.phase==='failed'||(!host.quietBarrier&&tick-last<20))return;last=tick;
  try{if(!/\+commons-kitchen\/[12](?:\+|$)/.test(host.engine.rulesVersion)){state={phase:'waiting',reason:'social-eden.kitchen-prerequisite'};return;}const exists=host.engine.rulesVersion.endsWith('+social-eden/1');if(!exists){const p=host.engine.previewSocialEdenV1?.();if(!p?.ok){const reason=p?.diagnostic.code??'social-eden.reader-required';if(waitable.has(reason)){state={phase:'waiting',reason};return;}throw Error(reason);}}
   if(exists&&state.phase==='installed')return;busy=true;state={phase:'installing'};work=(async()=>{if(!exists)await host.installSocialEdenV1();await installSocialEdenCardsV1(host,brain);if(!closed)state={phase:'installed'};})().catch(error=>{const reason=error instanceof Error?error.message:'social-eden.failure';if(waitable.has(reason))state={phase:'waiting',reason};else{failure=error;state={phase:'failed',reason:'social-eden.failure'};console.error('social-eden.failed');}}).finally(()=>{busy=false;});
  }catch(error){failure=error;state={phase:'failed',reason:'social-eden.failure'};console.error('social-eden.failed');}}
 const listener={afterTick:poll,onApplied(e:{kind:string;payload?:any}){if(e.kind==='birth'||e.kind==='rules'&&e.payload?.commonsFoodDelivery){last=-20;if(state.phase==='installed')state={phase:'waiting'};}}};host.listeners.push(listener);poll();return {poll,status:()=>({...state}),async settled(){await work;if(failure)throw failure;},close(){closed=true;const i=host.listeners.indexOf(listener);if(i>=0)host.listeners.splice(i,1);state={phase:'closed'};}};
}
