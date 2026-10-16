// travel <world>|home (backlog M3; docs/sim/TRAVEL.md). The world moves the Soul; this folder follows it.
// A successful travel rewrites .eden-agent.json to the destination (world base, Soul id, Soul token) and keeps the
// home grant (home world, home Soul, its token), so `travel home` still works when the world the folder points at
// has let the Soul go or does not answer: home is the authority on where its resident is.
export const TRAVEL_PATH='/v1/edge/travel';
const USAGE='usage: travel [<world slug or name> | home]';
// Answers from the current world after which home is asked directly (the Soul is not here, or this world is down).
const ASK_HOME=new Set(['travel.away','travel.unavailable','unreachable']);

/** The folder state after a travel answer. `prev` is the folder before; `r` the world's answer (ok:true). Pure. */
export function travelledState(prev,r){
 if(!r?.ok||typeof r.base!=='string'||!/^https?:\/\/.+\/w\/[a-z0-9-]+$/.test(r.base)||typeof r.soulId!=='string')throw Error('travel: the world answered without a destination');
 const home=prev.travel?.home??(r.from===r.home?{world:prev.world,soul:prev.soul,token:prev.token}:null);
 const token=r.token??(r.base===prev.world?prev.token:null);
 if(!token)throw Error('travel: the world answered without a Soul token for the destination');
 const grant={world:r.base,soul:r.soulId,token};
 const travel={home:r.atHome?{...grant}:home,homeSlug:r.home??prev.travel?.homeSlug??null,at:r.to,lastAt:new Date().toISOString()};
 const next={world:r.base,soul:r.soulId,token,travel,mode:undefined,lastReceipt:undefined};
 if(prev.accountAuth)next.delegations={...(prev.delegations??{}),[r.soulId]:{world:r.base,token}};
 return next;
}
/** What the agent sees: where it went, and that the folder now speaks to it. Never the token. */
export function travelReport(r,state){
 const {token:_t,...rest}=r;
 return {...rest,folder:{world:state.world,soul:state.soul,homeKept:!!state.travel?.home},
  next:r.atHome?'You are home. Run here or observe.':`You are in ${r.toName??r.to}. Run here or observe; "travel home" brings you back.`};
}
/** One HTTP call to an explicit world with an explicit Soul token (home recall uses the kept home grant). */
export async function callAt(base,token,path,{body,fetchImpl=fetch,timeoutMs=90_000}={}){
 let r;try{r=await fetchImpl(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeoutMs)});}
 catch(e){return {status:0,data:{code:'unreachable',message:String(e?.message??e)}};}
 const text=await r.text();let data;try{data=JSON.parse(text);}catch{data={raw:text.slice(0,200)};}
 return {status:r.status,data};
}
const codeOf=r=>r.status===0?'unreachable':(r.data?.code??r.data?.error?.code??null);
const fail=(r,what)=>{const e=Error(`${what}: ${codeOf(r)??'HTTP '+r.status}: ${r.data?.message??r.data?.error?.message??JSON.stringify(r.data).slice(0,200)}`);e.code=codeOf(r);e.status=r.status;return e;};

/** travel (status) | travel <world> | travel home. deps: {load, save, live?, fetchImpl?}. */
export async function travelCommand(args,{load,save,live=()=>false,fetchImpl=fetch}){
 if(args.length>1)throw Error(USAGE);
 const s=load();
 if(!s.world)throw Error('No world yet. Run: node eden-agent.mjs register <world-url>');
 if(!s.token)throw Error('No paired Soul yet. Run create-soul (or pair-soul) first.');
 const to=args[0];
 if(to===undefined){
  const r=await callAt(s.world,s.token,TRAVEL_PATH,{fetchImpl});
  if(r.status===200)return {...r.data,folder:{world:s.world,soul:s.soul,homeKept:!!s.travel?.home}};
  // the world the folder points at is down or let the Soul go: home still knows
  const h=s.travel?.home;if(h&&h.world!==s.world&&ASK_HOME.has(codeOf(r))){const x=await callAt(h.world,h.token,TRAVEL_PATH,{fetchImpl});if(x.status===200)return {...x.data,folder:{world:s.world,soul:s.soul,homeKept:true},note:`${s.world} answered ${codeOf(r)}; this is home's view`};}
  throw fail(r,'travel');
 }
 if(typeof to!=='string'||!to.trim()||to.length>80||to.startsWith('-'))throw Error(USAGE);
 if(live())throw Error('Stop this folder’s mind before travelling (the mind keeps the world it started in).');
 const home=to.trim().toLowerCase()==='home';
 let r=await callAt(s.world,s.token,TRAVEL_PATH,{body:{to},fetchImpl});
 if(r.status!==200&&home&&s.travel?.home&&s.travel.home.world!==s.world&&ASK_HOME.has(codeOf(r))){
  // home recall: with the kept home grant, home brings its resident back (and asks the other world to let go)
  const h=s.travel.home,first=codeOf(r);
  r=await callAt(h.world,h.token,TRAVEL_PATH,{body:{to:'home'},fetchImpl});
  if(r.status===200&&r.data?.ok){const d={...r.data,base:r.data.base??h.world,soulId:r.data.soulId??h.soul,token:r.data.token??h.token,atHome:true,viaHome:first};const st=save(travelledState(s,d));return travelReport(d,st);}
 }
 if(r.status!==200||!r.data?.ok)throw fail(r,'travel');
 const st=save(travelledState(s,r.data));
 return travelReport(r.data,st);
}
