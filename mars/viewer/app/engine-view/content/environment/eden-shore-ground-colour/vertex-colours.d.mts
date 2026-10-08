import type {NativeShoreTerrainInput} from '../native-shore-terrain.ts';
import type {CapturedWaterInput} from '../captured-water-surface.ts';
export const EDEN_SHORE_GROUND_COLOURS:Readonly<{deepBed:string;wetFringe:string;shoreSand:string;dryShoulder:string;deepBelowDatum:number;fringeBelowDatum:number;sandAboveDatum:number;shoulderAboveDatum:number}>;
export interface EdenShoreVertexColours {colours:Float32Array;zones:string[];vertices:number;colorAttributeBytes:number;coordinateDomainXZ:number[];nativeDatumY:number;recipe:typeof EDEN_SHORE_GROUND_COLOURS;extraDraws:number;extraGeometry:number;extraMaterials:number;textures:number;scope:string;}
/** Caller must first run existing exact inspectConnectedNativeShore. No new wire/source admission. */
export function buildEdenShoreVertexColours(terrain:NativeShoreTerrainInput,water:CapturedWaterInput,enabled?:boolean):EdenShoreVertexColours|null;
