import type {WorldHost} from './world.ts';
/** Passive topology checkpoint. Never forces quiet or interrupts residents. */
export function scheduleRetainedCommonsShoreInstallation(host:WorldHost){
  let closed=false,busy=false,lastProbe=-20,failure:unknown,work=Promise.resolve();
  let state:{phase:'waiting'|'installing'|'installed'|'failed'|'closed';reason?:string}={phase:'waiting'};
  const waitable=new Set(['retained-shore.not-quiet-commons','retained-shore.not-quiet','retained-shore.source-moved']);
  const code=(error:unknown)=>error instanceof Error&&/^retained-shore\.[a-z-]+$/.test(error.message)?error.message:'retained-shore.installation-failed';
  function fail(error:unknown){failure=error;state={phase:'failed',reason:code(error)};console.error('retained-shore.installation-failed');}
  function poll(tick=host.engine.world.tick){
    if(closed||busy||state.phase==='installed'||state.phase==='failed'||tick-lastProbe<20&&!host.quietBarrier)return;lastProbe=tick;
    try{
      if(host.engine.rulesVersion.includes('+retained-shore/1+')){state={phase:'installed'};return;}
      if(!/\+commons-kitchen\/[12](?:\+|$)/.test(host.engine.rulesVersion)){state={phase:'waiting',reason:'retained-shore.kitchen-prerequisite'};return;}
      const p=host.engine.previewRetainedCommonsShoreV1?.();if(!p?.ok){const reason=p?.diagnostic.code??'retained-shore.reader-required';if(waitable.has(reason)){state={phase:'waiting',reason};return;}throw Error(reason);}
      busy=true;state={phase:'installing'};
      work=host.installRetainedCommonsShoreV1().then(()=>{if(!closed)state={phase:'installed'};}).catch(error=>{const reason=code(error);if(waitable.has(reason)){state={phase:'waiting',reason};if(reason==='retained-shore.source-moved')lastProbe=-20;}else fail(error);}).finally(()=>{busy=false;});
    }catch(error){fail(error);}
  }
  const listener={afterTick:poll,onApplied(e:{kind:string;payload:any}){if(e.kind==='rules'&&e.payload?.compact)lastProbe=-20;}};host.listeners.push(listener);poll();
  return {poll,status:()=>({...state}),async settled(){await work;if(failure)throw failure;},close(){closed=true;const i=host.listeners.indexOf(listener);if(i>=0)host.listeners.splice(i,1);state={phase:'closed'};}};
}
