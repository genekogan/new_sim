// punt/1: a conservative calm-water route plus dry-bank transfer, using carrier/1's two-seat controller.
// The exact route and bank heights are logged by the host. No author-model reads are needed on replay.
import type {Runtime} from '../../../mars/viewer/engine/runtime/runtime.ts';
import type {CarrierInstallSpec, CarrierRoute} from '../../../mars/viewer/engine/vehicles/carrier.ts';
import {routePosition,routeTicks} from '../../../mars/viewer/engine/vehicles/carrier.ts';
import type {Spatial} from '../../../mars/viewer/engine/spatial/service.ts';
import type {RenderScene} from '@sim/engine-contract';
import {groundRecipe} from './ground-bridge.ts';
import {createTerrainGeometryProbe} from './terrain.ts';
import {createWaterGeometryProbe} from './water-geometry.ts';
import {hashOf} from '../../../mars/viewer/engine/core/hash.ts';
import {CATALOG} from '../../../mars/viewer/engine/world/catalog.ts';

type V2=[number,number];
type V3=[number,number,number];
type Surface={id:string;polygon:V2[];level:number;wet(x:number,z:number):boolean;bank(x:number,z:number):number|null};
const round=(v:number)=>Math.round(v*1e4)/1e4;
const inPoly=(x:number,z:number,p:V2[])=>{let c=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;};
function surfaces(rt:Runtime,render?:RenderScene):Surface[]{
  const out:Surface[]=[],sp=rt.services.spatial as Spatial;
  const fact=(rt.world as typeof rt.world&{groundV1?:{recipeHash:string}}).groundV1,g=fact?groundRecipe(fact.recipeHash):null,f=sp.ground?.field;
  if(g&&f)for(const w of g.waters){if(!w.area)continue;const polygon=w.area as V2[];
    out.push({id:w.id,polygon,level:w.level,wet:(x,z)=>inPoly(x,z,polygon)&&Math.abs((f.waterLevel(x,z)??Infinity)-w.level)<.001&&w.level-f.height(x,z)>=.12,
      bank:(x,z)=>f.waterLevel(x,z)===null&&f.medium(x,z)<=1?f.height(x,z):null});}
  const shore=render?.shore;
  if(shore){const bed=createTerrainGeometryProbe(shore.terrain),water=createWaterGeometryProbe({...shore.water,terrain:shore.terrain}),b=shore.water.wetBoundsXZ;
    out.push({id:'eden-pond',polygon:[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]],level:shore.water.datumY,
      wet:(x,z)=>{const q=water.column({atXZ:[x,z]});return q.depthMetres!==null&&q.depthMetres>=.12;},
      bank:(x,z)=>{const p=bed.point({atXZ:[x,z]}),q=water.column({atXZ:[x,z]});return p.point&&q.depthMetres===0?p.point[1]:null;}});
  }
  return out;
}
const hullWet=(s:Surface,p:V3)=>Math.abs(p[1]-s.level)<.001&&Array.from({length:16},(_,i)=>{const a=i*Math.PI/8;return s.wet(p[0]+Math.cos(a)*1.75,p[2]+Math.sin(a)*1.75);}).every(Boolean);

