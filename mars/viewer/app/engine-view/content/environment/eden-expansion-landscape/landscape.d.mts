import type {Group} from 'three';
export type XZ=[number,number];
export type XYZ=[number,number,number];
export type Rect=[number,number,number,number];
export interface EdenExpansionLayout {
 version:string;bounds:Rect;
 preserved:Array<{id:string;bounds:Rect}>;
 places:Array<{id:string;bounds:Rect;entrance:XZ;presenter?:XZ;nativeRequired:string}>;
 regions:Array<{id:string;bounds:Rect;style:string}>;
 paths:Array<{id:string;width:number;points:XZ[];dryBankAppearance?:boolean}>;
 stops:Array<{id:string;p:XZ;radius:number}>;
 water:Array<{id:string;kind:string;p:XYZ;yaw:number;wetEllipse?:XZ;wetBounds?:Rect;outerBounds:Rect}>;
 scope:string;
}
export interface EdenExpansionLandscape {
 group:Group;layout:EdenExpansionLayout;
 planting:{plants:Array<{id:string;kind:string;p:XYZ;size:XYZ;yaw:number;seed:number}>;special:Record<string,Array<{id:string;p:XYZ;size:XYZ;yaw:number}>>;omitted:string[];scope:string};
 bankEnrichment?:{candidateCount:number;preflightAccepted:number;kept:unknown[];omitted:string[];fullGeometryRefused:string[];minBaseRelativeY:number|null;maxBaseRelativeY:number|null;calls:number;triangles:number;textures:0;scope:string};
 waterFringe:{reedClumps:number;broadleafClumps:number};
 sampleVisibleBank(x:number,z:number):number|null;
 waterJoin:{removedBankFaces:number[];waterTriangles:number;scope:string};
 costs:{calls:number;triangles:number;oneSunCalls:number;oneSunTriangles:number;textures:0};
 /** NEW cosmetic ground only; native/unknown/disposed -> null. */
 sampleVisualGround(x:number,z:number):number|null;
 dispose():void;
}
/** One connected visual expansion around original native commons and shoreline.
 * Explicit true only; new floors/paths/water remain proposals until Core admission.
 */
export function createEdenExpansionLandscape(enabled?:boolean):EdenExpansionLandscape|null;
