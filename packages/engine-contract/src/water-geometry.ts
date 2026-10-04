// W-002 proposal mathematics only: calm datum, rectangular closed wet domain
// and the already declared single-layer bed. No swim/boat/contact admission.
import { z } from 'zod';
import { terrainPatchV1Schema } from './terrain.ts';
const coordinate=z.number().finite().min(-10000).max(10000);
const positive=z.number().finite().min(.0001).max(100);
export const waterGeometryV1Schema=z.object({
  id:z.string().min(1).max(96),terrain:terrainPatchV1Schema,datumY:coordinate,
  wetBoundsXZ:z.tuple([coordinate,coordinate,coordinate,coordinate]),
}).strict().superRefine((p,ctx)=>{
  const [x0,z0,x1,z1]=p.wetBoundsXZ,[tx,tz]=p.terrain.originXZ;
  if(x0>=x1||z0>=z1||x0<tx||z0<tz
    ||x1>tx+(p.terrain.columns-1)*p.terrain.spacingMetres
    ||z1>tz+(p.terrain.rows-1)*p.terrain.spacingMetres)
    ctx.addIssue({code:'custom',message:'wet rectangle must be nonempty and within declared terrain'});
});
export const waterColumnV1Schema=z.object({atXZ:z.tuple([coordinate,coordinate]),
  verticalSpan:z.tuple([coordinate,coordinate]).optional(),
}).strict().superRefine((p,ctx)=>{
  if(p.verticalSpan && p.verticalSpan[0]>=p.verticalSpan[1])ctx.addIssue({code:'custom',message:'vertical span must have positive height'});
});
export const waterClearanceV1Schema=z.object({centreXZ:z.tuple([coordinate,coordinate]),
  halfXZ:z.tuple([positive,positive]),draftMetres:positive,
  underKeelMarginMetres:z.number().finite().min(0).max(100),
}).strict();
export type WaterColumnGeometryV1={
  contract:'water-column-geometry/1';stage:'geometry-only';waterId:string;terrainId:string;
  request:z.infer<typeof waterColumnV1Schema>;geometryStatus:'wet'|'dry'|'outside-terrain';
  bedY:number|null;datumY:number;depthMetres:number|null;
  /** Intersection LENGTH of the supplied vertical segment with bed..datum,
   * not a 3D body-volume fraction, anatomical state or swimming capability. */
  submergedSpanMetres:number|null;submergedSpanFraction:number|null;
  unresolved:['body-anatomy','physical-support','water-physics','canonical-installation'];
};
export type WaterClearanceGeometryV1={
  contract:'water-clearance-geometry/1';stage:'geometry-only';waterId:string;terrainId:string;
  request:z.infer<typeof waterClearanceV1Schema>;
  geometryStatus:'sufficient-depth'|'insufficient-depth'|'outside-water-domain';
  checkedTriangles:number;depthRangeMetres:[number,number]|null;
  signedKeelClearanceRangeMetres:[number,number]|null;
  unresolved:['yawed-hull','swept-route','obstacles','hydrostatics','passengers','canonical-installation'];
};
