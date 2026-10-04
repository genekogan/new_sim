// Bounded public projection of a registered native shore. This is recorded
// render metadata, not authority to install a proposed landscape or move a body.
import { z } from 'zod';
import { sha256 } from './hash.ts';
import { terrainPatchV1Schema } from './terrain.ts';
import { waterGeometryV1Schema } from './water-geometry.ts';
import { nativeBoatLayoutV1Schema } from './boat.ts';
export const SHORE_APPEARANCE_SOURCE_V1=Object.freeze({
  commit:'fd27a26096bc445d07483525c487f2906e6a9325',
  path:'worlds/eden/assets/fixtures/shore-dock-proposal.v1.json',
  sha256:'ad33cee15e66b56e7b1de01de573807e4091faf0cbeae1a9d1eca28f8d97f754',bytes:12596,
} as const);
/** Exact reviewed UTF-8 source is embedded once per addressed capture. A
 * consumer needs no mutable filename fetch or Core/World filesystem access. */
export const shoreAppearanceSourceV1Schema=z.object({contract:z.literal('shore-appearance-source/1'),
  source:z.object({commit:z.literal(SHORE_APPEARANCE_SOURCE_V1.commit),path:z.literal(SHORE_APPEARANCE_SOURCE_V1.path),
    sha256:z.literal(SHORE_APPEARANCE_SOURCE_V1.sha256),bytes:z.literal(SHORE_APPEARANCE_SOURCE_V1.bytes)}).strict(),
  utf8:z.string().max(16384),
}).strict().superRefine((v,ctx)=>{
  if(new TextEncoder().encode(v.utf8).length!==v.source.bytes||sha256(v.utf8)!==v.source.sha256)
    ctx.addIssue({code:'custom',message:'shore appearance source bytes or SHA256 differs'});
});
const number=z.number().finite().min(-10000).max(10000);
export const nativeShoreSceneV1Schema=z.object({contract:z.literal('native-shore-scene/1'),
  rulesVersion:z.string().min(1).max(200),
  physicalBase:z.object({campus:z.string().min(1).max(200),staticHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  terrain:terrainPatchV1Schema,
  water:z.object({id:z.string().min(1).max(96),datumY:number,wetBoundsXZ:z.tuple([number,number,number,number])}).strict(),
  boat:z.object({layout:nativeBoatLayoutV1Schema,appearance:shoreAppearanceSourceV1Schema}).strict().optional(),
}).strict().superRefine((v,ctx)=>{
  const no=(message:string)=>ctx.addIssue({code:'custom',message});
  if(!waterGeometryV1Schema.safeParse({...v.water,terrain:v.terrain}).success)no('captured water differs from bounded terrain');
  if(v.boat){
    // Byte identity above fixes the original public design. Only native layout
    // and actual recorded transforms govern contacts/occupancy/movement.
    try{const design=JSON.parse(v.boat.appearance.utf8),l=v.boat.layout;
      if(design.boat.id!==l.boatId||design.dock.id!==l.dockId)no('captured boat/dock source identities differ');
    }catch{no('captured appearance JSON is unavailable');}
  }
});
export type NativeShoreSceneV1=z.infer<typeof nativeShoreSceneV1Schema>;
export type ShoreAppearanceSourceV1=z.infer<typeof shoreAppearanceSourceV1Schema>;
/** Resolved exact authored JSON for appearance only. No numeric layout repair,
 * inventory, placement, pilot or occupant authority is derived from this. */
export function decodeShoreAppearanceSourceV1(raw:unknown):Record<string,unknown>{
  const source=shoreAppearanceSourceV1Schema.parse(raw);return JSON.parse(source.utf8);
}
