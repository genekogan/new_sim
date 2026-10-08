// Rigid sculpture bodies keep their native route and occupancy semantics. The
// offers describe gliding/hovering honestly and never promise hands or limbs.
import type {EdgeSoul,EdgeCapability} from '../edge/contract.ts';
import type {WorldHost} from '../world.ts';
import type {Entity as NativeEntity} from '../../../../mars/viewer/engine/world/types.ts';
import type {WorldPlans} from './mars-edge.ts';
const RIGID_VERBS=new Set(['walk','stroll','wander','go-near','face','rest','gather','stand','follow','accept','decline','ask-to-stop','make']);
export function floaterEdgeProfile(host:WorldHost){return(soul:EdgeSoul,caps:EdgeCapability[],plans:WorldPlans)=>{
 const body=host.engine.world.entities[soul.entityId] as NativeEntity|undefined;if(body?.body?.family!=='floater')return;
 for(let i=caps.length-1;i>=0;i--)if(!RIGID_VERBS.has(caps[i].verb)){plans.delete(caps[i].id);caps.splice(i,1);}
 for(const cap of caps){
  if(cap.verb==='walk')cap.label=`Glide to ${host.engine.world.regions[cap.target?.id??'']?.label??cap.target?.id??'the destination'}`;
  if(cap.verb==='walk'||cap.verb==='stroll'||cap.verb==='wander'||cap.verb==='go-near'||cap.verb==='follow')cap.label=cap.label.replace(/Walk|Stroll|Go near|Follow/g,word=>word==='Go near'?'Glide near':word==='Follow'?'Glide alongside':'Glide').replace(/walk|stroll/g,'glide');
  if(cap.verb==='gather')cap.label=cap.label.replace('Gather','Hover together');
  if(cap.id==='stand:here'){cap.label='Resume cruising hover / stop what I am doing';const p=plans.get(cap.id);if(p)p.label=cap.label;}
 }
 const label='Hover and rest here';caps.push({id:'hover:here',verb:'hover',label,available:true,params:{seconds:{type:'integer',min:1,max:600,default:60}}});
 plans.set('hover:here',{label,steps:[{verb:'rest',params:{seconds:60}}],seconds:true});
 if(host.engine.world.regions.garden){
  const label='Glide to the garden and bask',steps=[{verb:'walk_to',params:{to:'garden'}},{verb:'rest',params:{seconds:180}}];
  const issue=host.engine.canPerform({actor:soul.entityId,label,steps});
  caps.push({id:'bask:garden',verb:'bask',label,target:{id:'garden',kind:'place'},available:!issue,...(issue?{blocked:{code:issue.code,reason:issue.message}}:{})});plans.set('bask:garden',{label,steps});
 }
};}
