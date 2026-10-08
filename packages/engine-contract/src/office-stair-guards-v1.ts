import {z} from 'zod';
import {officeStairGuardBoxes,OFFICE_STAIR_GUARD_VERSION} from '../../../mars/viewer/lib/office-stair-guards.ts';
const coordinate=z.number().min(-10000).max(10000),v3=z.tuple([coordinate,coordinate,coordinate]);
export const officeStairGuardBoxV1Schema=z.strictObject({id:z.string().min(1).max(120),buildingId:z.literal('eden-office-1'),floorY:coordinate,min:v3,max:v3}).refine(b=>b.min.every((v,i)=>v<b.max[i])&&b.min[1]===b.floorY);
export const officeStairGuardsDeclarationV1Schema=z.strictObject({version:z.literal(OFFICE_STAIR_GUARD_VERSION),guards:z.array(officeStairGuardBoxV1Schema).length(6)}).refine(v=>JSON.stringify(v.guards)===JSON.stringify(officeStairGuardBoxes()),'Office guard revision requires the exact six authored bands');
export const officeStairGuardsV1Schema=z.strictObject({version:z.literal(OFFICE_STAIR_GUARD_VERSION),acceptedAtTick:z.number().int().nonnegative(),guards:z.array(officeStairGuardBoxV1Schema).length(6)}).refine(v=>officeStairGuardsDeclarationV1Schema.safeParse({version:v.version,guards:v.guards}).success);
export type OfficeStairGuardsV1=z.infer<typeof officeStairGuardsV1Schema>;
export type OfficeStairGuardsDeclarationV1=z.infer<typeof officeStairGuardsDeclarationV1Schema>;
