// take-entities-ref/1 (lane L3e): a lossless, per-connection transport for the live take stream.
// Every take chunk carries finalState.entities, the world's whole entity table (Eden 2026: ~4,900 entities,
// 1.47 MB of JSON), and the stream sends one chunk a second. The table rarely changes between chunks (only what
// moved or was edited), so a peer that announces this contract receives each chunk's table as
//   - the full table (the first one on the connection, or when a patch would not be smaller),
//   - {"$takeEntitiesRefV1": id}: the same table as the previous chunk this connection received, or
//   - {"$takeEntitiesPatchV1": {base, n, del, ins, set}}: the previous table without the `del` keys, each new key inserted
//     at its index (`ins`: [index, key] ascending), then `set` values assigned (only when the result has exactly the key
//     order of the real table).
// The client restores the exact take (same keys, same order, same values; JSON.stringify identical) before any
// other code reads it. Canonical takes, recordings, HTTP history and peers that did not announce it never see refs.
// The envelope is {t:'take-entities', contract, ids, payload}: ids[i] is chunk i's table id (null: no table);
// payload is the takes stream (or its take-boundary-wire envelope when that transport is negotiated too).
export const TAKE_ENTITIES_WIRE_V1='take-entities-ref/1' as const;
// take-entities-join/1 (lane W1, slim join step 1): a peer that announces it next to take-entities-ref/1 (and gets it echoed
// in the welcome) receives each snapshot with `entitiesTable: id`, the encoder's id for that snapshot's entity table. That
// table becomes the connection's last table on both sides, so the join's first take (the same table, Eden 2026: 1.44 MB)
// travels as a reference or a patch against it instead of a second full copy. Peers that did not announce it, and every
// HTTP snapshot, are unchanged.
export const TAKE_ENTITIES_JOIN_V1='take-entities-join/1' as const;
const REF='$takeEntitiesRefV1',PATCH='$takeEntitiesPatchV1';
type JsonObject=Record<string,unknown>;
const record=(v:unknown):v is JsonObject=>!!v&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
function fail(reason:string):never{throw new Error('take-entities-wire.invalid: '+reason);}

/** One entity table as the encoder knows it: the exact JSON of each entry, in the table's own key order. */
type TableInfo={id:number;keys:string[];parts:string[];json:string;index?:Map<string,string>};
const tableOf=(chunk:unknown):JsonObject|undefined=>{
 const c=chunk as {take?:{finalState?:{entities?:unknown}}},e=record(c)&&record(c.take)&&record(c.take.finalState)?c.take.finalState.entities:undefined;
 return record(e)&&Object.getPrototypeOf(e)===Object.prototype?e:undefined;
};

/** Server side, one per hub: assigns ids to distinct entity tables and encodes a public takes stream for one peer.
 *  Stateless per peer: the hub keeps each peer's `last` id and advances it only when the message was really sent. */
