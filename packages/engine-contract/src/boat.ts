// Optional W-002 native boat truth. This describes recorded state, not consent,
// ownership or permission derived from a seat. Pilot authority is independent.
import { z } from 'zod';
const id=z.string().min(1).max(96);
const availability=z.object({available:z.boolean(),reason:z.object({code:z.string().min(1).max(96),message:z.string().min(1).max(280)}).strict().nullable()}).strict().superRefine((v,ctx)=>{
  if(v.available!==(v.reason===null))ctx.addIssue({code:'custom',message:'Availability needs an actual refusal or no refusal'});
});
/** A local current physical observation, never an acquired grant or a write. */
export const nativeBoatControlsV1Schema=z.object({contract:z.literal('native-boat-controls/1'),actorId:id,boatId:id,
  tick:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),physicalBase:z.object({campus:id,staticHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  phase:z.enum(['docked','underway','stopped']),holder:id.nullable(),take:availability,release:availability,
}).strict();
export type NativeBoatControlsV1=z.infer<typeof nativeBoatControlsV1Schema>;
const vec=z.tuple([z.number(),z.number(),z.number()]);
export const boatStateV1Schema=z.object({
  contract:z.literal('boat-state/1'),waterId:id,frameOffsetY:z.number(),
  dockId:id.nullable(),connectorOpen:z.boolean(),
  phase:z.enum(['docked','underway','stopped']),speed:z.number().min(0),
  passengers:z.record(id,id),pilotIds:z.array(id),
}).strict().superRefine((s,ctx)=>{
  if(new Set(Object.values(s.passengers)).size!==Object.keys(s.passengers).length)
    ctx.addIssue({code:'custom',message:'one body cannot occupy multiple passenger slots'});
  if(new Set(s.pilotIds).size!==s.pilotIds.length)
    ctx.addIssue({code:'custom',message:'pilot capabilities must be unique'});
  if(s.phase==='docked'?(s.dockId===null||!s.connectorOpen||s.speed!==0):(s.dockId!==null||s.connectorOpen||s.phase==='stopped'&&s.speed!==0))
    ctx.addIssue({code:'custom',message:'phase, stopped dock and connector must agree'});
});
export const boatPassengerV1Schema=z.object({
  boatId:id,slotId:id,phase:z.enum(['boarding','seated','leaving']),
  localRoot:vec,relativeYaw:z.number(),
}).strict();
export const boatTransitV1Schema=z.object({
  from:vec,to:vec,t:z.number().min(0).max(1),supportId:id,
}).strict();
const corridor=z.object({from:vec,to:vec,width:z.number().positive()}).strict();
const seat=z.object({root:vec,yaw:z.number()}).strict();
export const nativeBoatLayoutV1Schema=z.object({
  contract:z.literal('native-boat-layout/1'),boatId:id,dockId:id,
  nativeFrame:z.literal('base-centred-keel'),authoredFrameOffset:vec,
  boatDockPosition:vec,bank:vec,
  dock:z.object({position:vec,size:z.tuple([z.number().positive(),z.number().positive(),z.number().positive()]),topY:z.number()}).strict(),
  ramp:corridor,deckEntry:vec,connector:corridor,
  seats:z.object({seat0:seat,seat1:seat}).strict(),
}).strict();
export type BoatStateV1=z.infer<typeof boatStateV1Schema>;
export type BoatPassengerV1=z.infer<typeof boatPassengerV1Schema>;
export type BoatTransitV1=z.infer<typeof boatTransitV1Schema>;
export type NativeBoatLayoutV1=z.infer<typeof nativeBoatLayoutV1Schema>;
