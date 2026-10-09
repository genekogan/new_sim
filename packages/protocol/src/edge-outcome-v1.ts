import {z} from 'zod';
/** Optional edge1.1 terminal extension. Legacy edge1 receipts remain valid without it. */
export const EDGE_OUTCOME_CONTRACT='eden-edge/1.1' as const;
const id=z.string().min(1).max(1000),text=z.string().min(1).max(2000);
export const edgeLearnedV1Schema=z.strictObject({fact:text,about:id,source:id,provenance:z.enum(['authored-content','world-fact','soul-text']),untrusted:z.boolean()}).refine(v=>v.provenance!=='soul-text'||v.untrusted,'Soul text must remain untrusted');
export const edgeProducedV1Schema=z.strictObject({id,kind:id,title:z.string().min(1).max(200),where:z.string().max(200).nullable(),visibility:z.enum(['private','public','participants'])});
export const edgeOutcomeV1Schema=z.strictObject({contract:z.literal(EDGE_OUTCOME_CONTRACT),kind:z.string().min(1).max(100),summary:z.string().min(1).max(160),
 learned:z.array(edgeLearnedV1Schema).max(5),produced:z.array(edgeProducedV1Schema).max(32),changed:z.array(z.strictObject({id,kind:id,summary:text,source:id})).max(32),
 met:z.array(z.strictObject({soulId:id,name:z.string().min(1).max(200),placeId:z.string().max(200).nullable().optional()})).max(32),detail:z.record(z.string(),z.unknown()),untrusted:z.boolean()
}).refine(v=>!v.learned.some(f=>f.untrusted)||v.untrusted,'Untrusted learned text must label its outcome');
export type EdgeOutcomeV1=z.infer<typeof edgeOutcomeV1Schema>;