export class TakeEntitiesEncoderV1{
 private info=new WeakMap<object,TableInfo|null>();
 private recent:TableInfo[]=[];private nextId=1;
 private patches=new Map<string,JsonObject|null>();
 private keep:number;
 constructor(keep=16){this.keep=keep;}
 private describe(table:JsonObject):TableInfo|null{
  const known=this.info.get(table);if(known!==undefined)return known;
  const keys=Object.keys(table),parts:string[]=new Array(keys.length);
  // a one-entry table named like a reference would read as one: it always travels raw (id null)
  let ok=!(keys.length===1&&(keys[0]===REF||keys[0]===PATCH));
  for(let i=0;i<keys.length;i++){const s=JSON.stringify(table[keys[i]]);if(typeof s!=='string'||keys[i]==='__proto__'){ok=false;break;}parts[i]=s;}
  // Same bytes as JSON.stringify(table) for plain data; anything else keeps the full table.
  const json=ok?'{'+keys.map((k,i)=>JSON.stringify(k)+':'+parts[i]).join(',')+'}':'';
  if(!ok||json!==JSON.stringify(table)){this.info.set(table,null);return null;}
  const same=this.recent.find(t=>t.json===json);
  const info:TableInfo=same??{id:this.nextId++,keys,parts,json};
  if(!same){this.recent.push(info);if(this.recent.length>this.keep)this.recent.shift();}
  this.info.set(table,info);return info;
 }
 private patch(base:TableInfo,next:TableInfo,table:JsonObject):JsonObject|null{
  const key=base.id+'>'+next.id;if(this.patches.has(key))return this.patches.get(key)!;
  base.index??=new Map(base.keys.map((k,i)=>[k,base.parts[i]]));next.index??=new Map(next.keys.map((k,i)=>[k,next.parts[i]]));
  const set:JsonObject={},del:string[]=[],ins:[number,string][]=[];let bytes=0;
  for(const k of base.keys)if(!next.index.has(k))del.push(k);
  for(let i=0;i<next.keys.length;i++){const k=next.keys[i],was=base.index.get(k);if(was===next.parts[i])continue;if(was===undefined){ins.push([i,k]);bytes+=k.length+12;}set[k]=table[k];bytes+=k.length+next.parts[i].length+4;}
  // the client rebuilds the base keys without `del`, inserts each new key at its index, then assigns: patch only when
  // that rebuild has exactly the real key order (an object's own order rules, so this is checked on a real object)
  const gone=new Set(del),order=base.keys.filter(k=>!gone.has(k));for(const [i,k] of ins)order.splice(i,0,k);
  const sim:Record<string,1>={};for(const k of order)sim[k]=1;
  const rebuilt=Object.keys(sim),exact=rebuilt.length===next.keys.length&&rebuilt.every((k,i)=>k===next.keys[i]);
  const out=exact&&bytes+del.join('","').length<next.json.length/2?{[PATCH]:{base:base.id,n:next.keys.length,del,ins,set}}:null;
  this.patches.set(key,out);if(this.patches.size>64)this.patches.delete(this.patches.keys().next().value!);
  return out;
 }
 /** take-entities-join/1: register a snapshot's entity table (same registry as the take tables). Returns its id and its
  *  exact JSON (JSON.stringify(entities)), or null when the table cannot be referenced (it then travels without an id). */
 register(entities:unknown):{id:number;json:string}|null{
  if(!record(entities)||Object.getPrototypeOf(entities)!==Object.prototype)return null;
  const info=this.describe(entities);return info?{id:info.id,json:info.json}:null;
 }
 /** Encode one public takes stream for a peer whose last received table is `last`. Returns null when the stream has
  *  no entity table (send it raw; the peer's state is unchanged), else the envelope object and the peer's next id. */
 encode(stream:{chunks:unknown[]}&JsonObject,last:number|null):{envelope:JsonObject;last:number|null}|null{
  if(!record(stream)||!Array.isArray(stream.chunks))return null;
  const ids:(number|null)[]=[];let any=false,current=last;
  const chunks=stream.chunks.map(chunk=>{
   const table=tableOf(chunk);if(!table){ids.push(null);return chunk;}
   const info=this.describe(table);if(!info){ids.push(null);return chunk;}
   any=true;ids.push(info.id);
   const base=current===null?undefined:this.recent.find(t=>t.id===current);
   const entities=current===info.id?{[REF]:info.id}:base?this.patch(base,info,table)??table:table;
   current=info.id;
   const c=chunk as {take:{finalState:JsonObject}};
   return entities===table?chunk:{...c,take:{...c.take,finalState:{...c.take.finalState,entities}}};
  });
  if(!any)return null;
  // a chunk without a usable table (null id) carries its own full table and does not move the peer's state
  return {envelope:{t:'take-entities',contract:TAKE_ENTITIES_WIRE_V1,ids,payload:{...stream,chunks}},last:current};
 }
}

const deepFreeze=(v:unknown)=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const k of Object.keys(v))deepFreeze((v as JsonObject)[k]);Object.freeze(v);}return v;};
/** Client side state for one connection: the table of the last chunk received (deeply frozen, shared by later chunks). */
export type TakeEntitiesStateV1={last:{id:number;table:JsonObject}|null};
/** take-entities-join/1, client side: a snapshot that names its entity table (`entitiesTable`) makes a deeply frozen copy
 *  of that table the connection's last table (the replica keeps and mutates the snapshot's own objects). Returns the
 *  snapshot without the field. Throws on a malformed id or table. */
