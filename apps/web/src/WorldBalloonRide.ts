import * as THREE from 'three';
/** The balloon ride (Gene: two Souls ride a hot-air balloon together and talk in the basket).
 * Presentation only. Core owns the ride (OBJECT-CONTRACT-v1 §7 kind `ride`, PLACE-DATA-v1 carrier places);
 * World owns the asset, the route and this depiction. The route mirrors worlds/eden/rides/balloon-ride.v1.json
 * (a test keeps them identical).
 *
 * Where the basket is, in order of authority:
 *  1. the native carrier entity `eden-balloon` in the recording (Core CN6 carriage; tick-exact with the riders' bodies);
 *  2. else Core's spectator `ride` frames (EDGE-CONTRACT-v1 §7b): the published position and yaw, eased between frames;
 *  3. else parked at the launch meadow.
 * Riders: Core's carriage puts their bodies (boarding, seated, stepping out) in the ordinary body stream, so labels and
 * speech bubbles follow the basket with no help; World never moves them. Only the ?ride= preview, which has no
 * carriage, seats bodies at render time (saved and restored around renderer.render), with a short step-up / step-down. */

export type RidePoint=readonly [t:number,x:number,y:number,z:number];
export type RideRoute={id:string;name:string;vehicle:string;launch:{place:string;at:readonly [number,number,number];yaw:number;clearRadius:number};minutes:number;points:readonly RidePoint[]};
export type RideSeat={slot:string;at:readonly [number,number];yaw:number;pose:string};
export const BALLOON_RIDE={
 contract:'eden-rides/1',
 vehicles:[{def:'hot-air-balloon',basket:{length:1.5,width:1.2,height:1.1},envelope:{radius:4.2,mouthHeight:3.2,crownHeight:12.9},
  seats:[{slot:'rider-a',at:[.3,-.3],yaw:.35,pose:'stand, hands on the rim'},{slot:'rider-b',at:[.3,.3],yaw:-.35,pose:'stand, hands on the rim'}] as RideSeat[],
  door:{at:[-1.25,0] as const,width:.56,note:'an open doorway in the back wall; riders walk in and out through it, never over the rim'}}],
 routes:[{id:'eden-commons-loop',name:'Over the pond, the west lake, the coast, the harbour and back',vehicle:'hot-air-balloon',
  launch:{place:'field',at:[-20,0,-9],yaw:3.1416,clearRadius:8},minutes:18.7,
  points:[[0,-20,0,-9],[40,-28,25,-6],[120,-55,55,0],[240,-150,75,5],[360,-260,85,80],[480,-480,95,150],[600,-300,90,230],[720,60,80,215],[840,160,70,140],[960,70,50,40],[1060,0,25,-8],[1120,-20,0,-9]]}] as RideRoute[],
} as const;
export const BALLOON=BALLOON_RIDE.vehicles[0];
/** Core's native carrier entity for the balloon (CN6). */
export const CARRIER='eden-balloon';
export const ROUTE=BALLOON_RIDE.routes[0];
export const routeSeconds=(r:RideRoute)=>r.points[r.points.length-1][0];

