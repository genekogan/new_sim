import type {Group} from 'three';
export type PublishedRestSelection={worldId:string;sceneHash:string;rulesVersion:string;sourceSHA:string;regionKind:'place'|'work-area'};
export type PublishedRestMarkerView={group:Group;setTake(take:unknown):boolean;dispose():void};
export function createPublishedRestMarkers(publication:unknown,take:unknown,selection:PublishedRestSelection|undefined,options?:{enabled?:boolean}):PublishedRestMarkerView|null;
