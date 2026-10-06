import {hashOf,humanCapabilityRegistryV1Schema,HUMAN_GOAL_POSTCONDITIONS_V1,type HumanGoalV1,type HumanCapabilityRegistryV1,type Program} from '@sim/engine-contract';
import {COMMONS_PERSONAL_RESOURCES,commonsFoodDeliveryItemsV1} from '@sim/engine-mars';
import {add2,rot2,wrapAngle,angleDelta} from '../../../mars/viewer/engine/core/math.ts';
import {CATALOG} from '../../../mars/viewer/engine/world/catalog.ts';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
import type {Card} from '@sim/kernel';
import {engineRef,registeredOptionsFor} from './deck.ts';
import type {WorldHost,Mind} from './world.ts';
export type HumanBindingV1={id:string;goal:HumanGoalV1['goal'];targetId?:string;label:string;aliases:string[];steps:Program['steps'];card:Card;available:boolean;blockedCode?:string;distance:number;green:boolean;reuseAgenda?:{card:string;target:string|null;hash:string};seatedWitness?:ReturnType<typeof observeSeatedHumanGoalV1>};
export type HumanRegistryReadV1={view:HumanCapabilityRegistryV1;bindings:Map<string,HumanBindingV1>};
const key=(goal:string,ref:string)=>goal+':'+ref;
/** Read-only actor-specific physical bindings. Kernel anchors alone do not invent native actions. */
export function readHumanCapabilitiesV1(host:WorldHost,m:Mind,options?:{registeredActivitiesV1?:boolean}):HumanRegistryReadV1 {
 const read=()=>{
  const w=host.engine.world as NativeWorld,body=w.entities[m.entityId],bindings=new Map<string,HumanBindingV1>();if(!body?.human)throw Error('human-capabilities.body-unavailable');
  const verbs=new Set(host.engine.describeVerbs().map(v=>v.verb)),humanoid=!body.body||body.body.family==='humanoid';
  const add=(goal:HumanGoalV1['goal'],id:string,label:string,targetId:string|undefined,steps:Program['steps'],approachLen:number,green=false)=>{
   const seatedWitness=goal==='sit'?observeSeatedHumanGoalV1(host,m,{goal:'sit',bindingId:id,seconds:60}):null;if(seatedWitness){const fixture=host.kernel.things[targetId!]?.traits.entity;steps=[{verb:'rest',params:{seconds:1,seatedAt:fixture}},{verb:'rest',params:{seconds:60,seatedAt:fixture}}];approachLen=1;}
   const issue=host.engine.canPerform({actor:m.entityId,label:'registered '+goal,steps}),target=targetId?host.kernel.things[targetId]:undefined,point=targetId?engineRef(host,targetId):null;
   const pos=typeof point==='string'?w.entities[point]?.pose.p:point?[point[0],0,point[1]]:undefined;
   const name='human goal '+goal.replace('_',' ')+' '+hashOf({goal,id,steps}).slice(0,12),card:Card={name,summary:`Perform the registered ${goal.replace('_',' ')} goal using native admission.`,good_when:'This specific owner goal is requested and the registered physical binding remains available.',target:null,when:[],then:[...(target?[{move:['$actor',target.id] as [string,string]}]:[]),{set:['$actor','doing',goal==='sit'?'sitting':goal==='eat'?'eating':goal==='rest'?'resting':'following an owner goal']}],approach:steps.slice(0,approachLen),during:steps.slice(approachLen),takes:goal==='rest'?'minute':'minutes'};
   const aliases=[label.toLowerCase(),...(targetId?[targetId.toLowerCase()]:[]),...(targetId==='eden-classroom-1'?['classroom','eden classroom','lecture room']:[])];const entity=targetId?w.entities[targetId]:undefined;if(entity?.def==='campfire')aliases.push('campfire','fire');const side=label.toLowerCase().match(/\b(north|south|east|west)\b/)?.[1];if(entity?.def==='bench-6ft'&&side&&/fire/i.test(label))aliases.push(`${side} bench by the campfire`,`${side} campfire bench`,`campfire ${side} bench`,`fire bench ${side}`);
   bindings.set(id,{id,goal,targetId,label,aliases:[...new Set(aliases)],steps,card,available:!issue,...(issue?{blockedCode:issue.code}:{}),...(seatedWitness?{seatedWitness}:{}),distance:pos?Math.hypot(pos[0]-body.pose.p[0],pos[2]-body.pose.p[2]):0,green});
  };
  for(const a of host.engine.anchors()){
   const t=host.kernel.things[a.id];if(!t||t.by!=='world'||t.kind!=='place'||!engineRef(host,a.id))continue;
   if(verbs.has('walk_to')){add('walk',key('walk',a.id),a.name,a.id,[{verb:'walk_to',params:{to:a.id}},{verb:'rest',params:{seconds:1}}],1);
    add('hang_out',key('hang_out',a.id),a.name,a.id,[{verb:'walk_to',params:{to:a.id}},{verb:'rest',params:{seconds:60}}],1,/\b(?:tree|garden|forest|grove|green)\b/i.test(a.name));}
   const entity=a.entity?w.entities[a.entity]:undefined;if(humanoid&&verbs.has('sit')&&entity&&CATALOG[entity.def]?.slots?.some(s=>s.kind==='seat'))add('sit',key('sit',a.id),a.name,a.id,[{verb:'sit',params:{on:entity.id,seconds:1}},{verb:'rest',params:{seconds:60}}],1);
  }
  if(verbs.has('rest'))add('rest','rest:self','Rest here',undefined,[{verb:'rest',params:{seconds:60}}],0);
  if(humanoid&&verbs.has('mars:eat')&&/\+(?:commons-provisions\/1|cp\/2)(?:\+|$)/.test(host.engine.rulesVersion)){
   const resources=[...COMMONS_PERSONAL_RESOURCES,...(host.engine.commonsNewcomerResourcesV1?.()??[])];
   const births=host.db.db.prepare("SELECT payload FROM events WHERE world_id=? AND kind='birth' ORDER BY seq LIMIT ?").all(host.worldId,resources.length) as {payload:string}[],i=births.findIndex(b=>JSON.parse(b.payload).soulId===m.soulId);
   if(i>=0){const meals=[{batch:0,...resources[i]},...(i<COMMONS_PERSONAL_RESOURCES.length?(host.engine.commonsFoodDeliveriesV1?.()??[]).map(d=>({batch:d.batch,...commonsFoodDeliveryItemsV1(d.batch).resources[i]})):[])];for(const r of meals)if(w.entities[r.bowl]&&w.entities[r.spoon])add('eat',key('eat',r.bowl),`My meal ${r.batch}`,undefined,[{verb:'mars:take_item',params:{item:r.bowl,hand:'left'}},{verb:'mars:take_item',params:{item:r.spoon,hand:'right'}},{verb:'mars:eat',params:{bowl:r.bowl,spoon:r.spoon}},{verb:'mars:put_item',params:{item:r.spoon,surfaceSlot:'ground'}},{verb:'mars:put_item',params:{item:r.bowl,surfaceSlot:'ground'}}],2);}
  }
  if(options?.registeredActivitiesV1)for(const option of registeredOptionsFor(host,m,128)){
   if(!host.ownLectureRosterV1(m.soulId,option.steps))continue;
   if(option.card.startsWith('human goal '))continue;const card=host.kernel.vocab.cards[option.card];if(!card||card.hash!==option.hash||!host.kernel.decks[m.soulId].cards.includes(option.card))continue;
   const target=option.cardTarget?host.kernel.things[option.cardTarget]:undefined,ready=card.during.some(s=>s.verb==='activity_readiness_v1'),prepared=card.during.some(s=>s.verb==='mars:classroom_session'&&s.params.handoverScope==='owned-readiness/1'),label=ready?'Prepare for my Eden lecture':prepared?'Host a prepared Eden lecture':(option.card+(target?' '+target.name:'')).slice(0,100),id='activity:'+hashOf({card:option.card,hash:option.hash,target:option.cardTarget}).slice(0,24);
   bindings.set(id,{id,goal:'activity',targetId:option.cardTarget??undefined,label,aliases:[...new Set([label.toLowerCase(),option.card.toLowerCase(),option.label.toLowerCase(),('perform '+label).toLowerCase()])].filter(a=>a.length<=100),steps:structuredClone(option.steps),card:structuredClone(card),available:option.available!==false,...(option.blockedCode?{blockedCode:option.blockedCode}:{}),distance:0,green:false,reuseAgenda:{card:option.card,target:option.cardTarget,hash:option.hash}});
  }
  const goals=([...new Set([...bindings.values()].map(b=>b.goal))]).map(id=>({id,description:`Registered ${id.replace('_',' ')} using actual native state.`,postcondition:HUMAN_GOAL_POSTCONDITIONS_V1[id],bindings:[...bindings.values()].filter(b=>b.goal===id).map(b=>({id:b.id,label:b.label,aliases:b.aliases,...(b.targetId?{targetId:b.targetId}:{}),available:b.available,...(b.blockedCode?{blockedCode:b.blockedCode}:{})}))}));
  const registryHash=hashOf({worldId:host.worldId,soulId:m.soulId,entityId:m.entityId,rules:host.engine.rulesVersion,goals,bindings:[...bindings.values()].map(b=>({id:b.id,steps:b.steps,target:b.targetId?(w.entities[b.targetId]??w.regions[b.targetId]??null):null}))});
  return {view:humanCapabilityRegistryV1Schema.parse({contract:options?.registeredActivitiesV1?'human-capabilities/2':'human-capabilities/1',worldId:host.worldId,soulId:m.soulId,entityId:m.entityId,tick:host.engine.world.tick,registryHash,goals}),bindings};
 };return host.engine.withFeasibilityRead?host.engine.withFeasibilityRead(read):read();
}
/** Only explicitly supported basic forms bypass model naming. Unknown text is never a best-fit action. */
export function basicHumanGoalV1(words:string,read:HumanRegistryReadV1,strict:boolean):{goal?:HumanGoalV1;adaptation?:{originalGoal:'hang_out';substituteBindingId:string;explanation:string};blocked?:HumanBindingV1}|null {
 const text=words.trim().toLowerCase().replace(/^please\s+/,'').replace(/[.!?]$/,'').replace(/\s+(?:now|please)$/,'');let type:HumanGoalV1['goal']|undefined,selector:(b:HumanBindingV1)=>boolean=()=>true,adaptation;
 if(/^(?:go )?sit (?:down )?on (?:a|the) bench$/.test(text)){type='sit';selector=b=>/bench/i.test(b.label);}
 else if(/^(?:go )?rest(?: here)?$/.test(text))type='rest';
 else if(/^(?:go )?eat(?: (?:my |a )?(?:meal|food))?$/.test(text))type='eat';
 else {const walk=text.match(/^(?:go to|walk to) (.+)$/);if(walk){type='walk';const label=walk[1].replace(/^the /,'');selector=b=>b.aliases.includes(label);}
  else if(text==='go hang out by the garden'||text==='hang out by the garden'){type='hang_out';const exact=[...read.bindings.values()].find(b=>b.goal==='hang_out'&&/\bgarden\b/i.test(b.label));if(exact)selector=b=>b.id===exact.id;else if(!strict){selector=b=>b.green;adaptation=true;}else return null;}
 }
 if(!type){
  const readyWords=/^(?:prepare|get ready|be ready) for (?:(?:my|the|a|an) )?(?:eden )?lecture$/.test(text);
  const hostWords=/^(?:host|start) (?:(?:my|the|a|an) )?prepared (?:eden )?lecture$/.test(text);
  const matching=[...read.bindings.values()].filter(b=>b.goal==='activity'&&(b.aliases.includes(text)
   ||hostWords&&b.card.during.some(s=>s.verb==='mars:classroom_session'&&s.params.handoverScope==='owned-readiness/1')
   ||readyWords&&b.card.during.some(s=>s.verb==='activity_readiness_v1')
   ||text==='end my eden lecture'&&b.card.during[0]?.verb==='control_classroom_v1'&&b.card.during[0].params.kind==='cancel'
   ||text==='advance my eden lecture'&&b.card.during[0]?.verb==='control_classroom_v1'&&b.card.during[0].params.kind==='advance'));
  const available=matching.filter(b=>b.available);
  return available.length===1?{goal:{goal:'activity',bindingId:available[0].id}}:matching.length===1?{blocked:matching[0]}:null;
 }
 const choices=[...read.bindings.values()].filter(b=>b.goal===type&&selector(b)).sort((a,b)=>Number(b.available)-Number(a.available)||a.distance-b.distance||a.id.localeCompare(b.id));if(!choices.length)return null;const b=choices[0];if(!b.available)return {blocked:b};
 const goal:HumanGoalV1=type==='rest'?{goal:'rest',seconds:60}:type==='sit'||type==='hang_out'?{goal:type,bindingId:b.id,seconds:60}:{goal:type,bindingId:b.id};
 return {goal,...(adaptation?{adaptation:{originalGoal:'hang_out' as const,substituteBindingId:b.id,explanation:`There is no named garden; spend time by ${b.label} instead.`}}:{})};
}

