// Optional private read adapter over accepted soul-intent/2 facts.
import { z } from 'zod';
import { INTENT_V2,intentHistoryEventV2Schema } from './intent-v2.ts';
export const INTENT_HISTORY_V1='private-intent-history/1' as const;
export const INTENT_HISTORY_PAGE_LIMIT=50,INTENT_HISTORY_SCAN_LIMIT=200,INTENT_HISTORY_CURSOR_TTL_MS=30*60*1000;
const id=z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),uint=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const intentHistoryCursorV1Schema=z.string().regex(/^ih1_[a-f0-9]{48}$/);
export const intentHistoryQueryV1Schema=z.strictObject({cursor:intentHistoryCursorV1Schema.optional()});
export const intentHistoryCapabilityV1Schema=z.strictObject({contract:z.literal(INTENT_HISTORY_V1),worldId:id,soulId:id,
  pageLimit:z.literal(INTENT_HISTORY_PAGE_LIMIT),scanLimit:z.literal(INTENT_HISTORY_SCAN_LIMIT),cursorTtlMs:z.literal(INTENT_HISTORY_CURSOR_TTL_MS)});
export type IntentHistoryCapabilityV1=z.infer<typeof intentHistoryCapabilityV1Schema>;
const scope={contract:z.literal(INTENT_HISTORY_V1),intentContract:z.literal(INTENT_V2),worldId:id,soulId:id,ownerId:id,
  frontier:z.strictObject({seq:uint,tick:uint}),fromSeq:uint};
export const intentHistoryPageV1Schema=z.discriminatedUnion('state',[
  z.strictObject({...scope,state:z.literal('page'),throughSeq:uint,events:z.array(intentHistoryEventV2Schema).max(INTENT_HISTORY_PAGE_LIMIT),
    nextCursor:intentHistoryCursorV1Schema.nullable(),resumeCursor:intentHistoryCursorV1Schema.nullable(),
    visibility:z.literal('current-owner'),complete:z.boolean()}),
  z.strictObject({...scope,state:z.literal('gap'),reason:z.enum(['prefix-missing','source-changed']),expectedSeq:uint}),
]).superRefine((p,ctx)=>{
  if(p.fromSeq>p.frontier.seq)ctx.addIssue({code:'custom',message:'history range exceeds its frontier'});
  if(p.state==='page'){
    if(p.throughSeq<p.fromSeq||p.throughSeq>p.frontier.seq)ctx.addIssue({code:'custom',message:'history range differs'});
    let previous=p.fromSeq;
    for(const e of p.events){if(e.worldId!==p.worldId||e.soulId!==p.soulId||e.seq<=previous||e.seq>p.throughSeq||e.tick>p.frontier.tick)ctx.addIssue({code:'custom',message:'private event scope/order differs'});previous=e.seq;}
    if(p.complete!==(p.throughSeq===p.frontier.seq)||p.complete!==(p.nextCursor===null)||p.complete!==(p.resumeCursor!==null))ctx.addIssue({code:'custom',message:'history continuation differs'});
  }
});
export type IntentHistoryPageV1=z.infer<typeof intentHistoryPageV1Schema>;
