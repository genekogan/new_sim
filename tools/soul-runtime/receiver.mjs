// A receiver persists facts. It never acknowledges owner instructions, decides
// priorities, starts inference, or writes to a world. Transport is injected so
// the same contract applies to SSE, long-poll and synthetic fault injection.
export async function receivePage(journal, source, read, {signal,onCommitted=()=>{}} = {}) {
  const after=journal.cursor(source);
  const page=await read({after,signal});
  if(signal?.aborted) return {aborted:true}; // cursor unchanged: safe to replay
  const result=journal.ingest({source,after,cursor:page.cursor,events:page.events,gap:page.gap??false});
  if(page.events.length)onCommitted({source,state:'events-persisted',events:page.events.map(event=>({source,id:event.id})),committedAt:Date.now()});
  return {...result,pending:journal.pending().length};
}

/** Receiver never waits for a host notification or model response. Terminal
 * auth/supersession propagates; only explicitly classified errors retry. */
export async function runReceiver({journal,source,read,signal,onState=()=>{},retryable=()=>false,sleep=abortableSleep,maxBackoffMs=30000}) {
  let backoff=0;
  while(!signal?.aborted){
    try {
      onState({source,state:'receiving'});
      const result=await receivePage(journal,source,read,{signal,onCommitted:onState});
      if(result.aborted)break;
      backoff=0;
    }catch(error){
      if(signal?.aborted)break;
      if(!retryable(error)){
        onState({source,state:'blocked',reason:String(error.message)});
        throw error;
      }
      backoff=Math.min(maxBackoffMs,backoff?backoff*2:1000);
      onState({source,state:'retrying',delayMs:backoff,reason:String(error.message)});
      await sleep(backoff,signal);
    }
  }
  onState({source,state:'stopped'});
}

/** Separate dispatcher: notify must acknowledge host delivery, not wait for
 * inference completion. A restarted dispatcher reoffers unhandled facts. Host
 * adapter deduplicates delivery identities and never treats notification as
 * evidence of completed handling. One dispatcher/decision owner per Soul. */
export async function runWakeDispatcher({journal,notify,signal,retryable=()=>false,sleep=abortableSleep,pollMs=100}) {
  const deliveredGaps=new Set();let backoff=0,lastDeliveredSequence=0;
  while(!signal?.aborted){
    const fresh=journal.pending(1000,lastDeliveredSequence),gaps=journal.gaps();
    const liveGaps=new Set(gaps.map(g=>g.seq));
    for(const id of deliveredGaps)if(!liveGaps.has(id))deliveredGaps.delete(id);
    const freshGaps=gaps.filter(g=>!deliveredGaps.has(g.seq));
    if(fresh.length||freshGaps.length){
      try {
        await notify({pending:fresh,gaps:freshGaps});
        if(fresh.length)lastDeliveredSequence=fresh.at(-1).sequence;freshGaps.forEach(g=>deliveredGaps.add(g.seq));backoff=0;
      }catch(error){
        if(signal?.aborted)break;
        if(!retryable(error))throw error;
        backoff=Math.min(30000,backoff?backoff*2:1000);await sleep(backoff,signal);continue;
      }
    }
    await sleep(pollMs,signal);
  }
}
export function abortableSleep(ms,signal){
  if(signal?.aborted)return Promise.resolve();
  return new Promise(resolve=>{
    const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};
    const timer=setTimeout(done,ms);signal?.addEventListener('abort',done,{once:true});
  });
}
