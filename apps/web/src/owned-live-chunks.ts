import {recordedTakeChunkSchema,type RecordedTakeChunk} from '@sim/protocol';
// Only this module can brand a validated, detached, deeply immutable wire chunk.
// Mutable caller objects are never identity-cached or frozen in place.
const owned=new WeakSet<object>();
export function detachedData(value:unknown,ancestors=new Set<object>(),budget={nodes:0},depth=0):unknown{
 if(++budget.nodes>200000||depth>64)throw Error('Live chunk data budget');
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
export function ownLiveChunk(raw:unknown):RecordedTakeChunk|null{
 if(raw&&typeof raw==='object'&&owned.has(raw))return raw as RecordedTakeChunk;
 try{const result=recordedTakeChunkSchema.safeParse(detachedData(raw));if(!result.success)return null;freeze(result.data);owned.add(result.data);return result.data;}catch{return null;}
}
export function ownedLiveChunk(raw:unknown):RecordedTakeChunk|null{return raw&&typeof raw==='object'&&owned.has(raw)?raw as RecordedTakeChunk:null;}
