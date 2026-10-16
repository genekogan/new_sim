import type {WorldViewerHandle,WorldViewerState} from './WorldViewer.ts';
export type FeedbackMoment={residentId:string|null;placeId:string|null;camera:{position:[number,number,number];target?:[number,number,number];fov?:number}|null;tick:number|null;clientTime:string};
/** Explicit public allowlist. Never include location URLs, account metadata, journal or private conversation text. */
export function feedbackMoment(handle:WorldViewerHandle|null,state:WorldViewerState|null,now=new Date()):FeedbackMoment{
 const view=handle?.feedbackContext?.();
 const vector=(v:unknown):v is [number,number,number]=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n));
 const camera=view&&vector(view.camera.position)?{position:[...view.camera.position] as [number,number,number],...(vector(view.camera.target)?{target:[...view.camera.target] as [number,number,number]}:{}),...(Number.isFinite(view.camera.fov)?{fov:view.camera.fov}:{})}:null;
 return {residentId:state?.selection.soulId??null,placeId:view?.placeId??state?.room?.id??state?.selection.entityId??null,camera,tick:typeof state?.shownTick==='number'&&Number.isFinite(state.shownTick)&&state.shownTick>=0&&state.shownTick<=Number.MAX_SAFE_INTEGER?Math.floor(state.shownTick):null,clientTime:now.toISOString()};
}
export type AwayEvent={id:string|number;at:number;tick?:number;kind:string;text:string};
export type AwayReport={worldId:string;since:number|null;through:number;firstVisit:boolean;residents:{id:string;name:string;events:AwayEvent[];conversations:number;places:string[];incomplete:boolean}[];world:{owned:boolean;changes:AwayEvent[];incomplete:boolean};incomplete:boolean};
export function awayHasUpdates(report:AwayReport){return report.world.changes.length>0||report.residents.some(r=>r.events.length>0||r.conversations>0||r.places.length>0);}
