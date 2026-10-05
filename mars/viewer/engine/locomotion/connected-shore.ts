// One retained native action, with the existing controllers owning every move.
import {z} from 'zod';
import type {ActionDef,Diagnostic} from '../actions/types.ts';
import type {Runtime} from '../runtime/runtime.ts';
import {shoreObstruction,SHORE_POLICY,type ShoreGeometry} from './shore.ts';
type Params={actor:string;x:number;z:number;level?:number};
type Op={verb:'walk_to'|'shore_travel';params:Params};
type Exec={id:string;actor:string;ops:Op[];index:number;child?:string;stopping?:boolean};
export const COMMONS_SHORE_GATE=[-29,0] as const;
const no=(code:string,message:string,actor:string):Diagnostic=>({code:'connected.'+code,message,subjects:[actor]});
export function connectedShoreAction(g:ShoreGeometry):ActionDef<Params,Op[],Exec>{
  return {
    verb:'commons_shore_travel',description:'Travel between installed commons and calm shore through the supported dry gate. Native walk handles commons; native shore travel handles slope, wading and swimming. Human on foot, free hands, direct shore routes only; no boarding or transport teleport.',
    schema:z.object({actor:z.string().min(1).max(80),x:z.number().finite().min(-10000).max(10000),z:z.number().finite().min(-10000).max(10000),level:z.number().int().min(0).max(100).optional()}).strict(),resumable:true,
    reservations:(_w,p)=>[{resource:'actor:'+p.actor,mode:'exclusive'}],
    plan(rt,p){
      const a=rt.world.entities[p.actor];
      if(!a?.human||a.kind!=='human'||a.body&&a.body.family!=='humanoid')return {ok:false,diagnostic:no('body-family','Only qualified upright humans can use the commons/shore connection',p.actor)};
      if(a.human.grip||a.human.on||a.human.riding||a.human.boatPassenger||a.human.boatTransit||a.human.sleepPose||a.human.hands?.left||a.human.hands?.right||Object.values(rt.world.entities).some(e=>e.support?.kind==='in-hand'&&e.support.by===p.actor))return {ok:false,diagnostic:no('occupied-body','Stand safely with free hands before taking the shore route',p.actor)};
      const shoreFrom=a.pose.p[0]<-29.5,shoreTo=p.x<-29.5;
      if(shoreTo&&(p.level??0)!==0)return {ok:false,diagnostic:no('shore-level','Shore travel uses its certified terrain/buoyant support, not a raised commons level',p.actor)};
      const gate={actor:p.actor,x:COMMONS_SHORE_GATE[0],z:COMMONS_SHORE_GATE[1],level:0};
      const ops:Op[]=shoreFrom===shoreTo?[{verb:shoreTo?'shore_travel':'walk_to',params:p}]:shoreTo?
        [{verb:'walk_to',params:gate},{verb:'shore_travel',params:{actor:p.actor,x:p.x,z:p.z}}]:
        [{verb:'shore_travel',params:{actor:p.actor,x:gate.x,z:gate.z}},{verb:'walk_to',params:p}];
      for(const op of ops){if(op.verb!=='shore_travel')continue;
        const from: [number,number]=shoreFrom?[a.pose.p[0],a.pose.p[2]]:[gate.x,gate.z];
        const route=g.sweep(from,[op.params.x,op.params.z],SHORE_POLICY.radius,SHORE_POLICY.maxGrade);
        if(!route.ok)return {ok:false,diagnostic:no('shore-route',route.reason??'No supported shore route',p.actor)};
        for(const span of route.spans){const hit=shoreObstruction(rt,p.actor,span.from,span.to);if(hit)return {ok:false,diagnostic:hit};}
      }
      // Future children are checked again at their real phase. This first child
      // is checked now; no projected/relocated body is used to claim admission.
      const first=ops[0],def=rt.registry.get(first.verb)!;
      const childParams=first.verb==='shore_travel'?{actor:p.actor,x:first.params.x,z:first.params.z}:first.params;
      const planned=def.plan(rt,childParams);if(!planned.ok)return planned;
      return {ok:true,program:ops};
    },
    start(_rt,p,ops,id){return {id,actor:p.actor,ops:structuredClone(ops),index:0};},
    step(rt,ex){
      if(ex.child){
        const r=rt.records.get(ex.child);if(!r)return {status:'failed',diagnostic:no('child-missing','The recorded movement child is missing',ex.actor)};
        if(rt.isActive(r.id))return r.status==='blocked'?{status:'blocked',diagnostic:no('waiting',r.diagnostic?.message??'Native movement is waiting',ex.actor)}:{status:'running',phase:ex.stopping?'stopping':r.verb};
        if(ex.stopping)return {status:'completed'};
        if(r.status!=='completed')return {status:'failed',diagnostic:r.diagnostic??no('child-failed','Native movement did not complete',ex.actor)};
        ex.child=undefined;ex.index++;
      }
      if(ex.stopping||ex.index===ex.ops.length)return {status:'completed',outputs:{position:[...rt.world.entities[ex.actor].pose.p]}};
      const op=ex.ops[ex.index],params=op.verb==='shore_travel'?{actor:ex.actor,x:op.params.x,z:op.params.z}:op.params;
      const child=rt.submit(op.verb,params,{parent:ex.id,preempt:false});ex.child=child.id;
      if(child.status==='failed')return {status:'failed',diagnostic:child.diagnostic!};
      return {status:'running',phase:op.verb};
    },
    cancel(rt,ex){ex.stopping=true;if(ex.child&&rt.isActive(ex.child)){rt.cancel(ex.child,{code:'connected.stopped',message:'Stopping the connected route safely'});return {ok:true,deferred:rt.isActive(ex.child)};}return {ok:true};},
  };
}
