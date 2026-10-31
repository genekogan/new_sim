// One finite native clock for the opted-in item reach and return to ordinary idle.
// 1.0 s: an opted-in reach may bend the torso ~60° toward a table-top item; at 0.4 s that bend swung the free
// hand at ~5 m/s. At 0.8 s a 0.78 m reach to the far side of a table peaks at 1.46 m/s (0.073 m per 50 ms, take 3's
// bowl; 0.079 on the rig with the bend); 1.0 s peaks at 1.2 m/s, the middle of unhurried everyday reaching.
// The engine's opted-in reach / withdraw and the drawn posture hump both use this clock.
export const ITEM_REACH_SECONDS=1;
export const ITEM_RECOVERY_SECONDS=1.2;
/** Entry 42 (take 4): after a put the released arm went back to the clip while an idle gesture faded in on the same
 *  1.2 s ramp: the gesture's share rode on the arm's return (a product of two ramps), and a hand-to-the-eyes look-around
 *  rose 0.9 m in 0.4 s (0.176 m per 50 ms). Now the arm is back on the clip in ITEM_PUT_ARM_BACK, and the gesture comes in
 *  afterwards over the rest of a longer put recovery (on the rig: folded arms 0.074, look-around 0.140 before). */
export const ITEM_PUT_RECOVERY_SECONDS=2.2,ITEM_PUT_ARM_BACK=.7,ITEM_PUT_GESTURE_DELAY=.3;
/** A pick-up reach fades the idle variety (fold arms, look around) out over this long from the reach start, as M04's
 *  GESTURE_FADE (1.4 s, humans.ts) does for hand actuators. Longer here because the torso bends at the same time and
 *  carries the folded arms down with it: over 1.4 s the free hand dropped 0.095 m per 50 ms on the rig, over 2 s 0.079. */
export const ITEM_GESTURE_FADE_SECONDS=2;
/** An empty-handed pick-up: the drawn arm takes its goal over this long (s). The goal starts at the drawn palm and its
 *  share of the way is the reach clock ÷ this blend, so the palm travels on the reach clock alone (one smoothstep). */
export const ITEM_ARM_LEAD_SECONDS=.35;
/** `target`: the grasp / placement point (world, m) the reach lerps to, fixed when the reach starts. `mode`: a pick-up
 *  ('take') or a put; absent on older records. `cancelTick`: the tick a reach was interrupted (the hand withdraws). */
type V3=[number,number,number];
/** Entry 42: the hand's path into (or out of) a container. Into: a cubic arc from the start over the lip (`c1` in front,
 *  `c2` above the place) down to `j` straight above the place at the lip, then straight down to the end; out: the
 *  reverse. `a`: the share of the path parameter on the straight part's far side, chosen so the speed matches there. */
export type InsideVia={into:boolean;c1:V3;c2:V3;j:V3;a:number};
const bez3=(p:V3,b:V3,c:V3,d:V3,t:number):V3=>{const u=1-t,k0=u*u*u,k1=3*u*u*t,k2=3*u*t*t,k3=t*t*t;return [p[0]*k0+b[0]*k1+c[0]*k2+d[0]*k3,p[1]*k0+b[1]*k1+c[1]*k2+d[1]*k3,p[2]*k0+b[2]*k1+c[2]*k2+d[2]*k3];};
const lin=(p:V3,q:V3,t:number):V3=>[p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t,p[2]+(q[2]-p[2])*t];
const raw=(from:V3,v:InsideVia,to:V3,u:number):V3=>v.into?(u<v.a?bez3(from,v.c1,v.c2,v.j,u/v.a):lin(v.j,to,(u-v.a)/(1-v.a))):(u<v.a?lin(from,v.j,u/v.a):bez3(v.j,v.c1,v.c2,to,(u-v.a)/(1-v.a)));
const ARC_N=48;
function arcTable(from:V3,v:InsideVia,to:V3){const acc=[0];let p=raw(from,v,to,0);for(let i=1;i<=ARC_N;i++){const q=raw(from,v,to,i/ARC_N);acc.push(acc[i-1]+Math.hypot(q[0]-p[0],q[1]-p[1],q[2]-p[2]));p=q;}return acc;}
/** How long an inside path is (m). */
export const insideLength=(from:V3,v:InsideVia,to:V3)=>arcTable(from,v,to)[ARC_N];
/** A point on an inside path a share u of the way along it by length (0 at `from`, 1 at `to`), so the hand moves at the
 *  clock's own speed profile (a cubic's parameter runs fast where its control points are far apart: 0.17 m per 50 ms at a
 *  reach start in take 1); the caller applies the smoothstep clock. */
export function insidePoint(from:V3,v:InsideVia,to:V3,u:number):V3{
 const acc=arcTable(from,v,to),want=Math.max(0,Math.min(1,u))*acc[ARC_N];let i=1;while(i<ARC_N&&acc[i]<want)i++;
 const seg=acc[i]-acc[i-1];return raw(from,v,to,(i-1+(seg>1e-9?(want-acc[i-1])/seg:0))/ARC_N);
}
/** Entry 42: an inside reach takes long enough that its hand travels at most ~0.8 m/s on average (peak 1.2 m/s, 0.06 m per
 *  50 ms under the smoothstep): its path over the lip is ~1.2 m against a table reach's ~0.7 m. */
