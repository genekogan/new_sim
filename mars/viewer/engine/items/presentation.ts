// One finite native clock for the opted-in item reach and return to ordinary idle.
// 1.0 s: an opted-in reach may bend the torso ~60° toward a table-top item; at 0.4 s that bend swung the free
// hand at ~5 m/s. At 0.8 s a 0.78 m reach to the far side of a table peaks at 1.46 m/s (0.073 m per 50 ms, take 3's
// bowl; 0.079 on the rig with the bend); 1.0 s peaks at 1.2 m/s, the middle of unhurried everyday reaching.
// The engine's opted-in reach / withdraw and the drawn posture hump both use this clock.
export const ITEM_REACH_SECONDS=1;
export const ITEM_RECOVERY_SECONDS=1.2;
/** A pick-up reach fades the idle variety (fold arms, look around) out over this long from the reach start, as M04's
 *  GESTURE_FADE (1.4 s, humans.ts) does for hand actuators. Longer here because the torso bends at the same time and
 *  carries the folded arms down with it: over 1.4 s the free hand dropped 0.095 m per 50 ms on the rig, over 2 s 0.079. */
export const ITEM_GESTURE_FADE_SECONDS=2;
/** An empty-handed pick-up: the drawn arm takes its goal over this long (s). The goal starts at the drawn palm and its
 *  share of the way is the reach clock ÷ this blend, so the palm travels on the reach clock alone (one smoothstep). */
export const ITEM_ARM_LEAD_SECONDS=.35;
/** `target`: the grasp / placement point (world, m) the reach lerps to, fixed when the reach starts. `mode`: a pick-up
 *  ('take') or a put; absent on older records. `cancelTick`: the tick a reach was interrupted (the hand withdraws). */
export type ItemTransferV1={item:string;hand:'left'|'right';action:string;mode?:'take'|'put';startTick:number;reachTick?:number;releaseTick?:number;cancelTick?:number;target?:[number,number,number]};
/** `posture`: bend toward the fixed grasp point, scaled by `k` — smoothstep up over the reach and down over the
 *  withdraw, the same clock as the engine's hand lerp, so the torso can neither pop nor hop between solutions.
 *  `goal`: a pick-up's empty-handed reach, drawn instead of the engine hand point: from the drawn palm (clip and idle
 *  gesture, before the arm IK) to the grasp point `p`, `k` of the way (the reach clock). */
export type ItemPresentation={weight:number;idleBlend:number;transfer?:true;posture?:{target:[number,number,number];hand:'left'|'right';k:number};goal?:{hand:'left'|'right';p:[number,number,number];k:number}};
const smooth=(n:number)=>{const k=Math.max(0,Math.min(1,n));return k*k*(3-2*k)};
/** Reach hump on the transfer clock: 0 before the reach, 1 at the grasp, 0 again once the withdraw is over. */
export function itemPostureK(transfer:ItemTransferV1,tick:number,dt:number){
 if(transfer.reachTick===undefined)return 0;
 const u=(tick-transfer.reachTick)*dt/ITEM_REACH_SECONDS;
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
 const reachK=reaching?smooth((cancelled?transfer.cancelTick!-transfer.reachTick!:tick-transfer.reachTick!)*dt/ITEM_REACH_SECONDS):0;
 const lead=smooth(s/ITEM_ARM_LEAD_SECONDS),back=cancelled?lead*(1-smooth((tick-transfer.cancelTick!)*dt/ITEM_REACH_SECONDS)):0;
 const goal=reaching?{goal:{hand:transfer.hand,p:transfer.target!,k:lead>1e-6?Math.min(1,reachK/lead):0}}:{};
 // After release the engine keeps the hand at its rest point through recovery: the drawn arm eases from it to the clip.
 if(transfer.releaseTick!==undefined){const r=smooth((tick-transfer.releaseTick)*dt/ITEM_RECOVERY_SECONDS);return{weight:holding?1:pickUp&&transfer.cancelTick!==undefined?0:1-r,idleBlend:Math.max(r,fade),...posture};}
 return{weight:holding?1:cancelled?back:reaching?lead:pickUp?smooth(s/ITEM_REACH_SECONDS):1,idleBlend:fade,...goal,...posture};
}
