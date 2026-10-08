// Additive depiction of native appended sleeping areas; original eight stay separate.
import {inspectPublishedNewcomerResources,type PublishedNewcomerSelection} from './WorldPublishedNewcomerResources.ts';
import {inspectNewcomerRestMarkers,createNewcomerRestMarkers} from '../../../mars/viewer/app/engine-view/content/assets/provisional-commons-rest/markers.mjs';
export function createPublishedNewcomerMarkers(publication:unknown,take:unknown,expected:PublishedNewcomerSelection|undefined,{enabled=false}={}){
 if(!enabled)return null;
 const identity=expected?structuredClone(expected):undefined;
 const input=inspectPublishedNewcomerResources(publication,take,identity);if(!input)return null;
 let spec;try{spec=inspectNewcomerRestMarkers(input.metadata,input.allRestRegions,input.ground);}catch{return null;}
 const owner=createNewcomerRestMarkers(input.metadata,input.allRestRegions,input.ground);
 let closed=false,lastTake:unknown=null;owner.group.visible=false;
 return {group:owner.group,
  // Full identity/layout validation once per immutable stream chunk, never per draw.
  setTake(currentTake:unknown){
   if(closed)return false;if(currentTake===lastTake)return owner.group.visible;lastTake=currentTake;
   let currentSignature:string|undefined;
   try{const current=inspectPublishedNewcomerResources(publication,currentTake,identity);if(current)currentSignature=inspectNewcomerRestMarkers(current.metadata,current.allRestRegions,current.ground).sourceLayoutSignature;}catch{}
   owner.group.visible=currentSignature===spec.sourceLayoutSignature;return owner.group.visible;
  },
  dispose(){if(closed)return;closed=true;owner.group.visible=false;owner.dispose();}
 };
}
