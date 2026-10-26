// Install finite two-seat rowing rides from the engine's admitted water, never from scenery labels.
// A native rules fact goes first; the ordinary `ride` object is only offered after the carrier really exists.
import type {WorldHost} from './world.ts';
import type {EdgeLedger} from './edge/ledger/ledger.ts';
import type {CarrierInstallSpec} from '../../../mars/viewer/engine/vehicles/carrier.ts';

type SearchResult={state:'pending'}|{state:'cancelled'}|{state:'done';candidates:CarrierInstallSpec[]};
type SearchJob={advance(budgetMs:number):SearchResult;cancel():unknown};
const SEARCH_SLICE_MS=8;

export function installPuntActivities(host:WorldHost,edge:EdgeLedger,log:(text:string)=>void=()=>{}){
  const current=()=>host.engine as typeof host.engine&{puntCandidatesV1?():CarrierInstallSpec[];puntCandidatesJobV1?():SearchJob;carriers?():{id:string;def:string;label:string;state:{bank?:{door:number[]}}}[]};
  if(!current().puntCandidatesV1)return {close(){}};
  let busy=false,closed=false,lastSource='',retryAt=0;
  let lastEngine=host.engine;
  let pending:{engine:typeof host.engine;job:SearchJob;source:string;started:number}|null=null,restart=false;
  const publish=()=>{
    if(closed||!edge.comms)return;
    for(const c of current().carriers?.()??[]){if(c.def!=='rowing-punt')continue;
      const door=c.state.bank?.door,place=door?edge.places.containing(door[0],door[2],0)[0]:null;
      const parent=place?.id??[...edge.places.byId.values()].find(p=>p.parent===null)?.id;
      // S1: create() keeps an existing object, so an existing ride is skipped by its id alone (no transaction, no parse)
      if(parent&&!edge.comms.objects.has?.(`ride-${c.id}`))edge.comms.objects.create({id:`ride-${c.id}`,kind:'ride',name:c.label,placeId:parent,params:{carrier:c.id,vehicle:'punt'}});
    }
  };
  const install=(candidates:CarrierInstallSpec[],engine:typeof host.engine)=>{
    const missing=candidates.filter(s=>!(engine.world.entities[s.id] as {carrier?:unknown}|undefined)?.carrier);
    if(!missing.length)return;
    busy=true;
    // Host owns sequencing and durable publication. Never mutate engine entities from a presentation hook.
    // Both host preview and engine fold still validate against live geometry after this speculative search.
    void (async()=>{for(const spec of missing){if(closed||host.engine!==engine)break;try{await host.installCarrierV1(spec);log(`rowing punt installed: ${spec.id}`);}catch(error){log(`rowing punt refused: ${error instanceof Error?error.message:String(error)}`);}}if(host.engine===engine)publish();})()
      .finally(()=>{busy=false;});
  };
  const reconcile=()=>{
    if(closed||busy||!edge.comms)return;
    const engine=current(),tick=engine.world.tick;
    if(engine!==lastEngine){pending?.job.cancel();pending=null;lastEngine=engine;lastSource='';retryAt=0;restart=true;}
    const w=engine.world as typeof engine.world&{groundV1?:{recipeHash:string}};
    const source=w.groundV1?.recipeHash??w.base.staticHash;
    try{
      if(!pending){
        if(!restart&&source===lastSource&&tick<retryAt)return;
        restart=false;
        if(!engine.puntCandidatesJobV1){
          // Older adapters retain their synchronous API; Mars always takes the resumable path.
          lastSource=source;retryAt=tick+20*60;install(engine.puntCandidatesV1!(),engine);return;
        }
        pending={engine,job:engine.puntCandidatesJobV1(),source,started:tick};
      }
      const work=pending,result=work.job.advance(SEARCH_SLICE_MS);
      if(result.state==='pending')return;
      pending=null;
      if(result.state==='cancelled'){restart=true;return;}
      lastSource=work.source;retryAt=work.started+20*60;
      install(result.candidates,work.engine);
    }catch(error){
      pending?.job.cancel();pending=null;restart=false;lastSource=source;retryAt=tick+20;
      log(`rowing punt search failed: ${error instanceof Error?error.message:String(error)}`);
    }
  };
  // In a served world the first look (a lattice search of each water without a punt, ~0.25 s on Eden 2026, memoised after)
  // waits 10 s of world time after boot (lane P5). Once started, each completed tick advances one short slice: a
  // once-a-second slice would turn a bounded search into a minute-long wait. Manually stepped worlds start at once.
  let first=-1;
  const listener={afterTick:(tick:number)=>{
    if(first<0)first=host.running?tick:-Infinity;
    if(closed)return;
    if(tick%20===0)publish();
    if(pending||restart||host.engine!==lastEngine||tick%20===0&&tick-first>=200)reconcile();
  }};
  host.listeners.push(listener);
  return {close(){closed=true;pending?.job.cancel();pending=null;const at=host.listeners.indexOf(listener);if(at>=0)host.listeners.splice(at,1);}};
}
