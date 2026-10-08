import type {NativeShoreTerrainInput} from '../native-shore-terrain.ts';
import type {CapturedWaterInput,createCapturedWaterSurface} from '../captured-water-surface.ts';
type OriginalOwner=ReturnType<typeof createCapturedWaterSurface>;
export const EDEN_WATER_READABILITY:Readonly<{baseColor:string;frontAlpha:number;grazingAlpha:number;maximumAlpha:number;scope:string}>;
export function inspectEdenWaterReadability(terrain:unknown,water:unknown,enabled?:boolean):{original:unknown;recipe:typeof EDEN_WATER_READABILITY;drawCalls:number;triangles:number;extraGeometry:number;extraMaterials:number;textures:number;shaderChanged:boolean;nativeDatumChanged:boolean}|null;
export function createEdenReadableWater(terrain:NativeShoreTerrainInput,water:CapturedWaterInput,enabled?:boolean):(OriginalOwner&{inspection?:ReturnType<typeof inspectEdenWaterReadability>})|null;
export function waterBedContrastEstimate(bedHex:string,enabled?:boolean):{linearRGB:number[];sRGB:number[];alpha:number;scope:string};