export const insideReachSeconds=(length:number)=>Math.min(1.8,Math.max(ITEM_REACH_SECONDS,Math.round(length/0.8*20)/20));
/** `via`: entry 42, the reach's path over a container's lip (world, m); absent: a straight reach. */
export type ItemTransferV1={item:string;hand:'left'|'right';action:string;mode?:'take'|'put';startTick:number;reachTick?:number;releaseTick?:number;cancelTick?:number;target?:[number,number,number];via?:InsideVia;reachSeconds?:number};
/** `posture`: bend toward the fixed grasp point, scaled by `k` — smoothstep up over the reach and down over the
 *  withdraw, the same clock as the engine's hand lerp, so the torso can neither pop nor hop between solutions.
 *  `goal`: a pick-up's empty-handed reach, drawn instead of the engine hand point: from the drawn palm (clip and idle
 *  gesture, before the arm IK) to the grasp point `p`, `k` of the way (the reach clock). */
export type ItemPresentation={weight:number;idleBlend:number;transfer?:true;posture?:{target:[number,number,number];hand:'left'|'right';k:number};goal?:{hand:'left'|'right';p:[number,number,number];k:number;via?:InsideVia}};
const smooth=(n:number)=>{const k=Math.max(0,Math.min(1,n));return k*k*(3-2*k)};
/** Reach hump on the transfer clock: 0 before the reach, 1 at the grasp, 0 again once the withdraw is over. */
export function itemPostureK(transfer:ItemTransferV1,tick:number,dt:number){
 if(transfer.reachTick===undefined)return 0;
 const u=(tick-transfer.reachTick)*dt/(transfer.reachSeconds??ITEM_REACH_SECONDS);
 return u<=1?smooth(u):1-smooth(u-1);
}
export function itemPresentation(transfer:ItemTransferV1|undefined,held:{left?:string;right?:string}|undefined,tick:number,dt:number):ItemPresentation|undefined {
 const holding=!!(held?.left||held?.right);
 if(!transfer)return holding?{weight:1,idleBlend:0}:undefined;
 const k=itemPostureK(transfer,tick,dt),posture={transfer:true as const,...(transfer.target&&k>0?{posture:{target:transfer.target,hand:transfer.hand,k}}:{})};
 if(!transfer.mode){
  // Older records (no mode): the arm weight and the idle handoff on the reach clock, as they were.
  if(transfer.releaseTick!==undefined){const r=smooth((tick-transfer.releaseTick)*dt/ITEM_RECOVERY_SECONDS);return{weight:holding?1:1-r,idleBlend:r,...posture};}
  const weight=transfer.reachTick===undefined?0:smooth((tick-transfer.reachTick)*dt/ITEM_REACH_SECONDS);
  return{weight:holding?1:weight,idleBlend:holding?0:1-weight,...posture};
 }
 if(transfer.reachTick===undefined&&transfer.releaseTick===undefined)return{weight:holding?1:0,idleBlend:holding?0:1,...posture};
 const s=transfer.reachTick===undefined?Infinity:(tick-transfer.reachTick)*dt;
 // Only a pick-up starts with free arms, so only it fades an idle gesture out (on through the grasp and the withdraw,
 // or an interrupted reach, on the reach-start clock).
 const pickUp=transfer.mode==='take',fade=pickUp?1-smooth(s/ITEM_GESTURE_FADE_SECONDS):0;
 // An empty-handed pick-up reach draws the hand from where it is to the fixed grasp point on the reach clock. Blending
 // onto the moving engine hand (from the rest point by the hip) with the hand's own smoothstep drew
 // clip + (hand − clip)·s with hand = rest + (grasp − rest)·s: the palm lingered and then rushed (s² peaks 1.3× a
 // smoothstep; 0.111 m per 50 ms in take 3), and a fast blend instead swung folded arms down at 0.18. At the grasp the
 // goal is the engine hand's point, so the withdraw (holding, full weight on the engine hand) carries on from it.
 const reaching=pickUp&&!holding&&!!transfer.target&&transfer.releaseTick===undefined&&s<Infinity;
 // An interrupted pick-up: the goal stops where it was and the drawn arm goes back to the clip over the engine's
 // withdraw, then stays there through the recovery.
 const cancelled=reaching&&transfer.cancelTick!==undefined;
 const R=transfer.reachSeconds??ITEM_REACH_SECONDS;
 const reachK=reaching?smooth((cancelled?transfer.cancelTick!-transfer.reachTick!:tick-transfer.reachTick!)*dt/R):0;
 const lead=smooth(s/ITEM_ARM_LEAD_SECONDS),back=cancelled?lead*(1-smooth((tick-transfer.cancelTick!)*dt/R)):0;
 const goal=reaching?{goal:{hand:transfer.hand,p:transfer.target!,k:lead>1e-6?Math.min(1,reachK/lead):0,...(transfer.via?{via:transfer.via}:{})}}:{};
 // After release the engine keeps the hand at its rest point through recovery: the drawn arm eases from it to the clip.
 // A pick-up's recovery ends holding the item: no gesture comes back (it would be cut when the record clears), only
 // the reach-start fade runs out.
 if(transfer.releaseTick!==undefined&&transfer.mode==='put'&&!holding){const u=(tick-transfer.releaseTick)*dt;return{weight:1-smooth(u/ITEM_PUT_ARM_BACK),idleBlend:smooth((u-ITEM_PUT_GESTURE_DELAY)/(ITEM_PUT_RECOVERY_SECONDS-ITEM_PUT_GESTURE_DELAY)),...posture};}
 if(transfer.releaseTick!==undefined){const r=smooth((tick-transfer.releaseTick)*dt/ITEM_RECOVERY_SECONDS);return{weight:holding?1:pickUp&&transfer.cancelTick!==undefined?0:1-r,idleBlend:holding?fade:Math.max(r,fade),...posture};}
 return{weight:holding?1:cancelled?back:reaching?lead:pickUp?smooth(s/R):1,idleBlend:fade,...goal,...posture};
}
