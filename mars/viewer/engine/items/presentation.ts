// One finite native clock for the opted-in item reach and return to ordinary idle.
// 0.8 s: an opted-in reach may bend the torso ~60° toward a table-top item; at 0.4 s that bend swung the free
// hand at ~5 m/s. The engine's opted-in reach / withdraw and the drawn posture hump both use this clock.
export const ITEM_REACH_SECONDS=.8;
export const ITEM_RECOVERY_SECONDS=1.2;
/** `target`: the grasp / placement point (world, m) the reach lerps to, fixed when the reach starts. */
export type ItemTransferV1={item:string;hand:'left'|'right';action:string;startTick:number;reachTick?:number;releaseTick?:number;target?:[number,number,number]};
/** `posture`: bend toward the fixed grasp point, scaled by `k` — smoothstep up over the reach and down over the
 *  withdraw, the same clock as the engine's hand lerp, so the torso can neither pop nor hop between solutions. */
export type ItemPresentation={weight:number;idleBlend:number;transfer?:true;posture?:{target:[number,number,number];hand:'left'|'right';k:number}};
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
 // After release the engine keeps the hand at its rest point through recovery: the drawn arm eases from it to the clip.
 if(transfer.releaseTick!==undefined){const r=smooth((tick-transfer.releaseTick)*dt/ITEM_RECOVERY_SECONDS);return{weight:holding?1:1-r,idleBlend:r,...posture};}
 const weight=transfer.reachTick===undefined?0:smooth((tick-transfer.reachTick)*dt/ITEM_REACH_SECONDS);
 return{weight:holding?1:weight,idleBlend:holding?0:1-weight,...posture};
}
