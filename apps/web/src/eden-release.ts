import {singleLocalPreview} from './local-navigation.ts';
import {classroomWorldId} from './classroom-projection.ts';
import {BASE} from './base-path.ts';
/** Public build pins supplied by PM for the exact qualified stage/release worlds. */
export function edenReleaseWorlds(value:string|undefined):readonly string[]{
 if(!value?.trim())return [];
 const worlds=value.split(',').map(v=>v.trim());
 if(worlds.length>8||new Set(worlds).size!==worlds.length||worlds.some(v=>! /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(v)))throw new Error('Invalid qualified Eden release world IDs.');
 return worlds;
}
/** `path` is this page's world path (world-path.ts worldPath), which carries the build's prefix: the operator's fork
 * /worlds/w/eden (lane FORKS) is the same Eden under the launcher's BASE, so it gets the same experience (lane FORKFIX). */
export function edenExperienceEnabled(hostname:string,path:string,configuredWorld:string,connectedWorld:string|undefined,releaseWorlds:readonly string[],base:string=BASE):boolean{
 if(path!==base+'/w/eden'||!connectedWorld||configuredWorld!==connectedWorld)return false;
 return releaseWorlds.includes(connectedWorld)||(singleLocalPreview(hostname)&&connectedWorld===classroomWorldId);
}
