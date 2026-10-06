import type {IntentHistoryV2} from './intent-history.ts';
/** A new standing preference requests reconsideration; it does not reissue an
 * older NOW direction. The legacy selector remains available before the recorded
 * retained-choice policy. Historical fact decoding never uses this live selector. */
export function latestPurposeDirectionV1(history:IntentHistoryV2,owner:string,retainedChoice:boolean){
 const latest=Object.values(history.intents)
  .filter(e=>e.revision.source.ownerId===owner&&(retainedChoice||e.revision.interpretation.trigger.kind==='now'))
  .sort((a,b)=>b.revision.submitted.seq-a.revision.submitted.seq)[0];
 return latest?.revision.interpretation.trigger.kind==='now'?latest:undefined;
}
