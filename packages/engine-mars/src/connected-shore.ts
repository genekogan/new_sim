// Fresh native physical world, not an old-world transition or live default.
import {readFileSync} from 'node:fs';
import {hashOf,nativeShoreSceneV1Schema,type RenderScene} from '@sim/engine-contract';
import {loadMars} from './load.ts';
import {createTerrainGeometryProbe} from './terrain.ts';
import {createWaterGeometryProbe} from './water-geometry.ts';
import {connectedShoreAction} from '../../../mars/viewer/engine/locomotion/connected-shore.ts';
import {shoreActions,shoreContactInvariant,shoreSpeedInvariant,SHORE_POLICY,type ShoreGeometry} from '../../../mars/viewer/engine/locomotion/shore.ts';
import {humanStaticClearance,speedWithinCap} from '../../../mars/viewer/engine/runtime/invariants.ts';
import {decodeSnapshot,type RuntimeSnapshot} from '../../../mars/viewer/engine/runtime/snapshot.ts';
import type {Runtime} from '../../../mars/viewer/engine/runtime/runtime.ts';
import type {Diagnostic} from '../../../mars/viewer/engine/actions/types.ts';
import type {Entity,WorldState} from '../../../mars/viewer/engine/world/types.ts';
import type {SpatialScene} from '../../../mars/viewer/engine/spatial/types.ts';
export const CONNECTED_SHORE_TRANSFORM=Object.freeze({x:-46,y:-2,z:0,flatShoulderColumns:2});
export async function connectedCommonsShoreFixture(support?:{version:'connected-boat/1';bodyContact:(rt:Runtime,e:Entity)=>Diagnostic[]|null;transferSpeed:number}){
  const m=await loadMars(),source=JSON.parse(readFileSync(new URL('./fixtures/shore-bed.v1.json',import.meta.url),'utf8'));
  // Keep the reviewed shore's heights/slope/depth. Place its top at the west
  // edge of the unmodified commons ground. Two new flat columns provide a
  // shared, genuinely supported foot disc for controller handoff at (-29,0).
  const terrain={...source.terrain,id:'commons-shore-terrain/1',originXZ:[-62,-12],columns:source.terrain.columns+2,
    heightMetres:source.terrain.heightMetres.map((row:number[])=>[...row.map(y=>y-2),0,0])};
  const water={id:'commons-shore-water/1',datumY:-2,wetBoundsXZ:[-62,-12,-46,12]};
  const bed=createTerrainGeometryProbe(terrain),wet=createWaterGeometryProbe({...water,terrain});
  const geometry:ShoreGeometry=Object.freeze({terrainId:terrain.id,waterId:water.id,datumY:water.datumY,
    point(at){const p=bed.point({atXZ:at}),c=wet.column({atXZ:at});return p.point&&p.normal&&c.depthMetres!==null?{point:p.point,normal:p.normal,depth:c.depthMetres}:null;},
    sweep(from,to,radius,grade){const p=bed.sweep({fromXZ:from,toXZ:to,radiusMetres:radius,maxGrade:grade});return {ok:p.geometryStatus==='clear',reason:p.reason,spans:p.centreline};},
  } satisfies ShoreGeometry);
  const commons=m.edenCommonsWorld('base') as WorldState,scene=structuredClone(m.scenes[commons.base.campus]) as SpatialScene;scene.bounds=[-62,-30,30,30];
  const rulesVersion='native-commons-shore/1+'+(support?support.version+'+':'')+m.rulesVersion;
  const base={campus:'eden-commons-shore/1',staticHash:hashOf({scene,terrain,water,rulesVersion,policy:SHORE_POLICY,transform:CONNECTED_SHORE_TRANSFORM,sourceHash:hashOf(source)})};
  const services=m.servicesFor({[base.campus]:scene}),registry=m.createRegistry();
  const oldWalk=registry.get('walk_to')!;
  registry.set('walk_to',{...oldWalk,plan(rt:Runtime,p:{actor:string;x:number;z:number;level?:number}){
    const e=rt.world.entities[p.actor];
    if(p.x<-29.5||e&&e.pose.p[0]<-29.5||e?.human?.shore&&Math.abs(e.pose.p[1])>.001)return {ok:false,diagnostic:{code:'connected.use-shore-controller',message:'Use the installed shore controller through the dry gate; flat-grid walking cannot enter the sloped or wet domain',subjects:[p.actor]}};
    return oldWalk.plan(rt,p);
  },start(rt:Runtime,...args:unknown[]){const actor=(args[0] as {actor:string}).actor;delete rt.world.entities[actor].human!.shore;return oldWalk.start(rt,...args);}});
  // Native commons actions have no qualified wet/slope equivalent. Validate
  // their actual actor claims after their pure plan, before admission/start.
  // A dry, level-zero shared gate permits the ordinary walk handoff.
  for(const [verb,def] of registry){registry.set(verb,{...def,plan(rt:Runtime,p:unknown){
    const planned=def.plan(rt,p);if(!planned.ok)return planned;
    for(const claim of def.reservations(rt.world,p)){
      if(!claim.resource.startsWith('actor:'))continue;
      const id=claim.resource.slice(6),e=rt.world.entities[id];
      if(e?.human&&(e.pose.p[0]<-29.5||e.human.shore&&(e.human.shore.depthMetres>0||Math.abs(e.pose.p[1])>.001)))
        return {ok:false,diagnostic:{code:'connected.unqualified-shore-action',message:verb+' has no qualified slope/water equivalent for '+id+'; return through the dry gate first',subjects:[id]}};
    }
    return planned;
  }});}
  for(const def of [...shoreActions(geometry),connectedShoreAction(geometry)])registry.set(def.verb,def);
  const certified=(rt:Runtime,id:string)=>{const e=rt.world.entities[id];if(e&&support?.bodyContact(rt,e)?.length===0)return true;const s=e?.human?.shore,p=e?geometry.point([e.pose.p[0],e.pose.p[2]]):null;return !!s&&!!p&&s.terrainId===terrain.id&&Math.abs(e.pose.p[1]-(p.depth>1.2?water.datumY-1.2:p.point[1]))<.001;};
  const invariants=[...m.invariants.filter(i=>i!==speedWithinCap&&i!==humanStaticClearance),(rt:Runtime)=>shoreSpeedInvariant(rt).filter(d=>!support||!d.subjects?.every(id=>{const e=rt.world.entities[id];return !!e?.human?.boatTransit&&support.bodyContact(rt,e)?.length===0&&Number.isFinite(e.human.speed)&&e.human.speed!>=0&&e.human.speed!<=support.transferSpeed*1.05;})),
    (rt:Runtime)=>humanStaticClearance(rt).filter(d=>!d.subjects?.every(id=>certified(rt,id))),
    shoreContactInvariant(geometry,(rt,e)=>support?.bodyContact(rt,e)??(e.pose.p[0]>=-29.5&&!e.human?.shore?[]:null))];
  const validate=(w:WorldState)=>{if(w.base.campus!==base.campus||w.base.staticHash!==base.staticHash||w.obstacleEdits)throw new Error('connected shore physical base differs; no old-world reinterpretation');};
  return {rulesVersion,geometry,terrain:structuredClone(terrain),water:structuredClone(water),scene:structuredClone(scene),sourceHash:hashOf(source),
    genesis(seed='connected'):WorldState{const w=m.edenCommonsWorld(seed) as WorldState;w.base={...base};w.regions['shore-bank']={id:'shore-bank',label:'Connected sloping bank',kind:'place',level:0,polygon:[[-46,-11],[-29,-11],[-29,11],[-46,11]],provenance:{origin:'design-edit',confidence:'hypothetical'}};w.regions['shore-water']={id:'shore-water',label:'Connected calm water',kind:'place',level:0,polygon:[[-61,-11],[-46,-11],[-46,11],[-61,11]],provenance:{origin:'design-edit',confidence:'hypothetical'}};return w;},
    create(w:WorldState):Runtime{validate(w);return new m.Runtime(w,registry,services(w),invariants);},
    restore(s:RuntimeSnapshot):Runtime{const w=decodeSnapshot(s).world;validate(w);return m.Runtime.restore(s,registry,services(w),invariants);},
    renderScene():RenderScene{const visible=structuredClone(scene);(visible as any).commons={version:'commons/1',source:'9b6db72fc2dcf45a762d7ce8e4db0b71d0418ea8',layout:structuredClone(m.commonsLayout)};return {scene:visible,ground:'grass',shore:nativeShoreSceneV1Schema.parse({contract:'native-shore-scene/1',rulesVersion,physicalBase:base,terrain,water})};},
    servicesForWorld:services,
    human:m.human,
  };
}
