// take-chunk-ref/1 (lane S2): a lossless, per-connection transport for the parts of a live take that repeat.
// take-entities-ref/1 removes the entity table from chunks that repeat it, but a take carries more: the original
// worlds (old Eden) put ~380 KB a chunk into fields that do not change between chunks (finalState.authoredBoundariesV1
// 195 KB, finalState.navV1 104 KB, finalState.regions, take.entities0, take.changes, take.tracks), and after the join
// the stream sends one chunk a second, so take-boundary-facts/1 (which shares a fact inside one message) cannot help.
// A peer that announces this contract (hello takeChunks) receives each takes message wrapped as
//   {t:'take-chunks', contract, ids, same, payload}
// ids[i]: chunk i's take id (null: the chunk is not a plain take; it travels whole and does not move either side's state).
// same[i]: null (the chunk travels whole), or [base, takeKeys, stateKeys]: the take is the one with id `base` (the last
//   take this connection received) with the take's own `takeKeys` and finalState's `stateKeys` left out; they hold
//   values whose JSON is identical to the base's, and the take and its finalState have exactly the base's key order.
//   `finalState` itself and `finalState.entities` are never left out (take-entities-ref/1 owns the table).
// payload is the message this peer would otherwise have received for the reduced stream (takes, take-entities or
// take-boundary-wire), so the other transports compose unchanged inside it. The client restores the exact take (same
// keys, same order, same values; JSON.stringify identical) before any other code reads it. Recordings, HTTP history
// and peers that did not announce it never see it.
export const TAKE_CHUNKS_WIRE_V1='take-chunk-ref/1' as const;
type JsonObject=Record<string,unknown>;
const record=(v:unknown):v is JsonObject=>!!v&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
function fail(reason:string):never{throw new Error('take-chunk-wire.invalid: '+reason);}
/** Values shorter than this travel even when they repeat: listing the key would cost about as much. */
const MIN_PART=24;
/** One take as the encoder knows it: its own keys and finalState's keys, in order, with the JSON of each omittable value. */
type TakeInfo={id:number;keys:string[];parts:(string|null)[];stateKeys:string[]|null;stateParts:(string|null)[]};
const takeOf=(chunk:unknown):JsonObject|undefined=>{const c=chunk as {take?:unknown};return record(c)&&record(c.take)?c.take:undefined;};
const sameKeys=(a:string[]|null,b:string[]|null)=>a===b||!!a&&!!b&&a.length===b.length&&a.every((k,i)=>k===b[i]);
export type TakeChunksSameV1=[base:number,takeKeys:string[],stateKeys:string[]]|null;

/** Server side, one per hub: assigns ids to takes and encodes a public takes stream for one peer. Stateless per peer:
 *  the hub keeps each peer's `last` id and advances it only when the message was really sent. */
export class TakeChunksEncoderV1{
 private info=new WeakMap<object,TakeInfo|null>();
 private recent:TakeInfo[]=[];private nextId=1;
 private pairs=new Map<string,TakeChunksSameV1>();
 private keep:number;
 constructor(keep=16){this.keep=keep;}
 private describe(take:JsonObject):TakeInfo|null{
  const known=this.info.get(take);if(known!==undefined)return known;
  // a value JSON drops (undefined, a function) would make the received keys differ from the take's own: send it whole
  let ok=true;
  const parts=(o:JsonObject,keys:string[],own:string)=>keys.map(k=>{
   if(k==='__proto__')ok=false;
   const v=o[k];if(k===own&&record(v))return null;
   const s=JSON.stringify(v);if(typeof s!=='string')ok=false;
   return k!==own&&typeof s==='string'&&s.length>=MIN_PART?s:null;
  });
  const keys=Object.keys(take),takeParts=parts(take,keys,'finalState');
  const state=take.finalState,stateKeys=record(state)?Object.keys(state):null,stateParts=stateKeys?parts(state as JsonObject,stateKeys,'entities'):[];
  const out=ok?{id:this.nextId++,keys,parts:takeParts,stateKeys,stateParts}:null;
  if(out){this.recent.push(out);if(this.recent.length>this.keep)this.recent.shift();}
  this.info.set(take,out);return out;
 }
 private same(base:TakeInfo,next:TakeInfo):TakeChunksSameV1{
  const key=base.id+'>'+next.id;if(this.pairs.has(key))return this.pairs.get(key)!;
  let out:TakeChunksSameV1=null;
  // the client rebuilds in the base's key order, so only a take with exactly that order may leave keys out
  if(sameKeys(base.keys,next.keys)&&sameKeys(base.stateKeys,next.stateKeys)){
   const takeKeys=next.keys.filter((k,i)=>next.parts[i]!==null&&next.parts[i]===base.parts[i]);
   const stateKeys=(next.stateKeys??[]).filter((k,i)=>next.stateParts[i]!==null&&next.stateParts[i]===base.stateParts[i]);
   if(takeKeys.length||stateKeys.length)out=[base.id,takeKeys,stateKeys];
  }
  this.pairs.set(key,out);if(this.pairs.size>64)this.pairs.delete(this.pairs.keys().next().value!);
  return out;
 }
 /** Encode one public takes stream for a peer whose last received take is `last`. Returns null when no chunk is a plain
  *  take (send the stream as before; the peer's state is unchanged), else the reduced stream to send inside the
  *  envelope, the envelope's ids and same lists, and the peer's next id. */
 encode(stream:{chunks:unknown[]}&JsonObject,last:number|null):{stream:JsonObject&{chunks:unknown[]};ids:(number|null)[];same:TakeChunksSameV1[];last:number|null}|null{
  if(!record(stream)||!Array.isArray(stream.chunks))return null;
  const ids:(number|null)[]=[],same:TakeChunksSameV1[]=[];let any=false,current=last;
  const chunks=stream.chunks.map(chunk=>{
   const take=takeOf(chunk),info=take?this.describe(take):null;
   if(!take||!info){ids.push(null);same.push(null);return chunk;}
   any=true;ids.push(info.id);
   const base=current===null?undefined:this.recent.find(t=>t.id===current);
   const s=base?this.same(base,info):null;same.push(s);current=info.id;
   if(!s)return chunk;
   const gone=new Set(s[1]),goneState=new Set(s[2]),reduced:JsonObject={};
   for(const k of info.keys)if(!gone.has(k))reduced[k]=take[k];
   if(goneState.size){const state=take.finalState as JsonObject,r:JsonObject={};for(const k of info.stateKeys!)if(!goneState.has(k))r[k]=state[k];reduced.finalState=r;}
   return {...(chunk as JsonObject),take:reduced};
  });
  if(!any)return null;
  return {stream:{...stream,chunks},ids,same,last:current};
 }
}

