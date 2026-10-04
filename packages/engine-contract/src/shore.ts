// W-002 additive recorded contact. The native shore fixture uses a prescribed
// upright capsule; immersion is a length, never a body-volume percentage.
import { z } from 'zod';
const finite=z.number().finite();
const id=z.string().min(1).max(96);
export const shoreContactV1Schema=z.object({
  contract:z.literal('shore-contact/1'),terrainId:id,waterId:id,
  mode:z.enum(['bed','buoyant']),bedY:finite,datumY:finite,
  depthMetres:finite.min(0),submergedHeightMetres:finite.min(0).max(1.8),
  normal:z.tuple([finite,finite,finite]),
}).strict().superRefine((p,ctx)=>{
  const n=Math.sqrt(p.normal.reduce((sum,v)=>sum+v*v,0));
  if(Math.abs(n-1)>1e-8||p.normal[1]<=0)ctx.addIssue({code:'custom',message:'bed normal must be upward and unit length'});
});
export type ShoreContactV1=z.infer<typeof shoreContactV1Schema>;
