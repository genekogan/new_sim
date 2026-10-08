import { parseSceneInfo, type SceneInfo, type Chunk, chunkAt, recordingTick } from './WorldGeometry.ts';
/** Consumer projection of Core render-scene-ref/1, not a new producer schema. */
export type RecordedSceneRef = { contract:'render-scene-ref/1'; hash:string; rulesVersion:string };
export type VerifiedSceneCapture = { worldId:string; ref:RecordedSceneRef; body:unknown };
export type ResolvedScene = { status:'bound'; ref:RecordedSceneRef; info:SceneInfo; publication?:{worldId:string;contract:'render-scene-capture/1';ref:RecordedSceneRef;body:unknown} } |
  { status:'unbound'|'unavailable'|'stale'; reason:string; info:null };
export const MAX_SCENE_HISTORY = 8;
const validRef = (x: unknown): x is RecordedSceneRef => !!x && typeof x==='object' &&
  (x as RecordedSceneRef).contract==='render-scene-ref/1' && typeof (x as RecordedSceneRef).hash==='string' && /^[a-f0-9]{64}$/.test((x as RecordedSceneRef).hash) &&
  typeof (x as RecordedSceneRef).rulesVersion==='string' && (x as RecordedSceneRef).rulesVersion.length>0 && (x as RecordedSceneRef).rulesVersion.length<=200;
/** The latest-start take owns a shared endpoint and selects its render base.
 * An earlier chunk retains its immutable endpoint sample for its own capture. */
export function sceneSegmentAt(chunks: readonly Chunk[], tick: number) {
  const picked=chunkAt(chunks,tick);
  return picked ? {chunk:picked.chunk,shownTick:recordingTick(picked.chunk,tick),exact:picked.exact} : null;
}
/** Detached consumer. Caller injects the exact Core hash-verifying codec and
 * selected-world transport. Never substitutes current scenery for old unbound takes.
 * This does not activate lookup or alter mounted LiveWorld on its own. */
export class WorldSceneHistory {
  private cache=new Map<string,VerifiedSceneCapture>();
  private pending:AbortController|null=null;
  private generation=0;
  private closed=false;
  private worldId:string;
  private fetchCapture:(hash:string,signal:AbortSignal)=>Promise<unknown>;
  private decodeCapture:(raw:unknown)=>VerifiedSceneCapture;
  constructor(worldId:string,fetchCapture:(hash:string,signal:AbortSignal)=>Promise<unknown>,decodeCapture:(raw:unknown)=>VerifiedSceneCapture) {
    this.worldId=worldId;this.fetchCapture=fetchCapture;this.decodeCapture=decodeCapture;
  }
  get retained(){return this.cache.size;}
  cancel(){this.generation++;this.pending?.abort();this.pending=null;}
  dispose(){this.cancel();this.closed=true;this.cache.clear();}
  async resolve(reference:unknown):Promise<ResolvedScene>{
    this.cancel();const generation=this.generation;
    if(this.closed)return {status:'stale',reason:'Viewer scene lifetime ended.',info:null};
    if(reference===undefined)return {status:'unbound',reason:'This recording does not identify its scenery.',info:null};
    if(!validRef(reference))return {status:'unavailable',reason:'This recording has an invalid scenery reference.',info:null};
    const ref:RecordedSceneRef={contract:reference.contract,hash:reference.hash,rulesVersion:reference.rulesVersion},key=ref.rulesVersion+':'+ref.hash;
    const current=()=>!this.closed&&generation===this.generation;
    try{
      let capture=this.cache.get(key);
      if(capture){this.cache.delete(key);this.cache.set(key,capture);}
      else{
        const abort=new AbortController();this.pending=abort;
        const raw=await this.fetchCapture(ref.hash,abort.signal);
        if(!current())return {status:'stale',reason:'A newer scenery request replaced this one.',info:null};
        capture=this.decodeCapture(raw);
        if(capture.worldId!==this.worldId||capture.ref.hash!==ref.hash||capture.ref.rulesVersion!==ref.rulesVersion||capture.ref.contract!==ref.contract)
          throw Error('Scenery identity mismatch');
        this.cache.set(key,structuredClone(capture));
        while(this.cache.size>MAX_SCENE_HISTORY)this.cache.delete(this.cache.keys().next().value!);
      }
      return {status:'bound',ref,info:parseSceneInfo(structuredClone(capture.body)),
        publication:{worldId:capture.worldId,contract:'render-scene-capture/1',ref:structuredClone(capture.ref),body:structuredClone(capture.body)}};
    }catch{
      return current()?{status:'unavailable',reason:'The scenery for this recording could not be verified.',info:null}:
        {status:'stale',reason:'A newer scenery request replaced this one.',info:null};
    }finally{if(current())this.pending=null;}
  }
}
