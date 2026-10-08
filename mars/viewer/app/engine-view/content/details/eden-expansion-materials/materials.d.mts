import type {MeshStandardMaterial, Side} from 'three';
export type EdenFinishRole = 'classroom-timber'|'classroom-stone'|'house-wall-ivory'|'house-wall-sand'|'house-wall-sage'|'garden-soil'|'path-gravel'|'forest-bark'|'canopy-leaf'|'orchard-leaf'|'meadow-green'|'bank-stone'|'wetland-soil'|'orchard-soil'|'bridge-timber'|'farm-timber'|'farm-wall'|'birch-palette-bark'|'birch-palette-leaf'|'bankstone-palette'|'arid-dust-palette'|'volcanic-ground-palette'|'volcanic-rock-palette'|'classroom-shell-timber'|'classroom-shell-plaster'|'classroom-shell-stone'|'original-platform-timber'|'meadow-authored-grass'|'birch-neutral-bark'|'birch-original-leaf'|'new-ground-neutral-grass';
export type FinishDefinition = Readonly<{color:string;roughness:number;metalness:0|.06;side?:Side;vertexColors?:boolean;flatShading?:boolean;projection?:'triplanar';gain?:number;recipe?:'timber'|'bark'|'soil'|'gravel'|'grass'}>;
export const EDEN_FINISHES: Readonly<Record<EdenFinishRole,FinishDefinition>>;
export type FinishDispose = Readonly<{closed:boolean;attempts:number;faults:readonly string[]}>;
export type FinishState = Readonly<{closed:boolean;maps:number;decodedBytes:number;estimatedMipBytes:number;ownMaterials:1;ownMeshes:0;ownGeometry:0;GPUQualified:false}>;
export type OwnedEdenFinish = Readonly<{quality:'Simple'|'RichPrepared';owned:true;owner:string;role:EdenFinishRole;material:MeshStandardMaterial;reason?:string;state():FinishState;dispose():FinishDispose}>;
export type SimpleFinishRefusal = Readonly<{quality:'Simple';owned:false;material:null;reason:string;dispose():FinishDispose}>;
/** New construction only; declarations do not certify actual source/lifetime or GPU conformance. */
export function createEdenFinish(input:unknown): OwnedEdenFinish|SimpleFinishRefusal;