/** Basket floor centre at t seconds after lift-off: cubic Hermite with time-aware tangents, zero speed at both ends. */
export function routePoint(r:RideRoute,t:number,out:[number,number,number]=[0,0,0]):[number,number,number]{
 const P=r.points,n=P.length;if(t<=P[0][0]){out[0]=P[0][1];out[1]=P[0][2];out[2]=P[0][3];return out;}
 if(t>=P[n-1][0]){out[0]=P[n-1][1];out[1]=P[n-1][2];out[2]=P[n-1][3];return out;}
 let i=0;while(i<n-2&&t>P[i+1][0])i++;
 const a=P[i],b=P[i+1],h=b[0]-a[0],u=(t-a[0])/h,u2=u*u,u3=u2*u;
 const h00=2*u3-3*u2+1,h10=u3-2*u2+u,h01=-2*u3+3*u2,h11=u3-u2;
 for(let k=1;k<4;k++){
  const m0=i===0?0:(b[k]-P[i-1][k])/(b[0]-P[i-1][0]),m1=i+1===n-1?0:(P[i+2][k]-a[k])/(P[i+2][0]-a[0]);
  out[k-1]=h00*a[k]+h10*h*m0+h01*b[k]+h11*h*m1;}
 return out;
}
const _a:[number,number,number]=[0,0,0],_b:[number,number,number]=[0,0,0];
/** Pose of the basket at flight time t: floor centre, engine yaw (follows travel; the launch yaw on the ground), burner 0..1. */
export function routePose(r:RideRoute,t:number){
 const T=routeSeconds(r),p=routePoint(r,t,[0,0,0]);
 // presentation-only sway, the same for every viewer: zero on the ground, a few metres aloft
 const air=Math.min(1,Math.max(0,Math.min(t,T-t)/60)),sway=air*2.5*Math.sin(t/37),bob=air*.35*Math.sin(t/5.3);
 routePoint(r,Math.max(0,t-10),_a);routePoint(r,Math.min(T,t+10),_b);
 const dx=_b[0]-_a[0],dz=_b[2]-_a[2],d=Math.hypot(dx,dz);
 let yaw=r.launch.yaw;if(d>1.5&&t>2&&t<T-2){const tr=Math.atan2(dz,dx),w=Math.min(1,air*2);yaw=lerpAngle(r.launch.yaw,tr,w);}
 if(d>.01){p[0]+=-dz/d*sway;p[2]+=dx/d*sway;}p[1]+=bob;
 const climb=(_b[1]-_a[1])/20,burner=t<=0||t>=T?0:Math.max(climb>.3?1:0,((t+7)%45)<6?1:0);
 return {p,yaw,burner};
}
export function lerpAngle(a:number,b:number,w:number){const d=Math.atan2(Math.sin(b-a),Math.cos(b-a));return a+d*w;}
/** A seat in world space for a basket pose. Engine convention: forward (cos yaw, sin yaw), right (−sin yaw, cos yaw). */
export function seatWorld(basket:{p:readonly number[];yaw:number},seat:RideSeat):{p:[number,number,number];yaw:number}{
 const c=Math.cos(basket.yaw),s=Math.sin(basket.yaw),[f,r]=seat.at;
 return {p:[basket.p[0]+f*c-r*s,basket.p[1],basket.p[2]+f*s+r*c],yaw:basket.yaw+seat.yaw};
}

export type RidePhase='parked'|'boarding'|'aloft'|'landed';
/** Spectator view of one ride (EDGE-CONTRACT-v1 §7b, Core CN6). `riders[i]` is the soulId in BALLOON.seats[i] ('' = free). */
export type RideView={id:string;phase:RidePhase;route:string;carrier:string;riders:readonly string[];
 position?:readonly [number,number,number];yaw?:number;elapsed?:number;holding?:boolean;tick:number;at:number};
const PHASES:readonly string[]=['parked','boarding','aloft','landed'];
const str=(v:unknown)=>typeof v==='string'&&v?v:undefined,num=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:undefined;
const vec3=(v:unknown)=>Array.isArray(v)&&v.length===3&&v.every(x=>typeof x==='number'&&Number.isFinite(x))?[v[0],v[1],v[2]] as const:undefined;
/** Riders by seat: [{seat:'rider-a',soulId}…] → ['s_…','s_…'] in seat order; plain soulId lists keep their order. */
function seatRiders(v:unknown):string[]|undefined{
 if(!Array.isArray(v))return undefined;const out:string[]=BALLOON.seats.map(()=>''),extra:string[]=[];
 for(const x of v){if(typeof x==='string'){extra.push(x);continue;}if(!x||typeof x!=='object')continue;const r=x as {seat?:unknown;soulId?:unknown};if(typeof r.soulId!=='string')continue;
  const i=BALLOON.seats.findIndex(s=>s.slot===r.seat);if(i>=0&&!out[i])out[i]=r.soulId;else extra.push(r.soulId);}
 for(const id of extra){const i=out.indexOf('');if(i<0)break;out[i]=id;}
 return out;}
/** Fold Core's spectator frames into ride views: `{type:'edge',kind:'ride',tick,at,ride:{id,phase,position,yaw,riders,route:{elapsedSeconds},…}}`
 * (EDGE-CONTRACT-v1 §7b). Latest (tick, at) per ride wins; fields a frame omits are kept. Unknown shapes are ignored. */
