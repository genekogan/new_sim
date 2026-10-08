import type {EdenExpansionLayout,Rect,XZ} from './landscape.mjs';
export function edenExpansionLayout():EdenExpansionLayout;
export function inside(x:number,z:number,b:Rect,margin?:number):boolean;
export function pathDistance(x:number,z:number,points:XZ[]):number;
export function inNative(x:number,z:number,margin?:number):boolean;
export function reserved(x:number,z:number,r?:number):boolean;
export function inWater(x:number,z:number):boolean;
export function waterBedReserved(x:number,z:number,margin?:number):boolean;
/** Cosmetic extension sampler only, never native ground support. */
export function expansionHeight(x:number,z:number):number|null;
