import {z} from 'zod';
const id=z.string().min(1).max(100),point=z.tuple([z.number().finite(),z.number().finite()]),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const socialEdenLayoutV1Schema=z.strictObject({version:z.literal('social-eden/1'),units:z.literal('metres/Y-up/XZ/base-centred/native-yaw'),
 source:z.strictObject({worldRevision:id,proposalSHA256:digest,selected:z.literal('A')}),
 fixtures:z.array(z.strictObject({id,def:z.enum(['campfire','bench-6ft','camp-chair','table-6ft']),label:id,position:z.tuple([z.number().finite(),z.literal(0),z.number().finite()]),yaw:z.number().finite(),regionId:id})).length(12),
 regions:z.array(z.strictObject({id,label:id,polygon:z.array(point).min(3).max(32),focalXZ:point})).length(2),
 paths:z.array(z.strictObject({id,pointsXZ:z.array(point).min(2).max(32),width:z.number().finite().positive().max(10),terminalRegion:id.optional()})).max(32),
 activities:z.strictObject({fireRing:z.string(),fireSeats:z.string(),diningSeats:z.string(),meals:z.string()}),preservation:z.string(),
}).superRefine((p,ctx)=>{const ids=[...p.fixtures.map(v=>v.id),...p.regions.map(v=>v.id),...p.paths.map(v=>v.id)];if(new Set(ids).size!==ids.length)ctx.addIssue({code:'custom',message:'social IDs must be unique'});const regions=new Set(p.regions.map(v=>v.id));if(p.fixtures.some(v=>!regions.has(v.regionId)))ctx.addIssue({code:'custom',message:'fixture has unknown region'});});
export type SocialEdenLayoutV1=z.infer<typeof socialEdenLayoutV1Schema>;
export const socialEdenTransitionV1Schema=z.strictObject({contract:z.literal('social-eden/1'),tick:z.number().int().nonnegative(),fromRulesVersion:z.string().min(1).max(200),toRulesVersion:z.string().min(1).max(200),fromStateHash:digest,additionsHash:digest,layoutHash:digest,base:z.strictObject({campus:id,staticHash:digest})});
export type SocialEdenTransitionV1=z.infer<typeof socialEdenTransitionV1Schema>;