export function adoptSnapshotTableV1<T extends JsonObject>(snapshot:T,state:TakeEntitiesStateV1):Omit<T,'entitiesTable'>{
 const {entitiesTable:id,...rest}=snapshot;
 if(!Number.isSafeInteger(id)||(id as number)<1)fail('snapshot table id');
 if(!record(rest.entities))fail('snapshot table');
 state.last={id:id as number,table:deepFreeze(structuredClone(rest.entities)) as JsonObject};
 return rest;
}
/** Restore the exact takes stream from a take-entities envelope (after the inner payload's own transport is restored by
 *  `inner`). Tables are deeply frozen and shared between chunks that carry the same table. Throws on anything else. */
export function hydrateTakeEntitiesV1(input:unknown,state:TakeEntitiesStateV1,inner:(payload:unknown)=>unknown=p=>p):unknown{
 if(!record(input)||input.t!=='take-entities')return input;
 if(Object.keys(input).sort().join(',')!=='contract,ids,payload,t'||input.contract!==TAKE_ENTITIES_WIRE_V1||!Array.isArray(input.ids))fail('envelope');
 const payload=inner(input.payload) as {t?:unknown;chunks?:unknown};
 if(!record(payload)||payload.t!=='takes'||!Array.isArray(payload.chunks)||payload.chunks.length!==input.ids.length)fail('payload');
 const ids=input.ids as unknown[];let last=state.last;
 const chunks=payload.chunks.map((chunk,i)=>{
  const id=ids[i];
  if(id===null)return chunk;
  if(!Number.isSafeInteger(id)||(id as number)<1)fail('id');
  const c=chunk as {take:{finalState:JsonObject}},sent=record(c)&&record(c.take)&&record(c.take.finalState)?c.take.finalState.entities:undefined;
  if(!record(sent))fail('chunk shape');
  let table:JsonObject;
  const keys=Object.keys(sent);
  if(keys.length===1&&keys[0]===REF){if(sent[REF]!==id||!last||last.id!==id)fail('unknown reference');table=last.table;}
  else if(keys.length===1&&keys[0]===PATCH){
   const p=sent[PATCH] as {base?:unknown;n?:unknown;del?:unknown;ins?:unknown;set?:unknown};
   if(!record(p)||Object.keys(p).sort().join(',')!=='base,del,ins,n,set'||!last||p.base!==last.id||!Array.isArray(p.del)||!Array.isArray(p.ins)||!record(p.set)||!Number.isSafeInteger(p.n))fail('patch shape');
   const gone=new Set(p.del as unknown[]),set=p.set as JsonObject,base=last.table,keys=Object.keys(base).filter(k=>!gone.has(k)),added=new Set<string>();
   let at=-1;
   for(const e of p.ins as unknown[]){
    if(!Array.isArray(e)||e.length!==2||!Number.isSafeInteger(e[0])||typeof e[1]!=='string')fail('patch insert');
    const [i,k]=e as [number,string];
    if(i<=at||i>keys.length||k==='__proto__'||Object.hasOwn(base,k)||!Object.hasOwn(set,k)||added.has(k))fail('patch insert');
    keys.splice(i,0,k);added.add(k);at=i;
   }
   for(const k of Object.keys(set))if(!Object.hasOwn(base,k)&&!added.has(k))fail('patch key');
   const out:JsonObject={};
   for(const k of keys)out[k]=Object.hasOwn(set,k)?deepFreeze(set[k]):base[k];
   if(Object.keys(out).length!==p.n)fail('patch size');
   table=Object.freeze(out);
  }else table=deepFreeze(sent) as JsonObject;
  last={id:id as number,table};
  return table===sent?chunk:{...c,take:{...c.take,finalState:{...c.take.finalState,entities:table}}};
 });
 state.last=last;
 return {...payload,chunks};
}