export function ridesFromEdge(messages:readonly ({kind?:unknown;tick?:unknown;at?:unknown}&Record<string,unknown>)[],into=new Map<string,RideView>()){
 for(const m of messages){
  if(m.kind!=='ride'||!m.ride||typeof m.ride!=='object')continue;
  const d=m.ride as Record<string,unknown>,id=str(d.id);if(!id)continue;
  const tick=num(m.tick)??num(d.tick)??0,at=num(m.at)??0,prev=into.get(id);if(prev&&(prev.tick>tick||(prev.tick===tick&&prev.at>at)))continue;
  const route=d.route&&typeof d.route==='object'?d.route as Record<string,unknown>:{};
  const phase=PHASES.includes(String(d.phase))?d.phase as RidePhase:prev?.phase??'parked';
  const position=vec3(d.position)??prev?.position,yaw=num(d.yaw)??prev?.yaw,elapsed=num(route.elapsedSeconds)??prev?.elapsed;
  into.set(id,{id,phase,route:str(route.id)??prev?.route??ROUTE.id,carrier:id,riders:seatRiders(d.riders)??prev?.riders??[],
   ...(position?{position}:{}),...(yaw!==undefined?{yaw}:{}),...(elapsed!==undefined?{elapsed}:{}),holding:d.holding===true,tick,at});
 }
 return into;
}
/** Seconds into the route at wall time `nowMs` (null = on the ground): Core's elapsedSeconds, advanced since the frame
 * while aloft and not holding (frames come every 0.5 s; never more than 2 s of extrapolation). */
export function flightSeconds(v:RideView|undefined,nowMs:number,r:RideRoute=ROUTE):number|null{
 if(!v||v.elapsed===undefined||v.phase!=='aloft')return null;
 const ahead=v.holding?0:Math.max(0,Math.min(2,(nowMs-v.at)/1000));
 return Math.max(0,Math.min(routeSeconds(r),v.elapsed+ahead));
}

