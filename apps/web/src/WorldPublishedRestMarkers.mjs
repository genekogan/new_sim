// Optional depiction of selected published native provisions. No physical mutation.
import {decodeSceneCapturePublication} from '../../../packages/protocol/src/scene-capture.ts';
import {recordedTakeSchema} from '../../../packages/protocol/src/presentation.ts';
import {replayFinalState} from '../../../mars/viewer/engine/take/replay.ts';
import {parseSceneInfo} from './WorldGeometry.ts';
import {commonsRestLayoutSignature,createCommonsRestMarkers} from '../../../mars/viewer/app/engine-view/content/assets/provisional-commons-rest/markers.mjs';
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function selected(publication,take,expected){
 const supportedSuffixes=['+commons-provisions/1+ss/1','+commons-provisions/1','+commons-provisions/1+commons-kitchen/1','+commons-provisions/1+commons-kitchen/2','+cp/2+commons-kitchen/2'];
 const supportedTail=['','+fd/1','+social-eden/1','+fd/1+social-eden/1','+social-eden/1+fd/1'];
 if(!expected||!digest(expected.sourceSHA)||!digest(expected.sceneHash)||typeof expected.worldId!=='string'||typeof expected.rulesVersion!=='string'||!supportedSuffixes.some(suffix=>supportedTail.some(tail=>expected.rulesVersion.endsWith(suffix+tail)))||!['place','work-area'].includes(expected.regionKind))throw Error('Exact published provisions selection required');
 const capture=decodeSceneCapturePublication(publication),recording=recordedTakeSchema.parse(take);
 if(capture.worldId!==expected.worldId||capture.ref.hash!==expected.sceneHash||capture.ref.rulesVersion!==expected.rulesVersion||recording.rulesVersion!==expected.rulesVersion||recording.renderSceneRef?.contract!==capture.ref.contract||recording.renderSceneRef?.hash!==capture.ref.hash||recording.renderSceneRef?.rulesVersion!==capture.ref.rulesVersion)throw Error('Native recording/publication selection mismatch');
 replayFinalState(recording);
 const info=parseSceneInfo(capture.body),surface=info.scene?.surfaces.find(s=>s.id==='commons-ground');
 const ground=surface?{id:surface.id,level:surface.level,y:surface.y,obb:structuredClone(surface.obb)}:null;
 const regions=Array.from({length:8},(_,i)=>recording.finalState.regions['commons-mat-'+(i+1)]);
 const source={stage:'published',sha256:expected.sourceSHA,regionKind:expected.regionKind};
 return {regions,ground,signature:commonsRestLayoutSignature(regions,ground,source)};
}
/** Default off; unknown/old/foreign recordings retain original ground. The caller
 * supplies a source identity from World's reviewed Core handoff, never a UI claim. */
export function createPublishedRestMarkers(publication,take,expected,{enabled=false}={}){
 if(!enabled)return null;
 let input,identity;try{identity=structuredClone(expected);input=selected(publication,take,identity);}catch{return null;}
 const owner=createCommonsRestMarkers(input.regions,input.ground,input.signature);let closed=false,lastTake=null;owner.group.visible=false;
 return {group:owner.group,
  // Validate once on each immutable stream-chunk change, not on animation frames.
  setTake(currentTake){if(closed)return false;if(currentTake===lastTake)return owner.group.visible;lastTake=currentTake;let current;try{current=selected(publication,currentTake,identity);}catch{owner.group.visible=false;return false;}owner.group.visible=current.signature===input.signature;return owner.group.visible;},
  dispose(){if(closed)return;closed=true;owner.group.visible=false;owner.dispose();}
 };
}
