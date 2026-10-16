import {recordedTakeChunkSchema,type RecordedTakeChunk} from '@sim/protocol';
// Only this module can brand a validated, detached, deeply immutable wire chunk.
// Mutable caller objects are never identity-cached or frozen in place.
const owned=new WeakSet<object>();
// A built world carries its static physics (entityPhysicsV1: every building's floors, walls and stairs) in each take's
// final state: Eden 2026 (3.5k entities, 244 furnished buildings) is ~290k nodes. The old 200k cap silently dropped
// every live chunk there, so the viewer never drew a first frame. 2M keeps a bound against runaway data.
export const LIVE_CHUNK_NODE_BUDGET=2_000_000;
export function detachedData(value:unknown,ancestors=new Set<object>(),budget={nodes:0},depth=0):unknown{
 if(++budget.nodes>LIVE_CHUNK_NODE_BUDGET||depth>64)throw Error('Live chunk data budget');
 if(value===null||value===undefined||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'){if(!Number.isFinite(value))throw Error('Nonfinite live chunk');return value;}
 if(typeof value!=='object'||ancestors.has(value))throw Error('Live chunk plain acyclic data required');
 const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
 if(prototype!==(array?Array.prototype:Object.prototype)&&prototype!==null)throw Error('Live chunk plain data required');
 ancestors.add(value);const out:unknown[]|Record<string,unknown>=array?[]:{};
 try{for(const key of Reflect.ownKeys(value)){
  if(array&&key==='length')continue;if(typeof key!=='string')throw Error('Live chunk symbol');
  const property=Object.getOwnPropertyDescriptor(value,key);if(!property||!Object.hasOwn(property,'value'))throw Error('Live chunk accessor');
  Object.defineProperty(out,key,{value:detachedData(property.value,ancestors,budget,depth+1),enumerable:property.enumerable,writable:true,configurable:true});
 }}finally{ancestors.delete(value);}
 return out;
}
function freeze(value:unknown){if(value&&typeof value==='object'){for(const key of Reflect.ownKeys(value)){const property=Object.getOwnPropertyDescriptor(value,key);if(property&&Object.hasOwn(property,'value'))freeze(property.value);}Object.freeze(value);}}
// The viewer never reads a take's static physics (it draws geometry from /v1/scene); copying, validating and freezing
// it per live chunk cost ~120 ms a chunk on Eden 2026. Drop it from the owned copy only when every hop is plain data.
const dataOf=(value:unknown,key:string)=>{if(!value||typeof value!=='object'||Array.isArray(value))return undefined;const d=Object.getOwnPropertyDescriptor(value,key);return d&&Object.hasOwn(d,'value')?d.value as unknown:undefined;};
export function withoutStaticPhysics(raw:unknown):unknown{
 const take=dataOf(raw,'take'),state=dataOf(take,'finalState');
 if(!state||typeof state!=='object'||!Object.hasOwn(state,'entityPhysicsV1')||dataOf(state,'entityPhysicsV1')===undefined)return raw;
 const plain=(o:object)=>Reflect.ownKeys(o).every(k=>typeof k==='string'&&Object.hasOwn(Object.getOwnPropertyDescriptor(o,k)!,'value'));
 if(!plain(raw as object)||!plain(take as object)||!plain(state))return raw;
 const {entityPhysicsV1:_omit,...rest}=state as Record<string,unknown>;
 return {...(raw as object),take:{...(take as object),finalState:rest}};
}
export function ownLiveChunk(raw:unknown):RecordedTakeChunk|null{
 if(raw&&typeof raw==='object'&&owned.has(raw))return raw as RecordedTakeChunk;
 try{const result=recordedTakeChunkSchema.safeParse(detachedData(withoutStaticPhysics(raw)));if(!result.success)return null;freeze(result.data);owned.add(result.data);return result.data;}catch{return null;}
}
export function ownedLiveChunk(raw:unknown):RecordedTakeChunk|null{return raw&&typeof raw==='object'&&owned.has(raw)?raw as RecordedTakeChunk:null;}
