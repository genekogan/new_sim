// Bounded current self-location from canonical body/contact state. This is an
// observation, not a kernel move, ownership claim or traversal permission.
import {z} from 'zod';
import {boatPassengerV1Schema,boatTransitV1Schema} from './boat.ts';
import {shoreContactV1Schema} from './shore.ts';
const id=z.string().min(1).max(96),name=z.string().min(1).max(160),finite=z.number().finite();
export const bodyLocationV1Schema=z.object({
  contract:z.literal('body-location/1'),actorId:id,tick:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  physicalBase:z.object({campus:id,staticHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  root:z.tuple([finite,finite,finite]),
  region:z.object({id,name}).strict().nullable(),
  occupancy:z.object({container:z.object({id,name}).strict(),passenger:boatPassengerV1Schema,transfer:boatTransitV1Schema.nullable()}).strict().nullable(),
  shore:shoreContactV1Schema.nullable(),
}).strict().superRefine((v,ctx)=>{
  const p=v.occupancy;
  if(p&&(p.container.id!==p.passenger.boatId||(p.passenger.phase==='seated')!==(p.transfer===null)))
    ctx.addIssue({code:'custom',message:'Occupied container, passenger and actual transfer phase must agree'});
  if(p&&v.shore)ctx.addIssue({code:'custom',message:'A passenger frame cannot simultaneously claim a shore-body contact'});
});
export type BodyLocationV1=z.infer<typeof bodyLocationV1Schema>;
/** Human-readable actual placement. Never infer immersion from an XZ region. */
export function describeBodyLocation(v:BodyLocationV1):string{
  const region=v.region?.name??'outside a named physical region',p=v.occupancy;
  if(p)return (p.passenger.phase==='seated'?'aboard ':p.passenger.phase==='boarding'?'boarding ':'leaving ')+p.container.name+' in '+region;
  if(v.shore?.submergedHeightMetres)return (v.shore.mode==='buoyant'?'in the water at ':'wading at ')+region;
  return region;
}
