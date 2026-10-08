/** Existing Hub ping/pong consumer. Uses a monotonic local clock, not Date.now.
 * Bounds assume the sampled server clock progresses normally between probes.
 * They are transport timestamp uncertainty, never acoustic output latency. */
export function createServerClock({worldId,maxRttMs=1000,maxAgeMs=5000}={}){
  if(!worldId||!Number.isFinite(maxRttMs)||maxRttMs<=0||!Number.isFinite(maxAgeMs)||maxAgeMs<=0)throw new Error('Invalid clock bounds.');
  let epoch=null,sequence=0,pending=null,sample=null,last=null;
  function time(value){if(!Number.isFinite(value)||value<0||last!==null&&value<last){pending=null;sample=null;throw new Error('Local monotonic clock regressed.');}last=value;return value;}
  function disconnect(){epoch=null;pending=null;sample=null;last=null;}
  function connect(welcome){disconnect();if(welcome?.t!=='welcome'||welcome.worldId!==worldId||typeof welcome.epoch!=='string'||!welcome.epoch)throw new Error('Selected world welcome required.');epoch=welcome.epoch;}
  function begin(localNowMs){time(localNowMs);if(!epoch)throw new Error('Clock transport disconnected.');
    if(pending&&localNowMs-pending.sent<=maxRttMs)throw new Error('Clock probe already pending.');
    if(!Number.isSafeInteger(++sequence))throw new Error('Clock probe sequence exhausted.');
    pending={n:sequence,sent:localNowMs};return {t:'ping',n:sequence};
  }
  function accept(pong,localReceivedMs){time(localReceivedMs);
    if(!epoch||!pending||pong?.t!=='pong'||pong.n!==pending.n||!Number.isSafeInteger(pong.serverTime)||pong.serverTime<0)return {kind:'rejected'};
    const sent=pending.sent;pending=null;const rttMs=localReceivedMs-sent;
    if(rttMs<0||rttMs>maxRttMs){sample=null;return {kind:'expired'};}
    // Include one millisecond on each side for integer server timestamp granularity.
    const lower=pong.serverTime-localReceivedMs-1,upper=pong.serverTime-sent+1;
    if(sample&&localReceivedMs-sample.received<=maxAgeMs&&(upper<sample.lower||lower>sample.upper)){
      sample=null;return {kind:'discontinuity'};
    }
    sample={lower,upper,rttMs,received:localReceivedMs};return {kind:'accepted',rttMs};
  }
  function estimate(localNowMs){time(localNowMs);if(!epoch||!sample||localNowMs-sample.received>maxAgeMs)return null;
    const earliestServerTimeMs=Math.floor(localNowMs+sample.lower),latestServerTimeMs=Math.ceil(localNowMs+sample.upper);
    const serverNowMs=Math.floor(earliestServerTimeMs+(latestServerTimeMs-earliestServerTimeMs)/2);
    if(!Number.isSafeInteger(earliestServerTimeMs)||!Number.isSafeInteger(latestServerTimeMs)||earliestServerTimeMs<0)return null;
    return {serverNowMs,earliestServerTimeMs,latestServerTimeMs,
      uncertaintyMs:Math.max(serverNowMs-earliestServerTimeMs,latestServerTimeMs-serverNowMs),
      rttMs:sample.rttMs,ageMs:localNowMs-sample.received,transportEpoch:epoch};
  }
  return Object.freeze({connect,disconnect,begin,accept,estimate});
}
