// A finite physical construction project, not a Soul routine. Progress is read
// from the original parts/poses/supports, never a second authoritative checklist.
import { edenCampActivities, bindCampActivity, type CampActivity } from '../../../mars/viewer/engine/scenarios/eden-camp.ts';
import { entityFrame } from '../../../mars/viewer/engine/carry/formation.ts';
import type { WorldState } from '../../../mars/viewer/engine/world/types.ts';
export type BuildPhase = 'stage' | 'frame' | 'deck' | 'stairs';
export type BuildPlan = { crew: string[]; steps: { verb: string; params: Record<string, unknown> }[] };
type Refusal = { code: string; message: string };
const actions = edenCampActivities().filter(a => a.id.startsWith('build.') && a.id !== 'build.climb-lookout');
const byId = new Map(actions.map(a => [a.id, a]));
const itemOf = (a: CampActivity) => String(a.params.item ?? a.params.beam ?? a.params.joist ?? a.params.sheet ?? a.params.tread ?? a.params.stair ?? '');
function phaseOf(a: CampActivity): BuildPhase {
  if (['raise_upright','connect_beam','release_support'].includes(a.verb)) return 'frame';
  if (['install_stair_flight','install_tread'].includes(a.verb)) return 'stairs';
  return /joist|sheet/.test(itemOf(a)) ? 'deck' : 'stage';
}
export function constructionDone(world: WorldState, a: CampActivity): boolean {
  const e = world.entities[itemOf(a)]; if (!e) return false;
  if (a.verb === 'release_support') return e.support?.kind === 'connected';
  if (a.verb === 'raise_upright') return e.support?.kind === 'held' || e.support?.kind === 'connected';
  if (a.verb !== 'carry') return e.phase === 'installed';
  if (e.phase === 'installed' || e.support?.kind === 'held' || e.support?.kind === 'connected') return true;
  const t = a.params.to as {x:number;z:number;yaw:number};
  // Carry targets describe the load centre/long axis, not its model origin.
  // Symmetric loads may be laid end-for-end by the original planner.
  const { q, bottom } = entityFrame(e);
  const angle = Math.atan2(Math.sin(q.th-t.yaw),Math.cos(q.th-t.yaw));
  return e.phase === 'staged' && Math.abs(bottom)<0.015 && Math.hypot(q.x-t.x,q.z-t.z)<0.015 && Math.min(Math.abs(angle),Math.abs(Math.PI-Math.abs(angle)))<0.015;
}
export function unsafeConstruction(world: WorldState): boolean {
  return ['upright-a','upright-b'].some(id => world.entities[id]?.support?.kind === 'held');
}
export function constructionPlan(world: WorldState, actor: string, phase: unknown, free: (id:string)=>boolean): BuildPlan | Refusal {
  if (world.base.campus !== 'eden-camp') return {code:'construction.only-camp',message:'This project belongs to the camp build site.'};
  if (!['stage','frame','deck','stairs'].includes(String(phase))) return {code:'construction.phase',message:'Choose stage, frame, deck or stairs.'};
  const all=actions.filter(a=>phaseOf(a)===phase), pending=all.filter(a=>!constructionDone(world,a));
  if (!pending.length) return {code:'construction.done',message:`The ${phase} work is already complete.`};
  const ordered: CampActivity[] = [], done=new Set(actions.filter(a=>constructionDone(world,a)).map(a=>a.id));
  while (ordered.length<pending.length) {
    const next=pending.find(a=>!done.has(a.id)&&(a.after??[]).every(id=>done.has(id)));
    if (!next) {
      const missing=pending.flatMap(a=>a.after??[]).find(id=>!done.has(id)&&!pending.some(a=>a.id===id));
      return {code:'construction.prerequisite',message:missing?`First ${byId.get(missing)?.label??missing}.`:'The physical build prerequisites are not ready.'};
    }
    ordered.push(next);done.add(next.id);
  }
  const held=['upright-a','upright-b'].map(id=>{
    const s=world.entities[id]?.support;
    return s?.kind==='held' ? (s as {by:string[]}).by[0] : undefined;
  });
  const available=Object.keys(world.entities).sort().filter(id=>{
    const e=world.entities[id];return e.human?.level===0&&!e.human.grip&&free(id)&&e.body?.family!=='floater';
  });
  const count=phase==='frame'?4:phase==='stage'?1:2;
  const crew=[...new Set([actor,...(phase==='frame'?held.filter((id):id is string=>!!id):[]),...available])].slice(0,count);
  if (crew.length<count || !crew.every(id=>{
    const e=world.entities[id];return e?.human?.level===0&&free(id)&&(!e.human.grip || (phase==='frame'&&held.includes(id)));
  })) return {code:'construction.crew-unavailable',message:`This finite ${phase} job needs ${count} free ground-level builders.`};
  let aHolder=held[0],bHolder=held[1];
  if (phase==='frame') {
    aHolder??=crew.find(id=>id!==bHolder);
    bHolder??=crew.find(id=>id!==aHolder);
  }
  const beamCrew=crew.filter(id=>id!==aHolder&&id!==bHolder);
  const steps=ordered.map(a=>{
    const roles=Object.fromEntries(a.roles.map((role,i)=>[role,a.verb==='raise_upright'?(a.params.item==='upright-a'?aHolder!:bHolder!):a.verb==='connect_beam'?beamCrew[i]:crew[i]]));
    return {verb:`mars:${a.verb}`,params:bindCampActivity(a,roles) as Record<string,unknown>};
  });
  return {crew,steps};
}
