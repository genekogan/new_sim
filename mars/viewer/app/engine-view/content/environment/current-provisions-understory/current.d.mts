import type {LowPlant,ProtectedBounds} from '../../../social-render-types.ts';
import type {Group} from 'three';
export type CurrentUnderstoryInspection={plants:LowPlant[];omitted:{id:string;reasons:string[]}[];budget:Record<string,number>;protectedBounds:ProtectedBounds[];frame:{captureHash:string;takeHash:string;fromTick:number;toTick:number};[key:string]:unknown};
export type CurrentUnderstoryView={group:Group;readonly inspection:CurrentUnderstoryInspection;setTake(take:unknown):boolean;dispose():void};
export function inspectCurrentProvisionsUnderstory(publication:unknown,take:unknown,options?:{enabled:boolean}):CurrentUnderstoryInspection|null;
export function createCurrentProvisionsUnderstory(publication:unknown,take:unknown,options?:{enabled:boolean}):CurrentUnderstoryView|null;
export function inspectLiveKitchenUnderstory(publication:unknown,take:unknown,options?:{enabled:boolean}):CurrentUnderstoryInspection|null;
export function createLiveKitchenUnderstory(publication:unknown,take:unknown,options?:{enabled:boolean}):CurrentUnderstoryView|null;
export function inspectLiveFoodShoreUnderstory(publication:unknown,take:unknown,options?:{enabled:boolean}):CurrentUnderstoryInspection|null;
export function createLiveFoodShoreUnderstory(publication:unknown,take:unknown,options?:{enabled:boolean}):CurrentUnderstoryView|null;
export function inspectLiveSocialUnderstory(publication:unknown,take:unknown,options?:{enabled:boolean}):CurrentUnderstoryInspection|null;
export function createLiveSocialUnderstory(publication:unknown,take:unknown,options?:{enabled:boolean}):CurrentUnderstoryView|null;
export function inspectLiveFoodBUnderstory(publication:unknown,take:unknown,options?:{enabled:boolean}):CurrentUnderstoryInspection|null;
export function createLiveFoodBUnderstory(publication:unknown,take:unknown,options?:{enabled:boolean}):CurrentUnderstoryView|null;

export function currentUnderstoryPlacements():LowPlant[];
export function currentPlantBounds(plant:{p:readonly number[];size:readonly number[];yaw?:number}):{min:number[];max:number[]};
export function omissionForBounds(plant:{p:readonly number[];size:readonly number[];yaw?:number},bounds:readonly ProtectedBounds[]):string[];
