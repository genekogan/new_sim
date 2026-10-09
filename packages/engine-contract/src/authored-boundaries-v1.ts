import {z} from 'zod';
import {hashOf} from './hash.ts';
const coordinate=z.number().min(-10000).max(10000),v3=z.tuple([coordinate,coordinate,coordinate]);
export const AUTHORED_BOUNDARIES_VERSION='authored-boundaries/1';
/** New authored objects collide by default. Decoration requires an explicit
 * source declaration; absence of a camera mesh/name never opens native walls. */
export const authoredBoundaryBoxV1Schema=z.strictObject({id:z.string().min(1).max(200),buildingId:z.string().min(1).max(150),kind:z.enum(['wall','guard']).default('wall'),c:v3,half:z.tuple([z.number().positive().max(1000),z.number().positive().max(1000),z.number().positive().max(1000)]),yaw:z.number().min(-Math.PI).max(Math.PI),collision:z.enum(['solid','decorative']).default('solid')});
const fields={version:z.literal(AUTHORED_BOUNDARIES_VERSION),sourceRevision:z.string().min(1).max(160),sourceHash:z.string().regex(/^[a-f0-9]{64}$/),boxes:z.array(authoredBoundaryBoxV1Schema).max(4096)};
const pinned=(v:{sourceRevision:string;sourceHash:string;boxes:unknown[]})=>v.sourceHash===hashOf({sourceRevision:v.sourceRevision,boxes:v.boxes})&&new Set(v.boxes.map(b=>(b as {id:string}).id)).size===v.boxes.length;
export const authoredBoundariesDeclarationV1Schema=z.strictObject(fields).refine(pinned,'Exact unique source-pinned authored prisms required');
export const authoredBoundariesV1Schema=z.strictObject({...fields,acceptedAtTick:z.number().int().nonnegative()}).refine(pinned,'Exact unique source-pinned authored prisms required');
export type AuthoredBoundariesDeclarationV1=z.infer<typeof authoredBoundariesDeclarationV1Schema>;
export type AuthoredBoundariesV1=z.infer<typeof authoredBoundariesV1Schema>;
/** Normalize the source once; consumers do not independently infer geometry. */
export function authoredBoundaryDeclarationV1(sourceRevision:string,raw:unknown[]):AuthoredBoundariesDeclarationV1{
 const boxes=raw.map(b=>authoredBoundaryBoxV1Schema.parse(b)).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 return authoredBoundariesDeclarationV1Schema.parse({version:AUTHORED_BOUNDARIES_VERSION,sourceRevision,sourceHash:hashOf({sourceRevision,boxes}),boxes});
}
/** Capture-prefix decoder shared by camera and backend qualification. It never
 * falls back to current authored registrations when a past fact is absent. */
export function authoredBoundaryBoxesAtPublicationV1(value:unknown,tick?:number){
 const fact=(value as {body?:{scene?:{authoredBoundaries?:unknown}}}|null)?.body?.scene?.authoredBoundaries,parsed=authoredBoundariesV1Schema.safeParse(fact);
 if(!parsed.success||tick!==undefined&&(!Number.isFinite(tick)||tick<parsed.data.acceptedAtTick))return [];
 return parsed.data.boxes.filter(b=>b.collision==='solid');
}
