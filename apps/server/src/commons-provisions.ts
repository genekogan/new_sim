import type {WorldHost} from './world.ts';
import type {Brain} from './brain.ts';
import type {Card} from '@sim/kernel';
import {COMMONS_PERSONAL_RESOURCES} from '@sim/engine-mars';

/** Birth-order evidence is stable through retirement/restart; slots are never
 * reassigned by a current cast sort. Only actual owned Souls receive cards. */
export async function installCommonsProvisionCards(host:WorldHost,brain:Brain){
  if(brain.host!==host)throw Error('commons-provisions.card-host-differs');
  const births=host.db.db.prepare("SELECT payload FROM events WHERE world_id=? AND kind='birth' ORDER BY seq LIMIT 8").all(host.worldId) as {payload:string}[];
  const verdicts=[];
  for(const [index,event] of births.entries()){
    const birth=JSON.parse(event.payload),m=host.minds.get(birth.soulId),row=host.db.soul(birth.soulId);if(!m||!row||row.retired_at!==null||row.owner!==m.owner||row.entity_id!==m.entityId)continue;
    const r=COMMONS_PERSONAL_RESOURCES[index],suffix=m.soulId.slice(2),meal=`eat prepared meal ${suffix}`,sleep=`sleep on ground mat ${suffix}`;
    const cards:Card[]=[
      {name:meal,summary:'Eat my prepared meal with a spoon and free both hands afterward.',good_when:'Hungry, with food in my own bowl; native reach, food and hand requirements apply.',target:null,when:[],then:[{set:['$actor','doing','eating a prepared meal']}],approach:[],during:[
        {verb:'mars:take_item',params:{item:r.bowl,hand:'left'}},{verb:'mars:take_item',params:{item:r.spoon,hand:'right'}},{verb:'mars:eat',params:{bowl:r.bowl,spoon:r.spoon}},
        {verb:'mars:put_item',params:{item:r.spoon,surfaceSlot:'ground'}},{verb:'mars:put_item',params:{item:r.bowl,surfaceSlot:'ground'}}],takes:'minute'},
      {name:sleep,summary:'Sleep on my clear ground sleeping area and return to standing.',good_when:'Tired, free hands and an unoccupied supported sleep envelope; use real ground sleep.',target:null,when:[],then:[{set:['$actor','doing','sleeping on a ground mat']}],approach:[],during:[{verb:'mars:sleep',params:{mat:r.mat,duration:600,returnTo:r.sleepReturn}}],takes:'long'},
      ...[r.bowl,r.spoon].map((item):Card=>({name:`return ${item} ${suffix}`,summary:'Put my held utensil on the ground and free the hand.',good_when:'A held bowl or spoon after an interrupted meal; tidy before sleep or another task.',target:null,when:[],then:[{set:['$actor','doing','tidying utensils']}],approach:[],during:[{verb:'mars:put_item',params:{item,surfaceSlot:'ground'}}],takes:'seconds'})),
    ];
    const pending=brain.mint(m,cards.filter(c=>!host.kernel.decks[m.soulId].cards.includes(c.name)),undefined,undefined,'compiled');
    let done=false;pending.finally(()=>done=true);for(let i=0;i<100&&!done;i++){host.drainInputs();await new Promise<void>(r=>setImmediate(r));}if(!done)throw Error('commons-provisions.card-mint-unsettled');verdicts.push(...await pending);
  }
  return verdicts;
}
