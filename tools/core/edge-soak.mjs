// Edge soak: N Soul tokens run observe → pick a legal capability → act → wait, plus say/converse,
// against an edge server. Reports receipt outcomes, refusal codes, latency and stuck receipts.
// Usage: node tools/core/edge-soak.mjs <baseUrl> <seconds> <token>...   (fake, no models)
const [base,secondsArg,...tokens]=process.argv.slice(2);
if(!base||!tokens.length){console.error('usage: edge-soak <baseUrl> <seconds> <token>...');process.exit(2);}
const until=Date.now()+Number(secondsArg??120)*1000,stats={acts:0,accepted:0,refused:{},phases:{},says:0,heard:0,converse:0,errors:0,actMs:[]},open=new Map();
const req=async(tok,method,path,body)=>{const r=await fetch(base+path,{method,headers:{authorization:'Bearer '+tok,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();if(j.contract!=='eden-edge/1')throw Error('missing contract on '+path);return {status:r.status,j};};
const pick=a=>a[Math.floor(Math.random()*a.length)];
async function agent(tok,i){
  let cursor=(await req(tok,'GET','/v1/edge/observe')).j.streamCursor;
  while(Date.now()<until){
    try{
      const o=(await req(tok,'GET','/v1/edge/observe?include=capabilities')).j,caps=o.capabilities.filter(c=>c.available);
      const r=Math.random();
      if(r<0.2&&o.here.souls.length){const t0=Date.now();await req(tok,'POST','/v1/edge/say',{text:`soak ${i} says hello at ${o.tick}`});stats.says++;void t0;}
      else if(r<0.25&&o.here.souls.length){const other=o.here.souls[0];const c=(await req(tok,'POST','/v1/edge/converse',{op:'start',with:[other.soulId],text:'shall we talk?'})).j;if(c.accepted)stats.converse++;}
      else{
        const pool=caps.filter(c=>['go-near','sit','walk','swim','rest','hang-out','stand'].includes(c.verb)),cap=pick(pool.length?pool:caps);
        const params=cap.params?.seconds?{seconds:5+Math.floor(Math.random()*20)}:{};
        const t0=Date.now(),a=(await req(tok,'POST','/v1/edge/act',{capability:cap.id,params})).j;stats.actMs.push(Date.now()-t0);stats.acts++;
        if(a.accepted){stats.accepted++;open.set(a.receipt.id,{tok,at:Date.now()});}else stats.refused[a.code]=(stats.refused[a.code]??0)+1;
      }
      const w=(await req(tok,'GET',`/v1/edge/wait?after=${encodeURIComponent(cursor)}&timeout=${3+Math.floor(Math.random()*8)}`)).j;cursor=w.cursor??cursor;
      for(const e of w.events??[]){if(e.kind==='receipt'&&!['waiting','started'].includes(e.receipt.phase)){stats.phases[e.receipt.phase+(e.receipt.code?':'+e.receipt.code:'')]=(stats.phases[e.receipt.phase+(e.receipt.code?':'+e.receipt.code:'')]??0)+1;open.delete(e.receipt.id);}if(e.kind==='speech')stats.heard++;}
    }catch(e){stats.errors++;if(stats.errors<5)console.error('agent',i,String(e).slice(0,200));await new Promise(r=>setTimeout(r,500));}
  }
}
await Promise.all(tokens.map((t,i)=>agent(t,i)));
await new Promise(r=>setTimeout(r,90_000));      // let started receipts finish
const stuck=[];for(const [id,{tok}] of open){const r=(await req(tok,'GET','/v1/edge/receipts/'+id)).j.receipt;if(['waiting','started'].includes(r.phase))stuck.push({id,phase:r.phase,capability:r.capability,acceptedTick:r.acceptedTick});else{const k=r.phase+(r.code?':'+r.code:'');stats.phases[k]=(stats.phases[k]??0)+1;}}
const ms=stats.actMs.sort((a,b)=>a-b);
console.log(JSON.stringify({agents:tokens.length,acts:stats.acts,accepted:stats.accepted,refused:stats.refused,outcomes:stats.phases,says:stats.says,heardSpeechEvents:stats.heard,conversationsStarted:stats.converse,errors:stats.errors,actLatencyMs:{p50:ms[Math.floor(ms.length/2)],p95:ms[Math.floor(ms.length*.95)]},stuckAfter90s:stuck},null,1));
