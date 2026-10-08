import type {Group} from 'three';
export interface EdenRoofGardenInspection {
 beds:Array<{id:string;p:[number,number,number];soilRectangle:[number,number,number,number]}>;
 scope:string;
}
export function inspectEdenRoofGarden(plan:unknown,enabled?:boolean):EdenRoofGardenInspection|null;
export function createEdenRoofGarden(plan:unknown,verifiedSelectedBed:(id:string,p:[number,number,number],rect:[number,number,number,number])=>boolean,enabled?:boolean):{group:Group;inspection:EdenRoofGardenInspection;dispose():void}|null;
