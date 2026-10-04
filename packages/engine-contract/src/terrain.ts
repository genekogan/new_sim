import { z } from 'zod';

const coordinate=z.number().finite().min(-10000).max(10000);
export const terrainPointV1Schema=z.object({atXZ:z.tuple([coordinate,coordinate])}).strict();
export type TerrainPointGeometryV1={
  contract:'terrain-point-geometry/1';stage:'geometry-only';terrainId:string;
  request:z.infer<typeof terrainPointV1Schema>;
  geometryStatus:'covered'|'outside-terrain';
  point:[number,number,number]|null;normal:[number,number,number]|null;grade:number|null;
};
export const terrainPatchV1Schema=z.object({
  id:z.string().min(1).max(96),originXZ:z.tuple([coordinate,coordinate]),
  spacingMetres:z.number().finite().min(.001).max(10000),
  columns:z.number().int().min(2).max(129),rows:z.number().int().min(2).max(129),
  heightMetres:z.array(z.array(coordinate).min(2).max(129)).min(2).max(129),
  diagonal:z.literal('min-min/max-max'),
}).strict().superRefine((p,ctx)=>{
  if(p.heightMetres.length!==p.rows||p.heightMetres.some(row=>row.length!==p.columns))
    ctx.addIssue({code:'custom',message:'height grid dimensions must match'});
  if(Math.abs(p.originXZ[0]+p.spacingMetres*(p.columns-1))>10000||Math.abs(p.originXZ[1]+p.spacingMetres*(p.rows-1))>10000)
    ctx.addIssue({code:'custom',message:'terrain extent exceeds candidate coordinate bounds'});
});

/** A supplied disc/grade constraint for a geometry probe, not admitted anatomy
 * or live policy. Grade is rise/run of the whole triangle, not travel direction. */
export const terrainSweepV1Schema=z.object({
  fromXZ:z.tuple([coordinate,coordinate]),toXZ:z.tuple([coordinate,coordinate]),
  radiusMetres:z.number().finite().min(.0001).max(10),
  maxGrade:z.number().finite().min(0).max(10),
}).strict();
export type TerrainSweepV1=z.infer<typeof terrainSweepV1Schema>;
export type TerrainTriangleV1={column:number;row:number;half:'lower'|'upper'};
export type TerrainSpanV1={
  fromT:number;toT:number;triangle:TerrainTriangleV1;
  from:[number,number,number];to:[number,number,number];
  normal:[number,number,number];grade:number;lengthMetres:number;
};
export type TerrainSweepGeometryV1={
  contract:'terrain-sweep-geometry/1';stage:'geometry-only';terrainId:string;
  request:TerrainSweepV1;
  /** Clear/blocked refers ONLY to bounded terrain coverage and supplied grade. */
  geometryStatus:'clear'|'blocked';
  reason?:'outside-terrain'|'slope-exceeded';
  maxEncounteredGrade:number|null;checkedTriangles:number;
  limitingTriangle?:TerrainTriangleV1;
  centreline:TerrainSpanV1[];lengthMetres:number;
  unresolved:['obstacles','water','stacked-supports','dynamic-bodies','canonical-installation'];
};

/** Axis-aligned proposed enclosure bottom only. Does not claim load-bearing
 * support, soil volume, slope flattening or a foundation repair. */
export const terrainFootingV1Schema=z.object({
  centreXZ:z.tuple([coordinate,coordinate]),
  halfXZ:z.tuple([z.number().finite().min(.0001).max(100),z.number().finite().min(.0001).max(100)]),
  bottomY:coordinate,
}).strict();
export type TerrainFootingGeometryV1={
  contract:'terrain-footing-geometry/1';stage:'geometry-only';terrainId:string;
  request:z.infer<typeof terrainFootingV1Schema>;
  geometryStatus:'covered'|'outside-terrain';checkedTriangles:number;
  /** Signed bottom-minus-terrain range over the whole rectangle. Positive is
   * a gap, negative is terrain intersection; neither proves foundation safety. */
  gapRangeMetres:[number,number]|null;
  terrainHeightRangeMetres:[number,number]|null;
  unresolved:['foundation-policy','loads','materials','canonical-installation'];
};
