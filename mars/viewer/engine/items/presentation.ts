// One finite native clock for the opted-in item reach and return to ordinary idle.
export const ITEM_REACH_SECONDS=.4;
export const ITEM_RECOVERY_SECONDS=1.2;
export type ItemTransferV1={item:string;hand:'left'|'right';action:string;startTick:number;reachTick?:number;releaseTick?:number};
export type ItemPresentation={weight:number;idleBlend:number;walkBlend?:number};
const smooth=(n:number)=>{const k=Math.max(0,Math.min(1,n));return k*k*(3-2*k)};
export function itemPresentation(transfer:ItemTransferV1|undefined,held:{left?:string;right?:string}|undefined,tick:number,dt:number):ItemPresentation|undefined {
 const holding=!!(held?.left||held?.right);
 if(!transfer)return holding?{weight:1,idleBlend:0}:undefined;
 const walkBlend=smooth((tick-transfer.startTick)*dt/.35);
 if(transfer.releaseTick!==undefined)return{weight:holding?1:0,idleBlend:smooth((tick-transfer.releaseTick)*dt/ITEM_RECOVERY_SECONDS),walkBlend};
 const weight=transfer.reachTick===undefined?0:smooth((tick-transfer.reachTick)*dt/ITEM_REACH_SECONDS);
 return{weight:holding?1:weight,idleBlend:holding?0:1-weight,walkBlend};
}
