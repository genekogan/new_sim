// Renderer consumer only; Core's exact reviewed schema owns wire validation.
// This module neither defines a second wire nor places resources.
import {decodeSceneCapturePublication} from '../../../packages/protocol/src/scene-capture.ts';
import {recordedTakeSchema} from '../../../packages/protocol/src/presentation.ts';
import {replayFinalState} from '../../../mars/viewer/engine/take/replay.ts';
import type {Take} from '../../../mars/viewer/engine/take/types.ts';
import {parseSceneInfo} from './WorldGeometry.ts';
import {newcomerResourcesPublicV1Schema} from '../../../packages/engine-contract/src/newcomer-resources.ts';
export type PublishedNewcomerSelection={worldId:string;sceneHash:string;rulesVersion:string;schemaSHA:string};
export const NEWCOMER_SCHEMA_SHA='78a0081c96909c02b5a3efddb43eb2ff531d43e0b083ed79a5d9b3f469d5c8ac';
const REFS=['af844c67609fe1ec47e7febe11f95e8f3553b3eac847717b53faa4eac177ccec','3e1a4dbc4275d24b12a4b45a0c7a0eb1ae2f20eb66fff2f130c6bc632fc3e75e'] as const;
const RULES='sim-mars/1+retained-shore/1+mars-engine/1+mars-assembly/3+activities/31+bodies/1+crew-removal/1+commons/1+arrival-clearance/1+walk-block/1+cp/2+commons-kitchen/2+social-eden/1';
/** Explicitly reviewed archived producer; current Root f5 is not this scene. */
export function publishedNewcomerSelection(worldId:string,ref:unknown):PublishedNewcomerSelection|undefined{
 const r=ref as {hash?:unknown;rulesVersion?:unknown}|null;
 const hash=REFS.find(h=>h===r?.hash);
 return worldId==='eden-local-lifecycle'&&hash&&r?.rulesVersion===RULES?{worldId,sceneHash:hash,rulesVersion:RULES,schemaSHA:NEWCOMER_SCHEMA_SHA}:undefined;
}
/** No renderer allocation. Unknown source/schema/current scene returns null. */
export function inspectPublishedNewcomerResources(publication:unknown,take:unknown,expected:PublishedNewcomerSelection|undefined){
 if(!expected||expected.worldId!=='eden-local-lifecycle'||!REFS.some(hash=>hash===expected.sceneHash)||expected.rulesVersion!==RULES||expected.schemaSHA!==NEWCOMER_SCHEMA_SHA)return null;
 try{
  const capture=decodeSceneCapturePublication(publication),parsed=recordedTakeSchema.parse(take);
  if(parsed.schema!=='mars-take/4')return null;
  // Current supplier is /4. The paint inspector validates every native region
  // before allocation; earlier take schemas are outside this selected input.
  const recording=parsed as unknown as Take&{renderSceneRef?:{contract:unknown;hash:unknown;rulesVersion:unknown}};
  if(capture.worldId!==expected.worldId||capture.ref.hash!==expected.sceneHash||capture.ref.rulesVersion!==expected.rulesVersion||recording.rulesVersion!==expected.rulesVersion||recording.renderSceneRef?.contract!==capture.ref.contract||recording.renderSceneRef.hash!==capture.ref.hash||recording.renderSceneRef.rulesVersion!==capture.ref.rulesVersion)return null;
  replayFinalState(recording);
  const body=capture.body as {scene?:{newcomerProvisions?:unknown}};
  const metadata=newcomerResourcesPublicV1Schema.parse(body.scene?.newcomerProvisions),info=parseSceneInfo(capture.body),surface=info.scene?.surfaces.find(s=>s.id==='commons-ground');
  if(!surface)return null;
  // Regions remain authoritative: the paint owner must verify their actual polygons.
  const regions=metadata.resources.map(r=>recording.finalState.regions[r.mat]);
  const baseRegions=Array.from({length:8},(_,i)=>recording.finalState.regions['commons-mat-'+(i+1)]);
  if([...baseRegions,...regions].some(r=>!r))return null;
  return {metadata,regions,allRestRegions:[...baseRegions,...regions],ground:{id:surface.id,level:surface.level,y:surface.y,obb:structuredClone(surface.obb)},ref:structuredClone(capture.ref),worldId:capture.worldId,recording,scope:'Archived actual newcomer producer only; no current live cohort, support or admission authority'};
 }catch{return null;}
}
