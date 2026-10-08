// Presentation phase anchor, not canonical odometry or locomotion truth.
import type {Take} from '../../engine/take/types.ts';
import {walkTotals} from './take-walk.ts';
type Chunk={fromTick:number;toTick:number;take:Take};
type Offsets=Record<string,number>;
const key=(t:Take)=>JSON.stringify([t.id,t.startTick,t.ticks,t.baselineStateHash,t.finalStateHash,t.rulesVersion,t.dt]);
const adjacent=(a:Chunk,b:Chunk)=>a.toTick===b.fromTick&&a.take.startTick+a.take.ticks===b.take.startTick&&a.take.finalStateHash===b.take.baselineStateHash&&a.take.rulesVersion===b.take.rulesVersion&&a.take.dt===b.take.dt;
const carries=(a:Take,b:Take,id:string)=>a.finalState.entities[id]?.kind==='human'&&b.tracks[id]?.[0]?.[0]===0&&(b.entities0?.[id]??b.finalState.entities[id])?.kind==='human';
/** Keeps a bounded, world/epoch-local visual phase origin. New history extending
 * before that origin can have signed phase distance; this is never total journey
 * distance. Only exact adjacent public state-hash chains carry it across seams.
 * Unknown gaps/lifetimes start an independent origin, with no guessed travel. */
export class RecordedGaitContinuity {
 private cache=new Map<string,Offsets>();
 offsets(chunks:readonly Chunk[],target:Chunk):Offsets{
  const index=chunks.indexOf(target);if(index<0)return{};
  let lo=index,hi=index;while(lo>0&&adjacent(chunks[lo-1],chunks[lo]))lo--;while(hi+1<chunks.length&&adjacent(chunks[hi],chunks[hi+1]))hi++;
  let anchor=lo;for(let i=lo;i<=hi;i++)if(this.cache.has(key(chunks[i].take))){anchor=i;break;}
  const offsets:Offsets[]=[];offsets[anchor]={...this.cache.get(key(chunks[anchor].take))};
  for(let i=anchor-1;i>=lo;i--){const a=chunks[i].take,b=chunks[i+1].take,total=walkTotals(a),out:Offsets={};for(const id of Object.keys(total))out[id]=carries(a,b,id)?(offsets[i+1][id]??0)-total[id]:this.cache.get(key(a))?.[id]??0;offsets[i]=out;}
  for(let i=anchor+1;i<=hi;i++){const a=chunks[i-1].take,b=chunks[i].take,total=walkTotals(a),out:Offsets={};for(const id of Object.keys(walkTotals(b)))out[id]=carries(a,b,id)?(offsets[i-1][id]??0)+(total[id]??0):0;offsets[i]=out;}
  for(let i=lo;i<=hi;i++){const k=key(chunks[i].take);this.cache.delete(k);this.cache.set(k,{...offsets[i]});}
  while(this.cache.size>256)this.cache.delete(this.cache.keys().next().value!);
  return{...offsets[index]};
 }
}
