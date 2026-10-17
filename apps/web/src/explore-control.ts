import type {WorldViewerState} from './WorldViewer.ts';
/** V1: Explore first appears once the live view is ready, then stays mounted through a later loading or reconnect blip
 *  (a scene re-mount after a new welcome, a frame gap, an asset download). Unmounting it there closed an open Explore dialog
 *  and swallowed the click that had just opened it. History playback still hides it, and a pick made during a blip is
 *  answered by the dialog's own "unavailable right now" note. */
export function exploreAvailable(wasAvailable:boolean,state:Pick<WorldViewerState,'presentation'|'loading'|'unavailableReason'>|null):boolean{
 if(!state||state.presentation!=='live')return false;
 return wasAvailable||!state.loading&&!state.unavailableReason;
}
/** The result Enter picks: the first one shown (Souls are listed above locations); nothing for an empty search. */
export function firstExploreResult<S,L extends {id:string}>(query:string,souls:readonly S[],locations:readonly L[]):{kind:'soul';soul:S}|{kind:'place';id:string}|null{
 if(!query.trim())return null;
 return souls.length?{kind:'soul',soul:souls[0]!}:locations.length?{kind:'place',id:locations[0]!.id}:null;
}
