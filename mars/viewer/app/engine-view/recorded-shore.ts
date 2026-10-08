import {shoreContactV1Schema,type ShoreContactV1} from '../../../../packages/engine-contract/src/shore.ts';
import type {SampledEntity} from '../../engine/take/replay.ts';
export type ShoreDepiction =
 | {status:'absent'}
 | {status:'invalid';reason:string}
 | {status:'recorded';contact:ShoreContactV1;activity:string;motion:'dry'|'wade'|'swim'|'tread'|'fallback'};
/** Decode the recorded optional contact. Activities come from Core, never depth,
 * rendered water, bed interpolation or an invented swimming/controller outcome. */
export function shoreDepiction(entity:Pick<SampledEntity,'state'|'activity'>):ShoreDepiction {
 if(entity.state.shore===undefined)return {status:'absent'};
 const parsed=shoreContactV1Schema.safeParse(entity.state.shore);
 if(!parsed.success)return {status:'invalid',reason:'Unsupported or malformed recorded shore contact'};
 const activity=entity.activity??'idle';
 const motion=activity==='wade'?'wade':activity==='swim'?'swim':activity==='tread'?'tread':activity==='walk'||activity==='idle'?'dry':'fallback';
 return {status:'recorded',contact:parsed.data,activity,motion};
}
