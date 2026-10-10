import type {Group} from 'three';
export interface EdenOutlookOwner {
 group:Group;
 readonly inspection:{worldSeed:number;recordedSeconds:number|null;timeMode:string;grove:{p:number[];yaw:number;scale:number[]};treeAccentReserve:number[];existingLookoutReserve:number[];scope:string;sky:unknown};
 costs:{calls:number;triangles:number;oneSunCalls:number;oneSunTriangles:number;textures:0};
 /** Recorded-time phase only, null restores fixed seed ornament; invalid hides clouds. */
 setViewTime(seconds:unknown):boolean;
 dispose():void;
}
export function inspectEdenOutlookAppearance(input:unknown,enabled?:boolean):EdenOutlookOwner['inspection']|null;
export function createEdenOutlookAtmosphere(input:unknown,enabled?:boolean,ornamentalClouds?:boolean):EdenOutlookOwner|null;