/** Refuse a route leaving real water, a shallow hull, dry-water spoofing or a boarding/exit point off dry support. */
export function previewPunt(rt:Runtime,spec:CarrierInstallSpec,render?:RenderScene):{code:string;message:string}|null{
  const no=(message:string)=>({code:'punt.unsupported-water',message});
  if(!spec.bank||!spec.routeKeys)return no('A punt needs a water-level loop and dry-bank boarding points.');
  const route:CarrierRoute={id:spec.route,keys:spec.routeKeys};
  const surface=surfaces(rt,render).find(s=>hullWet(s,route.keys[0].p));
  if(!surface)return no('There is no calm water deep and wide enough for the punt hull at this home.');
  const end=routeTicks(route);
  if(end<20*20||end>600*20)return no('A punt loop must take between 20 seconds and 10 minutes.');
  let last=routePosition(route,0);
  for(let k=1;k<=end;k++){const p=routePosition(route,k);
    if(Math.hypot(p[0]-last[0],p[1]-last[1],p[2]-last[2])>.6/20+.001)return no('The punt route exceeds its calm rowing speed of 0.6 m/s.');
    if((k%10===0||k===end)&&!hullWet(surface,p))return no('The entire punt loop must stay on water with room around the hull.');
    last=p;
  }
  const home=route.keys[0].p,bank=spec.bank;
  if(Math.hypot(bank.door[0]-home[0],bank.door[2]-home[2])>3.2)return no('The dry bank must be within reach of a short boarding plank.');
  for(const p of [bank.door,...Object.values(bank.exits)]){
    const y=surface.bank(p[0],p[2]);if(y===null||Math.abs(y-p[1])>.001)return no('The boarding plank and both exits need supported dry bank.');
    for(let i=0;i<8;i++){const a=i*Math.PI/4;if(surface.bank(p[0]+Math.cos(a)*.3,p[2]+Math.sin(a)*.3)===null)return no('The whole standing disc needs dry bank.');}
    for(const e of Object.values(rt.world.entities)){if(e.human||e.kind==='marker')continue;
      // Flat native fixture boxes conservatively exclude a bank obstructed by furniture; ground solids are checked by the adapter.
      const size=CATALOG[e.def]?.obstacle?CATALOG[e.def]?.size:undefined;
      if(size&&Math.hypot(e.pose.p[0]-p[0],e.pose.p[2]-p[2])<Math.hypot(size[0],size[2])/2+.3)return no('Furniture obstructs the boarding bank.');
    }
  }
  return null;
}

/** Find one bounded water loop per admitted standing water (river paths remain an honest refusal).
 * Try the shore's long sides first; a concave/narrow/steep water simply yields no candidate. */
export function puntCandidates(rt:Runtime,render?:RenderScene):CarrierInstallSpec[]{
  const out:CarrierInstallSpec[]=[];
  for(const surface of surfaces(rt,render)){
    const p=surface.polygon,area=p.reduce((a,q,i)=>a+q[0]*p[(i+1)%p.length][1]-p[(i+1)%p.length][0]*q[1],0),sign=area>0?1:-1;
    const edges=p.map((a,i)=>({a,b:p[(i+1)%p.length],i})).sort((a,b)=>Math.hypot(b.b[0]-b.a[0],b.b[1]-b.a[1])-Math.hypot(a.b[0]-a.a[0],a.b[1]-a.a[1])||a.i-b.i);
    let found:CarrierInstallSpec|undefined;
    for(const {a,b} of edges){if(found)break;const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<7)continue;
      const tangent:V2=[dx/length,dz/length],normal:V2=[-tangent[1]*sign,tangent[0]*sign],mid:V2=[(a[0]+b[0])/2,(a[1]+b[1])/2];
      const home:V3=[round(mid[0]+normal[0]*2.2),surface.level,round(mid[1]+normal[1]*2.2)];
      const point=(inward:number,along=0):V3|null=>{const x=round(mid[0]+normal[0]*inward+tangent[0]*along),z=round(mid[1]+normal[1]*inward+tangent[1]*along),y=surface.bank(x,z);return y===null?null:[x,round(y),z];};
      const door=point(-.9),ea=point(-1.45,-.85),eb=point(-1.45,.85);if(!door||!ea||!eb)continue;
      for(const radius of [5,4,3,2]){
        const id=surface.id==='eden-pond'?'eden-punt':`punt-${surface.id.replace(/[^a-z0-9._-]+/gi,'-').toLowerCase().slice(0,50)}-${hashOf(surface.id).slice(0,6)}`;
        const keys=Array.from({length:17},(_,i)=>{const angle=i/16*2*Math.PI,n=radius*(1-Math.cos(angle)),t=radius*.65*Math.sin(angle);return {t:i/16*150,p:[round(home[0]+normal[0]*n+tangent[0]*t),home[1],round(home[2]+normal[1]*n+tangent[1]*t)] as V3};});
        const spec:CarrierInstallSpec={id,def:'rowing-punt',label:surface.id==='eden-pond'?'Pond rowing punt':`${surface.id} rowing punt`,at:[home[0],home[2]],y:home[1],yaw:Math.atan2(-normal[1],-normal[0]),route:`${id}-loop`,routeKeys:keys,bank:{door,exits:{'rider-a':ea,'rider-b':eb}},waitSeconds:30};
        if(!previewPunt(rt,spec,render)){found=spec;break;}
      }
    }
    if(found)out.push(found);
  }
  return out;
}
