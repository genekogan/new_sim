// A receiver persists facts. It never acknowledges owner instructions, decides
// priorities, starts inference, or writes to a world. Transport is injected so
// the same contract applies to SSE, long-poll and synthetic fault injection.
export async function receivePage(journal, source, read, {signal,onCommitted=()=>{},initial=false,onReady} = {}) {
  const after=journal.cursor(source);
  const page=await read({after,signal,initial,onReady});
  if(signal?.aborted) return {aborted:true}; // cursor unchanged: safe to replay
  const result=journal.ingest({source,after,cursor:page.cursor,events:page.events,gap:page.gap??false});
  if(page.events.length)onCommitted({source,state:'events-persisted',events:page.events.map(event=>({source,id:event.id})),committedAt:Date.now()});
  return {...result,pending:journal.pending().length};
}

/** Receiver never waits for a host notification or model response. Terminal
 * auth/supersession propagates; only explicitly classified errors retry.
 *
 * Backoff counts consecutive failed connects, not quiet time. A stream the
 * server admitted (validated hello) that stayed open at least minHealthyMs and
 * then ended is a normal rotation (an idle world closes its event stream about
 * every 65 s): it resets the backoff and reconnects within healthyReconnectMs
 * jitter. A connect that fails, is refused (non-2xx) or dies sooner keeps the
 * exponential backoff, and a Retry-After the world states (429/503) is honoured
 * as a floor (+0-20 % jitter), so a failing or busy server is never stormed.
 * One read is outstanding per source, so reconnecting never adds a long-poll. */
export async function runReceiver({journal,source,read,signal,onState=()=>{},retryable=()=>false,sleep=abortableSleep,maxBackoffMs=30000,healthyReconnectMs=1000,minHealthyMs=5000,maxRetryAfterMs=120000,random=Math.random,now=Date.now}) {
  let backoff=0,ready=false,connectedAt=null;
  const markReady=mode=>{if(!ready&&!signal?.aborted){ready=true;onState({source,state:'receiver-ready',successful:true,mode,at:Date.now()});}};
  while(!signal?.aborted){
    try {
      onState({source,state:'receiving'});
      const result=await receivePage(journal,source,read,{signal,onCommitted:onState,initial:!ready,onReady:proof=>{if(proof?.successful!==true)return;connectedAt=now();if(proof.mode==='stream-adopted')markReady('stream-adopted');}});
      if(result.aborted)break;
      markReady('page-committed');
      backoff=0;
    }catch(error){
      if(signal?.aborted)break;
      if(!retryable(error)){
        onState({source,state:'blocked',reason:String(error.message)});
        throw error;
      }
      const statedMs=Number.isFinite(error?.retryAfterMs)&&error.retryAfterMs>0?Math.min(maxRetryAfterMs,error.retryAfterMs):0;
      const lived=connectedAt===null?null:now()-connectedAt;connectedAt=null;
      const extra={reason:String(error.message),...(typeof error.code==='string'?{code:error.code}:{}),...(statedMs?{retryAfterMs:statedMs}:{})};
      let delayMs;
      if(lived!==null&&lived>=minHealthyMs&&!statedMs){
        backoff=0;delayMs=Math.floor(random()*healthyReconnectMs);
        onState({source,state:'reconnecting',delayMs,connectedMs:lived,...extra});
      }else{
        backoff=Math.min(maxBackoffMs,backoff?backoff*2:1000);
        delayMs=statedMs?Math.max(backoff,statedMs+Math.floor(random()*statedMs*0.2)):backoff;
        onState({source,state:'retrying',delayMs,...extra});
      }
      await sleep(delayMs,signal);
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
