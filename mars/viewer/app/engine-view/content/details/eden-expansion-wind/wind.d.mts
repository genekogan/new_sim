import type {InstancedMesh} from 'three';
export const EXPANSION_WIND_SOURCE:Readonly<{landscape:string;planting:string;vegetation:string}>;
export const WIND_ENVELOPE:Readonly<{localX:.03;localZ:.02;localY:0;maximumRadius:number;scope:string}>;
export function crownSway(displayedSeconds:number,seed:number,reducedMotion?:boolean):readonly[number,number,number]|null;
export type ExpansionWindSimple=Readonly<{quality:'Simple';reason:string;mesh:null}>;
export type ExpansionWindOwner=Readonly<{quality:'PreparedExpansionCrownWind';mesh:InstancedMesh;envelope:typeof WIND_ENVELOPE;cost:Readonly<{instanceBytes:number;baselineCopyBytes:number;maps:0;ownGeometry:0;ownMaterial:0;extraDraws:0;extraDrawCondition:string;GPUQualified:false}>;update(displayedSeconds:number,reducedMotion?:boolean):boolean;dispose():Readonly<{closed:boolean;faults:readonly string[]}>;snapshot():Readonly<{closed:boolean;lastSeconds:number|null;selected:number;sourceCount:number;identity:string;faults:readonly string[];GPUQualified:false}>}>;
export function prepareExpansionCrownWind(input:unknown):ExpansionWindSimple|ExpansionWindOwner;