/** A read-only seated postcondition requires the live native claim and exact catalogue contact/facing. */
export function observeSeatedHumanGoalV1(host:WorldHost,m:Mind,goal:HumanGoalV1){
 if(goal.goal!=='sit')return null;const row=host.db.soul(m.soulId),w=host.engine.world as NativeWorld,body=w.entities[m.entityId];if(!row||row.retired_at!==null||row.owner!==m.owner||row.entity_id!==m.entityId||!body?.human||body.human.activity!=='sit')return null;
 const target=goal.bindingId.slice('sit:'.length),kernel=host.kernel.things[target],fixture=typeof kernel?.traits.entity==='string'?w.entities[kernel.traits.entity]:undefined;if(!fixture)return null;if(fixture.support?.kind==='ground'&&(body.human.level!==0||Math.abs(body.pose.p[1]-fixture.pose.p[1])>.001))return null;
 const live=new Set(host.engine.runtime.liveIds());
 for(const record of host.engine.runtime.records.values()){
  const params=record.params as Record<string,unknown>;
  if(!live.has(record.id)||record.verb!=='sit'||record.phase!=='occupied'||params.actor!==m.entityId||params.fixture!==fixture.id&&!(typeof params.slot==='string'&&params.slot.startsWith(fixture.id+'#')))continue;
  for(const slot of CATALOG[fixture.def]?.slots??[]){if(slot.kind!=='seat')continue;const id=fixture.id+'#'+slot.id;if(params.slot&&params.slot!==id)continue;const p=add2([fixture.pose.p[0],fixture.pose.p[2]],rot2(slot.local,fixture.pose.yaw)),yaw=wrapAngle(fixture.pose.yaw+slot.yaw);
   if(Math.hypot(p[0]-body.pose.p[0],p[1]-body.pose.p[2])<=.001&&Math.abs(angleDelta(yaw,body.pose.yaw))<=.03)return {contract:'native-seated-postcondition/1' as const,tick:host.engine.world.tick,actor:m.entityId,fixtureId:fixture.id,slotId:id,nativeActionId:record.id,position:[...body.pose.p],yaw:body.pose.yaw};
  }
 }return null;
}
