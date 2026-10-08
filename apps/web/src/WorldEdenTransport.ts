import * as THREE from 'three';
import {createTransportProp,inspectTransportProp} from '../../../mars/viewer/app/engine-view/content/assets/transport-prop-family/transport.ts';
type Ground=(x:number,z:number)=>number|null;
/** Parked appearance only. These existing original forms grant no driving,
 * cargo, passenger, road, wheel-contact or controller semantics. */
export const EDEN_PARKED_TRANSPORT=[
 {id:'eden-market-parked-handcart',kind:'handcart',p:[61,0,28],yaw:Math.PI/2},
 {id:'eden-country-parked-car',kind:'car',p:[83,0,37],yaw:Math.PI/2},
] as const;
export function createWorldEdenTransport(ground:Ground){
 const group=new THREE.Group(),owners:ReturnType<typeof createTransportProp>[]=[],omitted:string[]=[];
 group.name='Eden market and country parked transport — scenery only';
 let closed=false;
 try{for(const row of EDEN_PARKED_TRANSPORT){
  const spec=inspectTransportProp(row.kind),c=Math.cos(row.yaw),s=Math.sin(row.yaw);
  // Check the complete rotated horizontal envelope against actual visual
  // ground; never treat a centre-only sample as wheel/support clearance.
  let accepted=true;
  for(let x=spec.bounds.min[0];x<=spec.bounds.max[0]+1e-9;x+=.1)for(let z=spec.bounds.min[2];z<=spec.bounds.max[2]+1e-9;z+=.1){
   const y=ground(row.p[0]+c*x-s*z,row.p[2]+s*x+c*z);
   if(y===null||!Number.isFinite(y)||Math.abs(y-row.p[1])>1e-6)accepted=false;
  }
  if(!accepted){omitted.push(row.id);continue;}
  const owner=createTransportProp(row.kind,0);owner.group.name=row.id;
  owner.group.position.fromArray(row.p);owner.group.rotation.y=-row.yaw;
  owner.group.userData.edenTransportScope='parked appearance only; no native use';
  owners.push(owner);group.add(owner.group);
 }}catch(error){for(const owner of owners.reverse())try{owner.dispose();}catch{}throw error;}
 return {group,omitted,dispose(){if(closed)return;closed=true;const errors:unknown[]=[];group.removeFromParent();for(const owner of owners.reverse())try{owner.dispose();}catch(e){errors.push(e);}group.clear();if(errors.length)throw new AggregateError(errors,'Eden parked transport cleanup');}};
}
