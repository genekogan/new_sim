// Local proposal producer only. No engine/log/DB mutation or live scene route.
import { z } from 'zod';
import type { TerrainPatchV1, ScenePlacementCandidateV1 } from '@sim/engine-contract';

const id=z.string().min(1).max(96);
const coordinate=z.number().finite().min(-10000).max(10000);
const vec2=z.tuple([coordinate,coordinate]),vec3=z.tuple([coordinate,coordinate,coordinate]);
const size=z.number().finite().positive().max(20);
const pin=z.object({path:z.string().min(1).max(240).refine(p=>!p.startsWith('/')&&!p.split('/').includes('..')),
  commit:z.string().regex(/^[a-f0-9]{40}$/),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const ref=z.object({worldId:id,proposalId:id,revision:id,sourcePins:z.array(pin).min(1).max(8)}).strict();
export const terrainPatchV1Schema=z.object({
  id,originXZ:vec2,spacingMetres:z.number().finite().min(.001).max(10000),
  columns:z.number().int().min(2).max(129),rows:z.number().int().min(2).max(129),
  heightMetres:z.array(z.array(coordinate).min(2).max(129)).min(2).max(129),
  diagonal:z.literal('min-min/max-max'),
}).strict().superRefine((p,ctx)=>{
  if(p.heightMetres.length!==p.rows||p.heightMetres.some(row=>row.length!==p.columns))
    ctx.addIssue({code:'custom',message:'height grid dimensions must match'});
  if(Math.abs(p.originXZ[0]+p.spacingMetres*(p.columns-1))>10000||Math.abs(p.originXZ[1]+p.spacingMetres*(p.rows-1))>10000)
    ctx.addIssue({code:'custom',message:'terrain extent exceeds candidate coordinate bounds'});
});
export const vegetationPlacementV1Schema=z.object({id,kind:z.enum(['canopy-tree','conifer','shrub','grass','reeds','vine']),
  p:vec3,size:z.tuple([size,size,size]),yaw:z.number().finite().optional(),seed:z.number().int().min(0).max(0xffffffff).optional()}).strict();
const proposal=z.object({ref,terrain:terrainPatchV1Schema,placements:z.array(vegetationPlacementV1Schema).max(512)}).strict()
  .superRefine((p,ctx)=>{if(new Set(p.placements.map(x=>x.id)).size!==p.placements.length)
    ctx.addIssue({code:'custom',message:'placement IDs must be unique'});});

/** Deterministic triangle height/normal only; no collision, slope admission,
 * water/support ownership or extrapolation. Caller uses a validated patch. */
export function sampleCandidateTerrain(p:TerrainPatchV1,x:number,z:number) {
  if(!Number.isFinite(x)||!Number.isFinite(z))throw new TypeError('finite sample coordinates required');
  const u0=(x-p.originXZ[0])/p.spacingMetres,v0=(z-p.originXZ[1])/p.spacingMetres;
  if(u0<0||v0<0||u0>p.columns-1||v0>p.rows-1)return null;
  const i=Math.min(p.columns-2,Math.floor(u0)),j=Math.min(p.rows-2,Math.floor(v0)),u=u0-i,v=v0-j;
  const a=p.heightMetres[j][i],b=p.heightMetres[j][i+1],c=p.heightMetres[j+1][i],d=p.heightMetres[j+1][i+1];
  const dx=(v<=u?b-a:d-c)/p.spacingMetres,dz=(v<=u?d-b:c-a)/p.spacingMetres;
  const y=v<=u?a+(b-a)*u+(d-b)*v:a+(d-c)*u+(c-a)*v,length=Math.hypot(dx,1,dz);
  return {p:[x,y,z] as [number,number,number],normal:[-dx/length,1/length,-dz/length] as [number,number,number]};
}

/** Source pins are provenance declarations, not independently attested here.
 * Trusted installation and revision-to-tick publication remain separate. */
export function produceScenePlacementCandidate(raw:unknown):ScenePlacementCandidateV1 {
  const p=proposal.parse(raw);
  return {contract:'scene-placement-candidate/1',stage:'proposal-checked',...p,
    roots:p.placements.map(plant=>{
      const root=sampleCandidateTerrain(p.terrain,plant.p[0],plant.p[2]);
      if(!root)return {id:plant.id,status:'requires-support',code:'outside-terrain'};
      const deltaY=plant.p[1]-root.p[1];
      if(Math.abs(deltaY)>.001)return {id:plant.id,status:'requires-support',code:'root-height-mismatch',deltaY};
      return {id:plant.id,status:'terrain-aligned',terrainId:p.terrain.id,...root};
    }),unresolved:['obstruction-policy','canonical-installation']};
}
