// Install finite two-seat rowing rides from the engine's admitted water, never from scenery labels.
// A native rules fact goes first; the ordinary `ride` object is only offered after the carrier really exists.
import type {WorldHost} from './world.ts';
import type {EdgeLedger} from './edge/ledger/ledger.ts';
import type {CarrierInstallSpec} from '../../../mars/viewer/engine/vehicles/carrier.ts';

export function installPuntActivities(host:WorldHost,edge:EdgeLedger,log:(text:string)=>void=()=>{}){
  const current=()=>host.engine as typeof host.engine&{puntCandidatesV1?():CarrierInstallSpec[];carriers?():{id:string;def:string;label:string;state:{bank?:{door:number[]}}}[]};
  if(!current().puntCandidatesV1)return {close(){}};
  let busy=false,closed=false,lastSource='',retryAt=0;
  const publish=()=>{
    if(!edge.comms)return;
    for(const c of current().carriers?.()??[]){if(c.def!=='rowing-punt')continue;
      const door=c.state.bank?.door,place=door?edge.places.containing(door[0],door[2],0)[0]:null;
      const parent=place?.id??[...edge.places.byId.values()].find(p=>p.parent===null)?.id;
      // S1: create() keeps an existing object, so an existing ride is skipped by its id alone (no transaction, no parse)
      if(parent&&!edge.comms.objects.has?.(`ride-${c.id}`))edge.comms.objects.create({id:`ride-${c.id}`,kind:'ride',name:c.label,placeId:parent,params:{carrier:c.id,vehicle:'punt'}});
    }
  };
  const reconcile=()=>{
    if(closed||busy||!edge.comms)return;
    publish();
    const w=host.engine.world as typeof host.engine.world&{groundV1?:{recipeHash:string}};
    const source=w.groundV1?.recipeHash??w.base.staticHash;
    if(source===lastSource&&host.engine.world.tick<retryAt)return;
    lastSource=source;retryAt=host.engine.world.tick+20*60;
    const missing=current().puntCandidatesV1!().filter(s=>!(host.engine.world.entities[s.id] as {carrier?:unknown}|undefined)?.carrier);
    if(!missing.length)return;
    busy=true;
    // Host owns sequencing and durable publication. Never mutate engine entities from a presentation hook.
    void (async()=>{for(const spec of missing){if(closed)break;try{await host.installCarrierV1(spec);log(`rowing punt installed: ${spec.id}`);}catch(error){log(`rowing punt refused: ${error instanceof Error?error.message:String(error)}`);}}publish();})()
      .finally(()=>{busy=false;});
  };
  const listener={afterTick:(tick:number)=>{if(tick%20===0)reconcile();}};
  host.listeners.push(listener);
  return {close(){closed=true;const at=host.listeners.indexOf(listener);if(at>=0)host.listeners.splice(at,1);}};
}