/** `?ride=Alice,Bob` (optionally `&rideSpeed=8`): a local preview flight from page load. Names resolved by the caller. */
export function parseRideOverride(search:string):{names:string[];speed:number}|null{
 const q=new URLSearchParams(search);if(!q.has('ride'))return null;
 const names=(q.get('ride')??'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean).slice(0,2),speed=Number(q.get('rideSpeed'));
 return {names,speed:Number.isFinite(speed)&&speed>0?Math.min(speed,60):1};
}
/** Preview timeline (seconds since page load × speed): board 0–8 s, fly the route, land, step out 6 s later, repeat. */
export function previewState(elapsed:number,speed:number,r:RideRoute=ROUTE):{phase:RidePhase;flight:number|null;aboard:number}{
 const T=routeSeconds(r),cycle=8+T/speed+10,e=elapsed%cycle;
 if(e<8)return {phase:'boarding',flight:null,aboard:e<1.5?0:e<3.5?1:2};
 if(e<8+T/speed)return {phase:'aloft',flight:(e-8)*speed,aboard:2};
 return {phase:'boarding',flight:null,aboard:e<8+T/speed+6?2:0};
}

// ── asset ─────────────────────────────────────────────────────────────────────────────────────────────────
type V3=[number,number,number];
class Builder{
 pos:number[]=[];col:number[]=[];nor:number[]=[];private c=new THREE.Color();private n=new THREE.Vector3();private e1=new THREE.Vector3();private e2=new THREE.Vector3();
 tri(color:string,a:V3,b:V3,d:V3,na?:V3,nb?:V3,nd?:V3){this.c.set(color);
  if(!na){this.e1.set(b[0]-a[0],b[1]-a[1],b[2]-a[2]);this.e2.set(d[0]-a[0],d[1]-a[1],d[2]-a[2]);this.n.crossVectors(this.e1,this.e2).normalize();}
  for(const [p,nn] of [[a,na],[b,nb],[d,nd]] as [V3,V3|undefined][]){this.pos.push(...p);this.col.push(this.c.r,this.c.g,this.c.b);if(nn)this.nor.push(...nn);else this.nor.push(this.n.x,this.n.y,this.n.z);}}
 quad(color:string,a:V3,b:V3,c:V3,d:V3){this.tri(color,a,b,c);this.tri(color,a,c,d);}
 box(color:string,x:number,y:number,z:number,w:number,h:number,d:number,yaw=0){
  const cs=Math.cos(yaw),sn=Math.sin(yaw),P=(dx:number,dy:number,dz:number):V3=>[x+dx*cs-dz*sn,y+dy,z+dx*sn+dz*cs],X=[-w/2,w/2],Y=[0,h],Z=[-d/2,d/2];
  this.quad(color,P(X[0],Y[0],Z[1]),P(X[1],Y[0],Z[1]),P(X[1],Y[1],Z[1]),P(X[0],Y[1],Z[1]));this.quad(color,P(X[1],Y[0],Z[0]),P(X[0],Y[0],Z[0]),P(X[0],Y[1],Z[0]),P(X[1],Y[1],Z[0]));
  this.quad(color,P(X[1],Y[0],Z[1]),P(X[1],Y[0],Z[0]),P(X[1],Y[1],Z[0]),P(X[1],Y[1],Z[1]));this.quad(color,P(X[0],Y[0],Z[0]),P(X[0],Y[0],Z[1]),P(X[0],Y[1],Z[1]),P(X[0],Y[1],Z[0]));
  this.quad(color,P(X[0],Y[1],Z[1]),P(X[1],Y[1],Z[1]),P(X[1],Y[1],Z[0]),P(X[0],Y[1],Z[0]));}
 /** thin line as a crossed pair of quads */
 rope(color:string,a:V3,b:V3,w=.03){this.quad(color,a,[a[0]+w,a[1],a[2]],[b[0]+w,b[1],b[2]],b);this.quad(color,a,[a[0],a[1],a[2]+w],[b[0],b[1],b[2]+w],b);}
 geometry(){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(this.pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(this.col,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(this.nor,3));g.computeBoundingSphere();return g;}
}
/** Envelope profile [height above the basket floor, radius]: a classic teardrop from the mouth to the crown. */
const PROFILE:readonly [number,number][]=[[3.2,.85],[4.4,1.7],[5.8,2.9],[7.2,3.8],[8.7,4.2],[10,4.1],[11.1,3.5],[12,2.5],[12.6,1.3],[12.9,0]];
const GORES=16,RED='#c8382c',CREAM='#f2ebdb',GOLD='#e0b040',WICKER='#b98a52',WICKER_DARK='#7c5530',LEATHER='#4a3020',ROPE='#cdbf9c',WOOD='#8b6440',STEEL='#5a5a5e',SAND='#b49c70';
/** Balloon in basket-local space (origin = basket floor centre, +x forward). Hollow basket so riders show inside. */
/** Half the door gap in the back wall (BALLOON.door.width / 2); the cabin's canopy valance (its bottom edge = the door's lintel,
 *  2.08 m) and the burner frame stand above the head of the tallest Soul at its place (Gene 2026-10-23: no head through the "ceiling"). */
const DOOR_HALF=BALLOON.door.width/2,CANOPY_Y=2.3,FRAME_Y=2.75;
/** `basketOnly`: the cabin without the envelope (a god's balloon keeps its own envelope; its load tapes reach `mouthY`). */
export function buildBalloon(o:{basketOnly?:boolean;mouthY?:number}={}){
 const b=new Builder(),L=BALLOON.basket.length,W=BALLOON.basket.width,H=BALLOON.basket.height,mouthY=o.mouthY??PROFILE[0][0];
 if(!o.basketOnly)for(let j=0;j<PROFILE.length-1;j++){const [h0,r0]=PROFILE[j],[h1,r1]=PROFILE[j+1];
  // smooth normals across gores from the profile slope
  const nrm=(k:number):[number,number]=>{const [ha,ra]=PROFILE[Math.max(0,k-1)],[hb,rb]=PROFILE[Math.min(PROFILE.length-1,k+1)],dh=hb-ha,dr=rb-ra,l=Math.hypot(dh,dr)||1;return [dh/l,-dr/l];};
  const [n0h,n0y]=nrm(j),[n1h,n1y]=nrm(j+1);
  for(let g=0;g<GORES;g++){const a=g/GORES*Math.PI*2,c=(g+1)/GORES*Math.PI*2,ca=Math.cos(a),sa=Math.sin(a),cc=Math.cos(c),sc=Math.sin(c);
   const color=j===PROFILE.length-2?RED:j===4?GOLD:g%2?CREAM:RED;
   const A:V3=[ca*r0,h0,sa*r0],B:V3=[ca*r1,h1,sa*r1],C:V3=[cc*r1,h1,sc*r1],D:V3=[cc*r0,h0,sc*r0];
   const nA:V3=[ca*n0h,n0y,sa*n0h],nB:V3=[ca*n1h,n1y,sa*n1h],nC:V3=[cc*n1h,n1y,sc*n1h],nD:V3=[cc*n0h,n0y,sc*n0h];
   b.tri(color,A,B,C,nA,nB,nC);b.tri(color,A,C,D,nA,nC,nD);}}
 // wicker walls (double-sided material shows the inside), floor, padded leather rim
 const x0=-L/2,x1=L/2,z0=-W/2,z1=W/2;
 b.quad(WICKER,[x0,0,z1],[x1,0,z1],[x1,H,z1],[x0,H,z1]);b.quad(WICKER,[x1,0,z0],[x0,0,z0],[x0,H,z0],[x1,H,z0]);
 b.quad(WICKER,[x1,0,z1],[x1,0,z0],[x1,H,z0],[x1,H,z1]);
 // the back wall (local -x) has the door: two wall pieces either side of a static open gap DOOR_HALF wide each way (no gate leaf:
 // the doorway's posts and lintel are part of this one basket mesh, so the ride stays four meshes)
 const g=DOOR_HALF;b.quad(WICKER,[x0,0,z0],[x0,0,-g],[x0,H,-g],[x0,H,z0]);b.quad(WICKER,[x0,0,g],[x0,0,z1],[x0,H,z1],[x0,H,g]);
 // a cabin, not a crate: corner posts up to a canopy valance above the tallest head; the door posts carry the valance as a lintel
 const cy=CANOPY_Y,vh=.22;for(const z of [-g,g])b.box(WOOD,x0,0,z,.07,cy-vh,.06);// door posts
 for(const [sx,sz] of [[-1,-1],[1,-1],[1,1],[-1,1]] as const)b.box(WOOD,sx*(L/2-.03),0,sz*(W/2-.03),.06,cy,.06);
 for(const [x,z,w,d] of [[0,z1,L+.06,.03],[0,z0,L+.06,.03],[x1,0,.03,W+.06],[x0,0,.03,W+.06]] as const){b.box(RED,x,cy-vh,z,w,vh,d);b.box(CREAM,x,cy-vh-.005,z,w+.01,.045,d+.01);}
 b.quad(WICKER_DARK,[x0,.005,z1],[x1,.005,z1],[x1,.005,z0],[x0,.005,z0]);b.box(WICKER_DARK,0,-.075,0,L+.04,.08,W+.04);// floor top at y 0 = Core's floorY
 const side=(W/2-g),mid=(W/2+g)/2;for(const [x,z,w,d] of [[0,z1,L+.08,.09],[0,z0,L+.08,.09],[x1,0,.09,W],[x0,-mid,.09,side],[x0,mid,.09,side]] as const)b.box(LEATHER,x,H-.02,z,w,.09,d);
 // wicker weave bands so the basket reads as woven, not as a crate
 for(const y of [.28,.56,.84])for(const [x,z,w,d] of [[0,z1+.006,L,.01],[0,z0-.006,L,.01],[x1+.006,0,.01,W],[x0-.006,-mid,.01,side],[x0-.006,mid,.01,side]] as const)b.box(WICKER_DARK,x,y,z,w,.05,d);
 // burner frame: four uprights, a square, the twin burner, load tapes to the mouth
 const fy=FRAME_Y;for(const [sx,sz] of [[-1,-1],[1,-1],[1,1],[-1,1]] as const){b.rope(STEEL,[sx*(L/2-.03),CANOPY_Y,sz*(W/2-.03)],[sx*.45,fy,sz*.4],.035);b.rope(ROPE,[sx*.45,fy,sz*.4],[sx*.62,mouthY+.05,sz*.62],.025);}
 for(const [a,c] of [[[-.45,-.4],[.45,-.4]],[[.45,-.4],[.45,.4]],[[.45,.4],[-.45,.4]],[[-.45,.4],[-.45,-.4]]] as const)b.rope(STEEL,[a[0],fy,a[1]],[c[0],fy,c[1]],.04);
 b.box(STEEL,0,fy-.18,0,.42,.28,.3);b.box('#2e2e30',-.1,fy+.1,0,.14,.12,.14);b.box('#2e2e30',.1,fy+.1,0,.14,.12,.14);
 // fuel tanks in the back corners, below the rim, clear of the door
 for(const z of [-.44,.44])b.box('#7a8590',-.5,.005,z,.3,.75,.24);
 return b.geometry();
}
/** Launch-site ground kit, world space: a board at the gate, sandbag ring, four tether stakes. */
export function buildLaunchKit(r:RideRoute=ROUTE){
 const b=new Builder(),[x,y,z]=r.launch.at,yaw=r.launch.yaw,c=Math.cos(yaw),s=Math.sin(yaw);
 const W=(f:number,rr:number):[number,number]=>[x+f*c-rr*s,z+f*s+rr*c];
 const [mx,mz]=W(BALLOON.door.at[0]+.15,BALLOON.door.at[1]);
 b.box(WOOD,mx,y,mz,.6,.04,.8,-yaw);// a flat board at the gate (no block to climb: the basket has a doorway)
 for(let i=0;i<11;i++){const a=i/12*Math.PI*2+Math.PI/12;if(Math.cos(a)<-.85)continue;const [sx,sz]=W(Math.cos(a)*2.3,Math.sin(a)*2.3);b.box(SAND,sx,y,sz,.55,.22,.32,-(yaw+a));}
 for(const [f,rr] of [[-1,-1],[1,-1],[1,1],[-1,1]] as const){const [sx,sz]=W(f*4.2,rr*4.2);b.box(WOOD,sx,y,sz,.08,.45,.08);}
 return b.geometry();
}
/** Tether ropes from the basket rim corners to the stakes (shown only while the basket is on the ground). */
export function buildTethers(r:RideRoute=ROUTE){
 const b=new Builder(),[x,y,z]=r.launch.at,yaw=r.launch.yaw,c=Math.cos(yaw),s=Math.sin(yaw),L=BALLOON.basket.length/2,Wd=BALLOON.basket.width/2;
 const P=(f:number,rr:number,h:number):V3=>[x+f*c-rr*s,y+h,z+f*s+rr*c];
 for(const [f,rr] of [[-1,-1],[1,-1],[1,1],[-1,1]] as const)b.rope(ROPE,P(f*L,rr*Wd,BALLOON.basket.height-.05),P(f*4.2,rr*4.2,.4),.03);
 return b.geometry();
}

type Override={p:[number,number,number];yaw:number};
type EntityLike={p:readonly number[];yaw?:number};
/** Per rider: when its seat override started (step up) or ended (step down) on the presentation clock. */
type RiderBlend={from:[number,number,number];since:number;leaving:boolean;last:Override};
const STEP_SECONDS=1.2;

export class WorldBalloonRide{
 readonly group=new THREE.Group();
 readonly balloon:THREE.Mesh;readonly flame:THREE.Mesh;readonly kit:THREE.Mesh;readonly tethers:THREE.Mesh;
 private rides=new Map<string,RideView>();
 private blends=new Map<string,RiderBlend>();
 private overrides=new Map<string,Override>();
 private touched:{o:THREE.Object3D;p:THREE.Vector3;ry:number}[]=[];
 private flightNow:number|null=null;private lastY:number|null=null;private smooth:{p:[number,number,number];yaw:number;t:number}|null=null;
 /** Last basket pose drawn (tests, snapshots, a future follow-the-balloon camera). */
 basket:{p:[number,number,number];yaw:number;aloft:boolean;burner:number}={p:[...ROUTE.launch.at] as [number,number,number],yaw:ROUTE.launch.yaw,aloft:false,burner:0};
 constructor(){
  this.group.name='balloon ride';
  const solid=new THREE.MeshStandardMaterial({name:'balloon ride',vertexColors:true,roughness:.78,side:THREE.DoubleSide});
  this.balloon=new THREE.Mesh(buildBalloon(),solid);this.balloon.name='balloon ride: envelope and basket';this.balloon.castShadow=true;
  const fm=new THREE.MeshBasicMaterial({name:'balloon ride: burner flame',color:'#ffb347',transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false});
  this.flame=new THREE.Mesh(new THREE.ConeGeometry(.16,1,7,1,true).translate(0,.5,0),fm);this.flame.name='balloon ride: burner flame';this.flame.position.set(0,FRAME_Y+.12,0);
  this.balloon.add(this.flame);
  this.kit=new THREE.Mesh(buildLaunchKit(),solid);this.kit.name='balloon ride: launch kit';this.kit.matrixAutoUpdate=false;
  this.tethers=new THREE.Mesh(buildTethers(),solid);this.tethers.name='balloon ride: tethers';this.tethers.matrixAutoUpdate=false;
  for(const m of [this.balloon,this.flame,this.kit,this.tethers]){m.userData.cameraTransparent=true;m.raycast=()=>{};m.receiveShadow=false;}
  this.group.add(this.balloon,this.kit,this.tethers);this.group.visible=false;
 }
 /** Merge Core spectator frames (all retained frames; fold is idempotent). */
 ingest(messages:Parameters<typeof ridesFromEdge>[0]){ridesFromEdge(messages,this.rides);}
 rideViews():ReadonlyMap<string,RideView>{return this.rides;}
 /** Once per frame, before labels/speech/camera read entity positions. Returns `at` itself, or a shallow copy whose
  * rider entities stand in their seats. `soulEntity` maps soulId → entityId. `seconds` is the presentation clock. */
 update<E extends EntityLike,T extends {tick:number;entities:Record<string,E>}>(at:T,o:{dt:number;seconds:number;eden:boolean;history:boolean;
  soulEntity:(soulId:string)=>string|null;nowMs?:number;preview?:{riders:readonly string[];phase:RidePhase;flight:number|null}|null}):T{
  this.overrides.clear();this.group.visible=o.eden;if(!o.eden){this.blends.clear();return at;}
  // the ride we depict: the preview, else the first known balloon ride on our route
  let view:RideView|undefined;for(const v of this.rides.values())if(v.route===ROUTE.id||!v.route){view=v;break;}
  const live=!o.history,carrier=view?.carrier??CARRIER,recorded=at.entities[carrier];
  // trust the recording unless it plainly disagrees with a live frame (e.g. a take without the carrier's track)
  const native=recorded&&!(live&&view?.phase==='aloft'&&view.position&&view.position[1]>5&&recorded.p[1]<1)?recorded:undefined;
  let riders:readonly string[]=[],pose:{p:[number,number,number];yaw:number;burner:number};
  if(o.preview&&live){riders=o.preview.riders;pose=o.preview.flight===null?routePose(ROUTE,0):routePose(ROUTE,o.preview.flight);this.flightNow=o.preview.flight;}
  else if(native){// the recording: tick-exact with the riders' bodies
   const climbing=this.lastY!==null&&native.p[1]-this.lastY>.004;this.lastY=native.p[1];
   pose={p:[native.p[0],native.p[1],native.p[2]],yaw:native.yaw??ROUTE.launch.yaw,burner:native.p[1]>.3&&(climbing||(o.seconds+7)%45<6)?1:0};this.flightNow=live?flightSeconds(view,o.nowMs??Date.now()):null;}
  else{this.flightNow=live?flightSeconds(view,o.nowMs??Date.now()):null;
   // Core's published position and yaw (frames every 0.5 s aloft), eased so the basket glides between frames instead of
   // stepping; never our own clock-driven path (the ride pauses while it hovers over a busy landing spot).
   if(live&&view?.position){const want=view.position,k=this.smooth?1-Math.exp(-4*Math.max(0,Math.min(.2,o.seconds-this.smooth.t))):1,prev=this.smooth?.p??[...want];
    const p:[number,number,number]=[prev[0]+(want[0]-prev[0])*k,prev[1]+(want[1]-prev[1])*k,prev[2]+(want[2]-prev[2])*k],far=Math.hypot(want[0]-prev[0],want[1]-prev[1],want[2]-prev[2])>25;
    const yaw=lerpAngle(this.smooth?.yaw??view.yaw??ROUTE.launch.yaw,view.yaw??ROUTE.launch.yaw,far?1:k),q:[number,number,number]=far?[...want] as [number,number,number]:p;
    this.smooth={p:q,yaw,t:o.seconds};pose={p:[...q] as [number,number,number],yaw,burner:view.phase==='aloft'&&(o.seconds+7)%45<6?1:0};}
   else pose=routePose(ROUTE,0);}
  const aloft=pose.p[1]-ROUTE.launch.at[1]>.3;
  this.basket={p:pose.p,yaw:pose.yaw,aloft,burner:pose.burner};
  this.balloon.position.set(pose.p[0],pose.p[1],pose.p[2]);this.balloon.rotation.set(0,-pose.yaw,0);
  // a little heave of the envelope with the burner; a flicker on the flame
  const flick=.75+.25*Math.sin(o.seconds*31)*Math.sin(o.seconds*17.3);
  this.flame.visible=pose.burner>0||(!aloft&&(o.seconds%9)<1.4);this.flame.scale.set(1,(pose.burner>0?1.4:.7)*flick,1);
  this.tethers.visible=!aloft;
  // riders into seats
  const seen=new Set<string>(),entities=at.entities;
  riders.slice(0,BALLOON.seats.length).forEach((soulId,i)=>{if(!soulId)return;const id=o.soulEntity(soulId),e=id?entities[id]:undefined;if(!id||!e)return;seen.add(id);
   const seat=seatWorld({p:pose.p,yaw:pose.yaw},BALLOON.seats[i]);
   if(Math.hypot(e.p[0]-seat.p[0],e.p[1]-seat.p[1],e.p[2]-seat.p[2])<1){this.blends.delete(id);return;}// native carriage already seats them
   let bl=this.blends.get(id);if(!bl||bl.leaving){const far=Math.hypot(e.p[0]-seat.p[0],e.p[1]-seat.p[1],e.p[2]-seat.p[2])>6;// far away (joined mid-flight, or a reload): no long glide
    bl={from:[e.p[0],e.p[1],e.p[2]],since:far?o.seconds-STEP_SECONDS:o.seconds,leaving:false,last:seat};this.blends.set(id,bl);}
   bl.last=seat;const k=Math.min(1,(o.seconds-bl.since)/STEP_SECONDS),p=stepArc(bl.from,seat.p,k);
   this.overrides.set(id,{p,yaw:k<1?lerpAngle(e.yaw??seat.yaw,seat.yaw,k):seat.yaw});});
  for(const [id,bl] of this.blends){if(seen.has(id))continue;const e=entities[id];if(!e){this.blends.delete(id);continue;}
   if(!bl.leaving){bl.leaving=true;bl.since=Math.hypot(e.p[0]-bl.last.p[0],e.p[1]-bl.last.p[1],e.p[2]-bl.last.p[2])>6?o.seconds-STEP_SECONDS:o.seconds;bl.from=[...bl.last.p] as [number,number,number];}
   const k=Math.min(1,(o.seconds-bl.since)/STEP_SECONDS);if(k>=1){this.blends.delete(id);continue;}
   this.overrides.set(id,{p:stepArc(bl.from,[e.p[0],e.p[1],e.p[2]],k),yaw:lerpAngle(bl.last.yaw,e.yaw??bl.last.yaw,k)});}
  if(!this.overrides.size)return at;
  const patched:Record<string,E>={...entities};for(const [id,v] of this.overrides)patched[id]={...entities[id],p:v.p,yaw:v.yaw};
  return {...at,entities:patched};
 }
 /** Seconds into the route being shown, null when parked (tests and UI). */
 flight(){return this.flightNow;}
 /** Move overridden rider bodies into their seats for this frame's draw. Call right before render (before fading). */
 pose(body:(entityId:string)=>THREE.Object3D|null){
  for(const [id,v] of this.overrides){const o=body(id);if(!o)continue;this.touched.push({o,p:o.position.clone(),ry:o.rotation.y});o.position.set(v.p[0],v.p[1],v.p[2]);o.rotation.y=-v.yaw;}
 }
 /** Undo pose() (call right after renderer.render, after fading.restore). */
 restore(){for(let i=this.touched.length-1;i>=0;i--){const t=this.touched[i];t.o.position.copy(t.p);t.o.rotation.y=t.ry;}this.touched.length=0;}
 dispose(){this.restore();this.group.removeFromParent();for(const m of [this.balloon,this.flame,this.kit,this.tethers]){m.geometry.dispose();(m.material as THREE.Material).dispose();}}
}
/** Step up into (or down out of) the basket: straight across with a 0.6 m arc. */
export function stepArc(a:readonly number[],b:readonly number[],k:number):[number,number,number]{
 const e=k*k*(3-2*k);return [a[0]+(b[0]-a[0])*e,a[1]+(b[1]-a[1])*e+.6*Math.sin(Math.PI*k),a[2]+(b[2]-a[2])*e];
}
