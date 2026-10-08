import {singleLocalPreview} from './local-navigation.ts';
import {classroomWorldId} from './classroom-projection.ts';
/** Public build pins supplied by PM for the exact qualified stage/release worlds. */
export function edenReleaseWorlds(value:string|undefined):readonly string[]{
 if(!value?.trim())return [];
 const worlds=value.split(',').map(v=>v.trim());
 if(worlds.length>8||new Set(worlds).size!==worlds.length||worlds.some(v=>! /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(v)))throw new Error('Invalid qualified Eden release world IDs.');
 return worlds;
}
export function edenExperienceEnabled(hostname:string,path:string,configuredWorld:string,connectedWorld:string|undefined,releaseWorlds:readonly string[]):boolean{
 if(path!=='/w/eden'||!connectedWorld||configuredWorld!==connectedWorld)return false;
 return releaseWorlds.includes(connectedWorld)||(singleLocalPreview(hostname)&&connectedWorld===classroomWorldId);
}
