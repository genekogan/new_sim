import test from 'node:test';
import assert from 'node:assert/strict';
import manifest from './stair-mesh-profiles.json' with {type:'json'};
import {meshStairFlight,type MeshStairProfile} from './stair-mesh-profile.ts';
import {axisPoint,gaitAt,stairFootTarget,SWING,CLEAR,type Flight} from './stair-gait.ts';
import {stairShoeTrajectory,stairSwingAt,type ShoeOffset} from './stair-trajectory.ts';
import {stairSoleFit} from './stair-sole.ts';

const profile=manifest.profiles[1] as MeshStairProfile;
// Deliberately asymmetric test point cloud, not a replacement product boot.
const shape:ShoeOffset[]=[{x:-.16,y:-.08,z:-.06},{x:.22,y:-.08,z:-.06},{x:.22,y:-.08,z:.06},{x:-.16,y:-.08,z:.06},{x:.12,y:.18,z:0}];
const flight=()=>meshStairFlight(profile,'measured',{x:10,y:-.2403,z:0,yaw:0,s:1})!;
function gait(f:Flight,u:number){
 const n=f.treads.length,k=Math.floor(u),a=k<1?f.treads[0].s+(k-1)*f.going:k>=n?f.treads[n-1].s+(k-n)*(f.treads[n-1].s-f.treads[n-2].s):f.treads[k-1].s;
 const going=k<1?f.going:k>=n?f.treads[n-1].s-f.treads[n-2].s:f.treads[k].s-f.treads[k-1].s;
 const [x,z]=axisPoint(f,a+(u-k)*going,0),y=u<=1?f.yBottom:u>=n?f.yTop:f.treads[k-1].y+(f.treads[k].y-f.treads[k-1].y)*(u-k);
 const g=gaitAt(f,x,z,y,{reach:1,blend:.4});assert.ok(g);return g;
}
function target(f:Flight,u:number,side:'left'|'right'='right',yaw=0,offsets=shape){
 const g=gait(f,u),t=stairFootTarget(f,g,side,.1,yaw),p=stairShoeTrajectory(f,g,t.foot,t.point,offsets);assert.ok(p);return {g,t,p};
}
const distance=(a:ReturnType<typeof target>['p'],b:ReturnType<typeof target>['p'])=>Math.hypot(a.point[0]-b.point[0],a.y-b.y,a.point[1]-b.point[1]);
test('zero-distance stages are stationary, finite and deterministic',()=>{
 for(const [a,b,apex] of [[{s:2,y:1},{s:2,y:1},1],[{s:2,y:1},{s:2,y:1},1.07],[{s:2,y:1},{s:2,y:1.3},1.3]] as const){
  for(let i=0;i<=100;i++){const p=stairSwingAt(a,b,apex,i/100);assert.equal(p.s,2);assert.ok([p.s,p.y,...p.durations].every(Number.isFinite));assert.deepEqual(p,stairSwingAt(a,b,apex,i/100));}
  assert.equal(stairSwingAt(a,b,apex,0).y,a.y);assert.equal(stairSwingAt(a,b,apex,1).y,b.y);assert.equal(stairSwingAt(a,b,apex,.5).durations[1],0);
 }
});
test('corrected stance endpoints are shared at lift and landing, with zero-velocity stage joins',()=>{
 const f=flight(),epsilon=1e-6;
 for(const side of ['left','right'] as const)for(const k of [side==='left'?-1:0,side==='left'?1:2]){
  const start=k+.5,end=start+SWING;
  for(const u of [start,end]){
   const a=target(f,u-epsilon,side).p,b=target(f,u,side).p,c=target(f,u+epsilon,side).p;
   assert.ok(distance(a,b)<1e-8&&distance(b,c)<1e-8,'one endpoint for swing and plant');
  }
  const {p}=target(f,start+SWING/2,side),joins=[p.durations[0],p.durations[0]+p.durations[1]];
  for(const t of joins){const u=start+SWING*t,a=target(f,u-epsilon,side).p,b=target(f,u,side).p,c=target(f,u+epsilon,side).p;assert.ok(distance(a,b)/epsilon<.001&&distance(b,c)/epsilon<.001,'zero derivative at rise/translate/land joins');}
  const up=target(f,start+SWING*(p.durations[0]+p.durations[1]/2),side).p;
  assert.ok(Math.abs(up.y-up.apex)<1e-10);assert.ok(Math.abs(up.durations.reduce((a,b)=>a+b)-1)<1e-12);
 }
});
test('every measured shoe point clears crossed actual supports throughout swing; residual is zero',()=>{
 const f=flight();let overhang=false;
 for(const side of ['left','right'] as const)for(let u=-.5;u<=4.5;u+=.002){
  const {t,p}=target(f,u,side),vertices=shape.map(o=>({x:p.point[0]+o.x,y:p.y+o.y,z:p.point[1]+o.z})),fit=stairSoleFit(f,t.foot,vertices);
  assert.ok(Math.abs(fit.along)<1e-8&&fit.lift<1e-8,`main trajectory cannot rely on a discontinuous residual u=${u}`);
  if(t.foot.planted&&t.foot.k===1){const s=Math.min(...vertices.map(p=>(p.x-f.o[0])*f.dir[0]+(p.z-f.o[1])*f.dir[1]));overhang ||= s<f.supports![0].lo;}
 }
 assert.ok(overhang,'lower-side overhang remains permitted');
 const {p}=target(f,.5+SWING/2);assert.ok(p.apex>=f.supports![1].y+CLEAR+.08);
});
test('descent replays the same stateless path in reverse; no within-swing jumps',()=>{
 const f=flight(),up=Array.from({length:801},(_,i)=>target(f,.5+SWING*i/800).p),down=Array.from({length:801},(_,i)=>target(f,.5+SWING*(800-i)/800).p);
 for(let i=0;i<up.length;i++){assert.ok(distance(up[i],down[800-i])<1e-12);if(i)assert.ok(distance(up[i-1],up[i])<.004);}
});
test('mesh/yaw/translation/scale transforms preserve the path; perpendicular native turns stay continuous',()=>{
 const f=flight(),yaw=.83,c=Math.cos(yaw),sn=Math.sin(yaw);
 // Mesh transform uses yaw around -Y. Match body heading and rotate measured offsets.
 for(const scale of [1,1.4]){
  const moved=meshStairFlight(profile,'moved',{x:-20,y:2,z:8,yaw:-yaw,s:scale})!,offsets=shape.map(p=>({x:scale*(c*p.x-sn*p.z),y:scale*p.y,z:scale*(sn*p.x+c*p.z)}));
  for(const u of [.5,.6,.9,1.2,1.3,1.8,2.7]){
   const a=target(f,u).p,{p:b,t}=target(moved,u,'right',yaw,offsets),vertices=offsets.map(p=>({x:b.point[0]+p.x,y:b.y+p.y,z:b.point[1]+p.z})),fit=stairSoleFit(moved,t.foot,vertices);
   assert.ok(Math.abs(fit.along)<1e-8&&fit.lift<1e-8,'transformed shoe clears the transformed actual surfaces');
   if(scale===1){assert.ok(Math.hypot(b.point[0]-(-20+c*(a.point[0]-10)-sn*a.point[1]),b.point[1]-(8+sn*(a.point[0]-10)+c*a.point[1]))<1e-10);assert.ok(Math.abs(b.y-(a.y+.2403+2))<1e-10);}
   const turned=(angle:number)=>shape.map(p=>({x:scale*(Math.cos(angle)*p.x-Math.sin(angle)*p.z),y:scale*p.y,z:scale*(Math.sin(angle)*p.x+Math.cos(angle)*p.z)}));
   const before=target(moved,u,'right',yaw+Math.PI/2-1e-7,turned(yaw+Math.PI/2-1e-7)).p,after=target(moved,u,'right',yaw+Math.PI/2+1e-7,turned(yaw+Math.PI/2+1e-7)).p;
   assert.ok(distance(before,after)<1e-6,'no stance flip at perpendicular yaw');
  }
 }
 const g=gait(f,.8),t=stairFootTarget(f,g,'right',.1,0);
 assert.equal(stairShoeTrajectory({...f,supports:undefined},g,t.foot,t.point,shape),null,'generic gait has no measured override');
 assert.equal(stairShoeTrajectory(f,g,t.foot,t.point,[]),null,'missing actual shoe measurement cannot fabricate one');
});