const deepFreeze=(v:unknown)=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const k of Object.keys(v))deepFreeze((v as JsonObject)[k]);Object.freeze(v);}return v;};
/** Client side state for one connection: the last take received, restored (its values deeply frozen, shared by later takes). */
export type TakeChunksStateV1={last:{id:number;take:JsonObject}|null};
const keyList=(v:unknown,what:string):string[]=>{if(!Array.isArray(v)||v.some(k=>typeof k!=='string'||k==='__proto__')||new Set(v).size!==v.length)fail(what);return v as string[];};
/** Rebuild `object` in `order` with `gone` keys taken from `base`: the received object must hold exactly the others, in order. */
function rebuild(base:JsonObject,received:JsonObject,gone:string[],never:string,what:string):JsonObject{
 const order=Object.keys(base),left=new Set(gone);
 if(left.has(never)||gone.some(k=>!Object.hasOwn(base,k)))fail(what+' key');
 const expected=order.filter(k=>!left.has(k)),got=Object.keys(received);
 if(got.length!==expected.length||got.some((k,i)=>k!==expected[i]))fail(what+' order');
 const out:JsonObject={};for(const k of order)out[k]=left.has(k)?base[k]:received[k];
 return out;
}
/** Restore the exact takes stream from a take-chunks envelope (after the inner payload's own transports are restored by
 *  `inner`). Repeated values are deeply frozen and shared between takes. Throws on anything else, leaving `state` as it was. */
export function hydrateTakeChunksV1(input:unknown,state:TakeChunksStateV1,inner:(payload:unknown)=>unknown=p=>p):unknown{
 if(!record(input)||input.t!=='take-chunks')return input;
 if(Object.keys(input).sort().join(',')!=='contract,ids,payload,same,t'||input.contract!==TAKE_CHUNKS_WIRE_V1||!Array.isArray(input.ids)||!Array.isArray(input.same))fail('envelope');
 const payload=inner(input.payload) as {t?:unknown;chunks?:unknown};
 if(!record(payload)||payload.t!=='takes'||!Array.isArray(payload.chunks)||payload.chunks.length!==input.ids.length||input.same.length!==input.ids.length)fail('payload');
 const ids=input.ids as unknown[],sames=input.same as unknown[];let last=state.last;
 const chunks=payload.chunks.map((chunk,i)=>{
  const id=ids[i],s=sames[i];
  if(id===null){if(s!==null)fail('same without id');return chunk;}
  if(!Number.isSafeInteger(id)||(id as number)<1)fail('id');
  const c=chunk as {take?:unknown},received=record(c)&&record(c.take)?c.take:undefined;
  if(!received)fail('chunk shape');
  let take:JsonObject;
  if(s===null){
   take=received;
  }else{
   if(!Array.isArray(s)||s.length!==3||!last||s[0]!==last.id)fail('unknown base');
   const takeKeys=keyList(s[1],'take keys'),stateKeys=keyList(s[2],'state keys'),base=last.take;
   take=rebuild(base,received,takeKeys,'finalState','take');
   if(stateKeys.length){
    if(!record(base.finalState)||!record(received.finalState))fail('state shape');
    take.finalState=rebuild(base.finalState,received.finalState,stateKeys,'entities','state');
   }
  }
  // freeze what a later take may share; the entity table is take-entities-ref/1's (already frozen there when negotiated)
  for(const k of Object.keys(take))if(k!=='finalState')deepFreeze(take[k]);
  if(record(take.finalState))for(const k of Object.keys(take.finalState))if(k!=='entities')deepFreeze(take.finalState[k]);
  last={id:id as number,take};
  return take===received?chunk:{...(c as JsonObject),take};
 });
 state.last=last;
 return {...payload,chunks};
}
