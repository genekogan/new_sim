/** Optional recorded boat depiction. Published roots/support endpoints are never animated here. */
import * as THREE from 'three';
import {nativeBoatLayoutV1Schema,type NativeBoatLayoutV1} from '../../../../packages/engine-contract/src/boat.ts';
import type {TakeFrame} from '../../engine/take/replay.ts';
import {createNativeShoreSupports,type NativeShoreSupports} from './content/assets/native-shore-supports.ts';
import {createShoreBoat,inspectShoreBoat,type ContentView} from './content/assets/shore-boat.ts';
import type {ShoreDesign} from './shore-preview.ts';
import {authoredBoatFrame,recordedPassenger} from './recorded-boat.ts';
import {TRACK_TOL,POS_Q,ANG_Q} from '../../engine/take/types.ts';

export class NativeBoatViews {
 readonly group:THREE.Group;
 private readonly layout:NativeBoatLayoutV1;
 private readonly boat:ContentView;
 private readonly dock:THREE.Group;
 private readonly connector:THREE.Group;
 private readonly supports:NativeShoreSupports;
 private closed=false;
 private readonly seatHeights:Readonly<Record<string,number>>;
 constructor(layout:NativeBoatLayoutV1,proposal:ShoreDesign['boat']) {
  this.layout=nativeBoatLayoutV1Schema.parse(layout);
  const l=this.layout,s=inspectShoreBoat(proposal);
  const finite=(v:unknown):boolean=>typeof v==='number'?Number.isFinite(v):Array.isArray(v)?v.every(finite):v!==null&&typeof v==='object'?Object.values(v).every(finite):true;
  // This first counterpart uses only the reviewed calm, fixed-yaw punt layout.
  if(!finite(l)||[l.ramp,l.connector].some(c=>Math.hypot(c.to[0]-c.from[0],c.to[2]-c.from[2])===0)||l.authoredFrameOffset.join(',')!=='0,0.4,0'||l.dock.topY!==l.dock.position[1]+l.dock.size[1]||
   l.boatDockPosition[1]+l.authoredFrameOffset[1]+s.deck.topLocalY!==l.connector.to[1]||
   s.passengers.some((p,i)=>p.p.some((n,k)=>Math.abs(n+l.authoredFrameOffset[k]-l.seats[i?'seat1':'seat0'].root[k])>1e-9)))throw Error('Unsupported native boat prefab/layout relationship');
  this.supports=createNativeShoreSupports(l);
  this.group=this.supports.group;this.dock=this.supports.dock;this.connector=this.supports.connector;
  try{this.boat=createShoreBoat(proposal);}catch(error){try{this.supports.dispose();}catch(cleanup){throw new AggregateError([error,cleanup],'Native boat creation and support rollback failed',{cause:error});}throw error;}
  this.seatHeights=Object.fromEntries(s.passengers.map((p,i)=>[i?'seat1':'seat0',p.pelvisContactLocal[1]-p.p[1]]));
  this.boat.group.name=l.boatId;
  // Keep the original dock,connector,boat,ramp traversal order and exact world coordinates.
  this.group.remove(this.supports.ramp);this.group.add(this.boat.group,this.supports.ramp);
  this.group.visible=false;
 }
 show(frame:TakeFrame):{dockDepicted:boolean;boatDepicted:boolean} {
  if(this.closed)return{dockDepicted:false,boatDepicted:false};
  const l=this.layout,d=frame.entities[l.dockId],b=frame.entities[l.boatId];
  const dockValid=!!d&&d.p.every((n,i)=>Math.abs(n-l.dock.position[i])<1e-9)&&d.yaw===0&&!(d.pitch||d.roll);
  const visual=b?authoredBoatFrame(l.boatId,b,l):{status:'absent' as const};
  const boatValid=visual.status==='recorded'&&visual.value.yaw===0&&!(b.pitch||b.roll);
  this.group.visible=dockValid||boatValid;
  this.dock.visible=dockValid;
  this.group.getObjectByName('published bank ramp')!.visible=dockValid;
  if(dockValid)this.dock.position.fromArray(d.p);
  this.boat.group.visible=boatValid;
  if(boatValid){this.boat.group.position.fromArray(visual.value.p);this.boat.group.rotation.y=-visual.value.yaw;}
  this.connector.visible=dockValid&&boatValid&&visual.value.boat.connectorOpen&&visual.value.boat.dockId===l.dockId&&b.p.every((n,i)=>Math.abs(n-l.boatDockPosition[i])<1e-9);
  return{dockDepicted:dockValid,boatDepicted:boatValid};
 }
 /** Cosmetic seat surface above a recorded body root; never changes that root.
  * Only use this after show(), for a matching reciprocal seated record. */
 seatHeightFor(frame:TakeFrame,id:string):number|undefined {
  if(this.closed||!this.boat.group.visible)return;
  const l=this.layout,e=frame.entities[id],b=frame.entities[l.boatId];
  if(!e||!b||e.activity!=='sit')return;
  const p=recordedPassenger(e),v=authoredBoatFrame(l.boatId,b,l);
  if(p.status!=='recorded'||p.value.passenger.phase!=='seated'||p.value.transit||v.status!=='recorded')return;
  const q=p.value.passenger,slot=Object.hasOwn(l.seats,q.slotId)?l.seats[q.slotId as keyof typeof l.seats]:undefined;
  const posBound=2*(TRACK_TOL.pos+.5)/POS_Q,angBound=(TRACK_TOL.ang+.5)/ANG_Q;
  if(q.boatId!==l.boatId||!slot||q.relativeYaw!==slot.yaw||v.value.boat.passengers[q.slotId]!==id||q.localRoot.some((n,i)=>n!==slot.root[i])||
   e.p.some((n,i)=>Math.abs(n-b.p[i]-q.localRoot[i])>posBound)||
   Math.abs(Math.atan2(Math.sin(e.yaw-b.yaw-q.relativeYaw),Math.cos(e.yaw-b.yaw-q.relativeYaw)))>angBound)return;
  return this.seatHeights[q.slotId];
 }
 dispose(){if(this.closed)return;this.closed=true;const errors:unknown[]=[],attempt=(f:()=>void)=>{try{f();}catch(error){errors.push(error);}};attempt(()=>this.group.removeFromParent());attempt(()=>this.boat.dispose());attempt(()=>this.supports.dispose());for(const child of this.group.children.slice())attempt(()=>this.group.remove(child));if(errors.length)throw new AggregateError(errors,'Native boat owner cleanup failed');}
}
