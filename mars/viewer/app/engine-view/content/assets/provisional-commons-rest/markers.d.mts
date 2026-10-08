/** Types for inspected renderer-local geometry; no Core/publication schema declaration. */
import type {Group} from 'three';
type V3=readonly[number,number,number];
export type RestMarkerRegion=Readonly<{id:string;kind:'place'|'work-area';level:0;polygon:readonly(readonly[number,number])[];label?:string;provenance?:unknown}>;
export type RestMarkerGround=Readonly<{id:'commons-ground';level:0;y:0;obb:Readonly<{c:readonly[0,0];half:readonly[30,30];yaw:0}>}>;
export type RestMarkerCell=Readonly<{regionId:string;rect:readonly[number,number,number,number];colour:string}>;
export type RestMarkerMaterial=Readonly<{vertexColors:true;roughness:.94;polygonOffset:true;polygonOffsetFactor:-1;polygonOffsetUnits:-1}>;
export type RestMarkerInspection<L>=Readonly<{status:string;layout:L;cells:readonly RestMarkerCell[];planeY:0;sourceLayoutSignature:string;bounds:Readonly<{min:V3;max:V3}>;triangles:number;mainCalls:1;nativeSupportChanged:false;bodyRootChanged:false;material:RestMarkerMaterial;limits:string}>;
export type CommonsRestMarkerLayout=Readonly<{contract:'commons-ground-rest-marker-layout/1';source:Readonly<{regionKind:'place'|'work-area';stage:'uncommitted-proposal'|'published';sha256:string}>;ground:RestMarkerGround;regions:readonly RestMarkerRegion[]}>;
export type NewcomerRestMarkerLayout=Readonly<{metadata:unknown;ground:RestMarkerGround;regions:readonly RestMarkerRegion[];originalRegionIds:readonly string[]}>;
export type RestMarkerOwner=Readonly<{group:Group;dispose():void}>;
export function commonsRestLayoutSignature(regions:unknown,ground:unknown,source:unknown):string;
export function inspectCommonsRestMarkers(regions:unknown,ground:unknown,signature:unknown):RestMarkerInspection<CommonsRestMarkerLayout>;
export function createCommonsRestMarkers(regions:unknown,ground:unknown,signature:unknown):RestMarkerOwner;
export function inspectNewcomerRestMarkers(metadata:unknown,originalRegions:unknown,exactGround:unknown):RestMarkerInspection<NewcomerRestMarkerLayout>;
export function createNewcomerRestMarkers(metadata:unknown,originalRegions:unknown,exactGround:unknown):RestMarkerOwner;
