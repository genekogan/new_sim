// Pure optional W consumer. Recorded poses remain authoritative; no movement/authority inference.
import {boatStateV1Schema,boatPassengerV1Schema,boatTransitV1Schema,nativeBoatLayoutV1Schema,type BoatStateV1,type BoatPassengerV1,type BoatTransitV1,type NativeBoatLayoutV1} from '../../../../packages/engine-contract/src/boat.ts';
import type {SampledEntity} from '../../engine/take/replay.ts';
type Result<T>={status:'absent'}|{status:'invalid';reason:string}|{status:'recorded';value:T};
export function recordedBoat(entity:Pick<SampledEntity,'state'>):Result<BoatStateV1>{
 if(entity.state.boat===undefined)return{status:'absent'};
 const parsed=boatStateV1Schema.safeParse(entity.state.boat);
 return parsed.success?{status:'recorded',value:parsed.data}:{status:'invalid',reason:'Unsupported or malformed recorded boat'};
}
export function recordedPassenger(entity:Pick<SampledEntity,'state'>):Result<{passenger:BoatPassengerV1;transit?:BoatTransitV1}>{
 // Take change records clear optional human fields with explicit null tombstones.
 if(entity.state.boatPassenger==null)return entity.state.boatTransit==null?{status:'absent'}:{status:'invalid',reason:'Transit without recorded passenger'};
 const passenger=boatPassengerV1Schema.safeParse(entity.state.boatPassenger);
 if(!passenger.success)return{status:'invalid',reason:'Unsupported or malformed recorded passenger'};
 if(entity.state.boatTransit==null)return{status:'recorded',value:{passenger:passenger.data}};
 const transit=boatTransitV1Schema.safeParse(entity.state.boatTransit);
 return transit.success?{status:'recorded',value:{passenger:passenger.data,transit:transit.data}}:{status:'invalid',reason:'Unsupported or malformed recorded transit'};
}
/** The accepted visual prefab origin is above the native keel. Apply the exact
 * published offset only; do not move occupants or infer a dock/connector pose. */
export function authoredBoatFrame(id:string,entity:SampledEntity,layout:NativeBoatLayoutV1):Result<{p:[number,number,number];yaw:number;boat:BoatStateV1}>{
 const boat=recordedBoat(entity);if(boat.status!=='recorded')return boat;
 const parsed=nativeBoatLayoutV1Schema.safeParse(layout);
 if(!parsed.success||parsed.data.boatId!==id||parsed.data.authoredFrameOffset[0]!==0||parsed.data.authoredFrameOffset[2]!==0||parsed.data.authoredFrameOffset[1]!==boat.value.frameOffsetY||!entity.p.every(Number.isFinite)||!Number.isFinite(entity.yaw))return{status:'invalid',reason:'Boat pose/layout/frame offset mismatch'};
 return{status:'recorded',value:{p:[entity.p[0],entity.p[1]+parsed.data.authoredFrameOffset[1],entity.p[2]],yaw:entity.yaw,boat:boat.value}};
}
