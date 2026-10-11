import {historyTakePath,historyTakePage} from './WorldTakeTransport.ts';
import {WorldAuthoredBoundaries} from './WorldAuthoredBoundaries.ts';
import {exploreRoom} from './explore-data.ts';
import {RendererDiagnostics} from './RendererDiagnostics.ts';
import {AssetDownloads,type AssetDownloadProgress} from './AssetDownloads.ts';
import {WorldPlacePreviews} from './WorldPlacePreviews.ts';
import {constrainOfficeGuardCamera,officeGuardsFromPublication} from './WorldOfficeGuards.ts';
import {recordedBody,admittedBodyUrl} from '../../../mars/viewer/app/engine-view/recorded-body.ts';
import {WorldBodyModels} from './WorldBodyModels.ts';
import {conversationFrame} from './WorldConversationFrame.ts';
import {WorldEyes} from './WorldEyes.ts';
import {WorldHover,type HoverTarget} from './WorldHover.ts';
import {EDEN_VIEWER_PLACES} from './WorldEdenPlaceData.ts';
import {WorldSoulAvatars} from './SoulAvatars.ts';
import {edenExpansionCapture} from './WorldEdenActivation.ts';
import {worldPlaceView,type WorldPlaceId} from './WorldPlaces.ts';
import {createWorldEdenExpansion} from './WorldEdenExpansion.ts';
import type {LocalClassroomPresentation} from './WorldClassroomPresentation.ts';
import {WorldFollow} from './WorldFollow.ts';
import {worldCameraRenderRoots} from './WorldCameraRenderRoots.ts';
import {WorldOrbitPivot} from './WorldOrbitPivot.ts';import {WorldRtsCamera} from './WorldRtsCamera.ts';import {FramePacer} from './frame-pacing.ts';
import {createWorldAtmosphere} from './WorldAtmosphere.ts';
import {SpectatorSpeechLayer,speechFromTalk,speechFromEdge,channelChip,type SpectatorSpeech,type EdgeSpectatorMessage} from './WorldSpectatorSpeech.ts';
import {WorldFadingLayer,parseFadeOverride,fadingFromEdge,beamedOut,type FadingState} from './WorldFading.ts';
import {renderEyes,renderOverhead,renderMap} from './WorldSnapshots.ts';
import {conversationAttention,WorldIdleLife,type IdleSoul} from './WorldIdleLife.ts';
import {WorldBalloonRide,parseRideOverride,previewState} from './WorldBalloonRide.ts';
import {WorldShadowDetail} from './WorldShadowDetail.ts';
import {WorldPlaceActivity} from './WorldPlaceActivity.ts';
import {installNightLighting,setNightLightStrength,nightLightStrength} from './WorldNightLights.ts';
import {createEdenHouseWindows} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/eden-house-windows.ts';
// Patch shared lit-shader chunks before any program compiles (strength stays 0 outside Eden).
installNightLighting();
import {connectionLost} from './viewer-arrival.ts';import {activityWords,doingText} from './place-names.ts';
import {WorldNativeSocialDraw} from './WorldNativeSocialDraw.ts';
import {worldDepictionBeat,type WorldBeatSampler} from './WorldDepiction.ts';
import {RecordedGaitContinuity} from '../../../mars/viewer/app/engine-view/recorded-gait-continuity.ts';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { TakePeople } from '../../../mars/viewer/app/engine-view/take-replay.ts';
import { loadTemplates } from '../../../mars/viewer/app/engine-view/people.ts';
import { FloaterView, KinScenery } from '../../../mars/viewer/app/engine-view/floaters.ts';
import { floaterBody } from '../../../mars/viewer/engine/bodies/index.ts';
import { ThreeResources } from '../../../mars/viewer/lib/three-resources.ts';
import type { Take } from '../../../mars/viewer/engine/take/types.ts';
import type { SampledEntity } from '../../../mars/viewer/engine/take/replay.ts';
import type { Entity } from '../../../mars/viewer/engine/world/types.ts';
import type { PlayView, PublicSoul } from '@sim/protocol';
import type { Sim } from './useSim.ts';
import { decodeSceneCapturePublication } from '@sim/protocol/scene-capture';
import { WorldSceneHistory } from './WorldSceneHistory.ts';
import { apiPath, worldKey } from './world-path.ts';
import { WorldEntityLayer } from './WorldEntityLayer.ts';
import { entityArrivalPose } from './entity-arrival.ts';
import { setAssetLoader } from './gen-mesh/gltf-assets.ts';
import { GodPanel } from './GodPanel.tsx';
import { ensureToken as ensureGodToken } from './god-ui/god-api.ts';
import { WorldPreviewGhost } from './WorldPreviewGhost.ts';
import {WorldEdgeItems} from './WorldEdgeItems.ts';
import { WorldNavigation, createWorldOrbitControls, type ManualNavigation, type CameraMove } from './WorldNavigation.ts';
import {WorldPlaceCamera} from './WorldPlaceCamera.ts';
import { composeVisibleViewport, visibleViewport, type ViewportInsets } from './WorldViewport.ts';
import { placeWorldLabels, type LabelBox, type LabelOffset } from './WorldLabels.ts';
import {projectSpeechAnchors,type SpeechAnchorPoint} from './WorldSpeechAnchors.ts';
import {paintSpeakingDot} from './dialogue-speaking.ts';
import {WorldGames} from './WorldGames.ts';
import {parsePlatformFloors,type PlatformFloor} from '../../../mars/viewer/lib/platform-floor.ts';
import {WorldPlatforms} from './WorldPlatforms.ts';
import {cameraGround,cameraGroundSampler} from './WorldCameraGround.ts';
import {WorldRenderedVisibility} from './WorldRenderedVisibility.ts';
import {WorldFollowMotion} from './WorldFollowMotion.ts';
import { WorldBroadcast, type WorldCameraMode } from './WorldBroadcast.ts';
import {createPublishedRestMarkers} from './WorldPublishedRestMarkers.mjs';
import {publishedRestSelection} from './WorldRestSourceSelection.ts';
import {createPublishedNewcomerMarkers} from './WorldPublishedNewcomerMarkers.ts';
import {publishedNewcomerSelection} from './WorldPublishedNewcomerResources.ts';
import {createCurrentSocialDressingOwner} from '../../../mars/viewer/app/engine-view/content/environment/current-social-dressing/dressing.ts';
import {createNativeSocialPaths} from '../../../mars/viewer/app/engine-view/content/environment/native-social-paths/paths.ts';
import {createCurrentProvisionsUnderstory,inspectCurrentProvisionsUnderstory,createLiveKitchenUnderstory,inspectLiveKitchenUnderstory,createLiveFoodShoreUnderstory,inspectLiveFoodShoreUnderstory,createLiveSocialUnderstory,inspectLiveSocialUnderstory,createLiveFoodBUnderstory,inspectLiveFoodBUnderstory} from '../../../mars/viewer/app/engine-view/content/environment/current-provisions-understory/current.mjs';
import { cameraModeAfterGesture, createWorldViewerHandle, viewerPresentation, type WorldViewerHandle, type WorldViewerState } from './WorldViewer.ts';
import {
  agoText, chunkAt, clockText, Daylight, mergeWindow, MAX_PAST_CHUNKS, parseSceneInfo, placeOf, plainWords, rewindWindow, recordingTick, shiftIso, validChunks, WorldGeometry,
  type Chunk, type LiveTakes,
} from './WorldGeometry.ts';

// The shared live view: the world's recorded motion, streamed over the socket as short chunks and
// replayed a moment behind the server, over the camp's real ground, walls and doors. No engine runs here.

/** useSim's `takes` (the socket stream of recorded chunks); read loosely until every world sends it. */
const takesOf = (sim: Sim) => (sim as Sim & { takes?: LiveTakes | null }).takes ?? null;
const dtOf = (sim: Sim) => sim.conn.welcome?.dt ?? 0.05;
/** Server ticks per real second right now (0 while the world is paused). */
const tpsOf = (sim: Sim) => (sim.conn.heartbeat?.paused ? 0 : (sim.conn.heartbeat?.clockRate ?? sim.conn.welcome?.clockRate ?? 1)) / dtOf(sim);
/** Best estimate of the server's tick now, from the last chunk message. */
function serverNow(sim: Sim): number | null {
  const t = takesOf(sim);
  if (!t || typeof t.serverTick !== 'number') return null;
  return t.serverTick + Math.min(2, Math.max(0, (performance.now() - t.receivedAt) / 1000)) * tpsOf(sim);
}
/** Live playback sits this many ticks behind the server, so the next chunk has arrived before it is needed. */
const LIVE_DELAY = 30;
const HOUR_SECONDS = 3600;

type Past = { tick: number; playing: boolean; chunks: Chunk[]; extending: boolean; retryAt: number; ended: boolean };
/** What is on screen, for the panels (written by the frame loop, read on React renders). */
type Shown = { tick: number; datetime: string | null; take: Take | null; entities: Record<string, SampledEntity> };
type Label = { obj: CSS2DObject; name: HTMLElement; line: HTMLElement; card: HTMLElement; leader: HTMLElement; offset: LabelOffset; text: string };

async function fetchChunks(from: number, to: number, limit: number, signal: AbortSignal): Promise<Chunk[]> {
  let out: Chunk[] = [], cursor = from;
  for (let page = 0; page < 4 && out.length < limit; page++) {
    const res = await fetch(apiPath(historyTakePath(cursor,to,limit-out.length)), { signal });
    if (!res.ok) throw Error(`the server answered ${res.status}`);
    const body = historyTakePage(await res.json());
    out = validChunks([...out, ...body.chunks]).slice(0, limit);
    const next = typeof body.next === 'number' ? body.next : null;
    if (next === null || next <= cursor || (out.at(-1)?.toTick ?? -Infinity) >= to) break;
    cursor = next;
  }
  return out;
}

/** The latest card each Soul played at or before `tick`. */
function cardsAt(plays: readonly PlayView[], tick: number): Map<string, PlayView> {
  const out = new Map<string, PlayView>();
  for (const p of plays) if (p.ok && p.tick <= tick && (out.get(p.soulId)?.tick ?? -1) <= p.tick) out.set(p.soulId, p);
  return out;
}
const cardText = (p: PlayView | undefined) => (p ? `“${p.card}”${p.targetName ? ` → ${p.targetName}` : ''}` : '');
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function LiveWorld({ sim, selected, onSelect, onViewerHandle, onViewerState, hideControls = false, embedded = false, hideSoulInfo = false, publishSpeechAnchors = false, humanPresets = false, viewportInsets, depictionBeatAt, edenExpansion = false, localClassroomPresentation }: {
  sim: Sim; selected: string | null; onSelect(id: string | null): void;
  onViewerHandle?(handle: WorldViewerHandle | null): void;
  onViewerState?(state: WorldViewerState): void;
  hideControls?: boolean;
  /** App sizes the stable world-viewer/world-viewport elements. */
  embedded?: boolean;
  /** Hide only the duplicate Soul card, retaining object inspection and notes. */
  hideSoulInfo?: boolean;
  /** App requests public speech anchors; default off avoids extra visibility queries. */
  publishSpeechAnchors?: boolean;
  /** Optional verified palettes; preserves each existing model and Soul key. */
  humanPresets?:boolean;
  viewportInsets?: ViewportInsets;
  /** Opt-in Core-derived phase at this exact body take/tick; App owns live/history sourcing. */
  depictionBeatAt?: WorldBeatSampler;
  /** Optional current-world composition; new scenery has no native authority. */
  edenExpansion?:boolean;
  localClassroomPresentation?:LocalClassroomPresentation;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const [cameraMode, setCameraMode] = useState<WorldCameraMode>('broadcast');
  const [manualNavigation,setManualNavigation] = useState<ManualNavigation>('orbit');
  const follow = cameraMode === 'follow';
  const [thing, setThing] = useState<string | null>(null);
  const [mode, setMode] = useState<'live' | 'past'>('live');
  const [, refreshPlayback] = useState(0);
  const [draft, setDraft] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [assetProgress,setAssetProgress]=useState<AssetDownloadProgress>({loaded:0,total:0,failed:0,pending:0});
  const [placeCard,setPlaceCard]=useState<HoverTarget|null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [graphicsUnavailable, setGraphicsUnavailable] = useState<string | null>(null);
  const [sceneryNotice,setSceneryNotice]=useState<string|null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [flagMode, setFlagMode] = useState(false); const flagModeRef = useRef(false); flagModeRef.current = flagMode;
  const [entityWorld, setEntityWorld] = useState(false);
  /** Entity worlds: the person's camera across scene re-mounts of this page (framed once, on first arrival). */
  const entityView = useRef<{eye:[number,number,number];target:[number,number,number]}|null>(null);
  const context = useRef({ sim, selected, onSelect, follow, cameraMode, setCameraMode, thing, setThing, onViewerState, loading, graphicsUnavailable, viewportInsets, manualNavigation, setManualNavigation, depictionBeatAt, publishSpeechAnchors, edenExpansion, localClassroomPresentation });
  context.current = { sim, selected, onSelect, follow, cameraMode, setCameraMode, thing, setThing, onViewerState, loading, graphicsUnavailable, viewportInsets, manualNavigation, setManualNavigation, depictionBeatAt, publishSpeechAnchors, edenExpansion, localClassroomPresentation };
  const past = useRef<Past | null>(null);
  const shown = useRef<Shown>({ tick: 0, datetime: null, take: null, entities: {} });
  const drawnTick = useRef<number | null>(null);
  const stateSignature = useRef('');
  const latestViewerState=useRef<WorldViewerState|null>(null);
  const emitState = (state: WorldViewerState) => {
    latestViewerState.current=state;
    const signature = JSON.stringify(state);
    if (signature === stateSignature.current || !context.current.onViewerState) return;
    stateSignature.current = signature; context.current.onViewerState(state);
  };
  const seeking = useRef<AbortController | null>(null);
  const controlsApi = useRef<{ overview(): void; frameSouls(ids:readonly string[]):boolean; framePoint(point:THREE.Vector3,radius:number):void; framePlace(place:WorldPlaceId): boolean; placePreview(place:WorldPlaceId):Promise<string|null>; focusSelected(): boolean; reset(): boolean; releaseInput(): void; move(delta: CameraMove): boolean; inputOwned(): boolean } | null>(null);
  const playbackCommands = useRef<{ seek(tick: number): Promise<void>; live(): void; setPlaying(playing: boolean): boolean } | null>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // a Soul picked elsewhere (the table, my Soul) replaces a picked thing
  useEffect(() => { if (selected) setThing(null); }, [selected]);

  useEffect(() => {
    if (!mount.current) return;
    // Recorded ticks and scene assets belong to one world/epoch. A restarted
    // connection must not keep a paused take or let its pending seek refill it.
    seeking.current?.abort(); seeking.current = null;
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = null;
    past.current = null;
    shown.current = { tick: 0, datetime: null, take: null, entities: {} };
    drawnTick.current = null;
    latestViewerState.current = null; stateSignature.current = '';
    setMode('live'); setDraft(null); setNote(null); setLoading(false);
    setThing(null); setProblems([]); setGraphicsUnavailable(null);setSceneryNotice(null);
    const host = mount.current, abort = new AbortController(), resources = new ThreeResources();
    const problem = (text: string) => setProblems((p) => (p.includes(text) ? p : [...p, text]));
    let navigation: WorldNavigation | null=null;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch {
      setGraphicsUnavailable('This browser could not start 3D graphics.');
      problem('This browser could not start 3D graphics, so the world view is unavailable here.');
      return () => abort.abort();
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute('aria-label', 'Live 3D view of the world');
    renderer.domElement.style.display = 'block';
    host.appendChild(renderer.domElement);
    const onContextLost = (e: Event) => { e.preventDefault(); setGraphicsUnavailable('The 3D graphics context was lost.'); navigation?.release(); problem('The 3D view lost its graphics context; it will come back when the browser restores it.'); };
    const onContextRestored = () => setGraphicsUnavailable(null);
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);
    const speechVisibility=new WorldRenderedVisibility();
    const labels2d = new CSS2DRenderer();
    // zIndex 1 contains CSS2DRenderer's per-label depth z-indices, so speech bubbles (z 3) read above name tags.
    Object.assign(labels2d.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none', zIndex: '1' });
    host.appendChild(labels2d.domElement);

    const scene = new THREE.Scene();
    // Far plane covers the whole ±900 m terrain from anywhere in Eden: a nearer far plane slices the distant
    // ranges and the slice moves with the camera (ridges seemed to rise and recede). Depth precision is set by near.
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2400);
    let down: { x: number; y: number } | null = null;
    const newControls = (target?: THREE.Vector3) => createWorldOrbitControls(camera,renderer.domElement,target,{
      mode:context.current.cameraMode,navigation:context.current.manualNavigation,lifecycle:'',
    });
    let controls=newControls();
    navigation=new WorldNavigation(renderer.domElement,camera,()=>controls.target,()=>({
      mode:context.current.cameraMode,navigation:context.current.manualNavigation,
      lifecycle:JSON.stringify([context.current.sim.conn.welcome?.worldId,context.current.sim.conn.welcome?.epoch,context.current.selected,context.current.thing,!!past.current,(() => {const c=context.current,id=c.selected?c.sim.conn.replica.souls.get(c.selected)?.entityId:c.thing;return id?id.startsWith('kin:')?!!kin.view.object(id):!!shown.current.entities[id]:null;})()]),
    }),()=>{
      down=null;if(abort.signal.aborted)return;
      const target=controls.target.clone();controls.dispose();controls=newControls(target);
    },owned=>{if(latestViewerState.current)emitState({...latestViewerState.current,inputOwned:owned});});
    const orbitPivot=new WorldOrbitPivot();scene.add(orbitPivot.group);
    const rts=new WorldRtsCamera(renderer.domElement,camera,{controls:()=>controls,mode:()=>context.current.cameraMode,takeOver:()=>{context.current.manualNavigation='orbit';context.current.cameraMode='manual';context.current.follow=false;if(!navigation?.sync(true))navigation?.release(false);context.current.setManualNavigation('orbit');context.current.setCameraMode('manual');},scene:()=>scene,pickRoots:()=>[floaters.root,kin.view.root,standIns,...(people?.pickingRoots()??[]),...visualObstructionRoots()],focusAt:(x,y)=>{const target=hover.pick(x,y);if(target){inspectHover(target);return {center:target.point,radius:target.radius};}return null;},enabled:()=>!(context.current.cameraMode==='manual'&&context.current.manualNavigation==='free')});scene.add(rts.marker);  // VF2: your camera (keys, pivot, double-click)
    const speechLayer=new SpectatorSpeechLayer();scene.add(speechLayer.group);let speeches:SpectatorSpeech[]=[];const speechHead=new THREE.Vector3();
    // W3 fading visuals: Core C9 state when it ships; meanwhile a ?fade= preview override.
    // W2/W5 preview: ?snapshots=1 exposes on-demand low-res JPEG eyes/overhead/map frames (steward queue C10 will call these).
    if(new URLSearchParams(location.search).has('snapshots')){const soulAt=(name:string)=>{const c=context.current,soul=[...c.sim.conn.replica.souls.values()].find(x=>x.name.toLowerCase()===name.toLowerCase()),p=soul?shown.current.entities[soul.entityId]:null;return soul&&p?{soul,p:p.p,yaw:p.yaw??0}:null;};
      (window as unknown as Record<string,unknown>).edenSnapshots={
        map:()=>renderMap(renderer,scene,{souls:[...context.current.sim.conn.replica.souls.values()].flatMap(soul=>{const p=shown.current.entities[soul.entityId]?.p;return p?[{name:soul.name,x:p[0],z:p[2]}]:[];})}),
        eyes:(name:string)=>{const a=soulAt(name);return a?renderEyes(renderer,scene,{position:[a.p[0],a.p[1]+1.6,a.p[2]],yaw:a.yaw}):null;},
        overhead:(name:string)=>{const a=soulAt(name);return a?renderOverhead(renderer,scene,[a.p[0],a.p[1],a.p[2]]):null;}};}
    const portraits=new WorldSoulAvatars(renderer);
    const idleLife=new WorldIdleLife();const idleSouls:IdleSoul[]=[];let attentionTargets=new Map<string,readonly string[]>();
    const edgeItems=new WorldEdgeItems(apiPath('/v1/edge/items'));scene.add(edgeItems.group);edgeItems.start(abort.signal);  // things lying around (together/1)
    const entityLayer=new WorldEntityLayer(apiPath);scene.add(entityLayer.group);let entityWorldFramed=false;
    // Entity worlds have no Souls to broadcast at first: frame what the god built (or ?eye=x,y,z&at=x,y,z for stable shots),
    // once, on first arrival (after the snapshot loads; never from the render loop), at a human distance (entity-arrival.ts).
    const frameEntityWorld=()=>{if(!entityLayer.active||entityWorldFramed)return;entityWorldFramed=true;const q=new URLSearchParams(location.search),eye=q.get('eye')?.split(',').map(Number),at=q.get('at')?.split(',').map(Number);
      if(eye?.length===3&&at?.length===3&&eye.every(Number.isFinite)&&at.every(Number.isFinite)){controls.target.set(at[0],at[1],at[2]);camera.position.set(eye[0],eye[1],eye[2]);}
      else if(entityView.current){controls.target.fromArray(entityView.current.target);camera.position.fromArray(entityView.current.eye);}  // a re-mount (welcome, reconnect) keeps the person's camera
      else{const w=host.clientWidth,visible=w>=800?(w-392)/w:1;  // the god panel (.gp-card: 380 px + 12 px margin) docks on the right on wide screens
        const pose=entityArrivalPose(entityLayer.viewBounds(),entityLayer.entityCount,entityLayer.groundAt,camera.fov,camera.aspect,visible);controls.target.fromArray(pose.target);camera.position.fromArray(pose.eye);}
      camera.lookAt(controls.target);context.current.setCameraMode('manual');};
    // ?shot=1: a clean picture for `god look` (canvas over every overlay, camera from eye/at, title 'ready' once drawn).
    const shotMode=new URLSearchParams(location.search).has('shot');
    if(shotMode){const c=renderer.domElement;Object.assign(c.style,{position:'fixed',inset:'0',width:'100vw',height:'100vh',zIndex:'2147483000'});document.title='loading';}
    void entityLayer.start(abort.signal).then(()=>{frameEntityWorld();setEntityWorld(entityLayer.active);if(shotMode)setTimeout(()=>{document.title=entityLayer.active?'ready':'no-entity-world';(window as unknown as {__shotReady?:boolean}).__shotReady=true;},Math.max(2500,Number(new URLSearchParams(location.search).get('settle')??'3000')));});
    const gw=window as unknown as {__simGhost?:WorldPreviewGhost};const ghost=gw.__simGhost??(gw.__simGhost=new WorldPreviewGhost(apiPath));scene.add(ghost.group);  // ?preview=<id> ghosts (GodPanel drives it; one ghost per page, whoever makes it first)
    // Alt+click on the ground drops a labelled flag (a core/flag entity) the god can refer to as flag:<label>.
    // Owner authority: this world's god token, minted with the page's signed-in person (Clerk in production, a local name in dev).
    const godMint=()=>ensureGodToken().catch(()=>null);
    const flagRay=new THREE.Raycaster(),flagNdc=new THREE.Vector2();
    const onFlagClick=async(ev:MouseEvent)=>{
      if(!(ev.altKey||flagModeRef.current)||!entityLayer.active)return;
      setFlagMode(false);
      const rect=renderer.domElement.getBoundingClientRect();flagNdc.set(((ev.clientX-rect.left)/rect.width)*2-1,-((ev.clientY-rect.top)/rect.height)*2+1);
      flagRay.setFromCamera(flagNdc,camera);const hit=flagRay.intersectObjects(entityLayer.terrainMeshes(),false)[0];if(!hit)return;
      const label=window.prompt(`Flag at (${hit.point.x.toFixed(0)}, ${hit.point.z.toFixed(0)}) — label:`);if(!label)return;
      const token=await godMint();if(!token){problem('Only the world owner can drop flags: sign in and claim the world first.');return;}
      const name=label.toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48)||'flag';
      const r=await fetch(apiPath('/v1/god/act'),{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({ops:[{op:'place',def:'core/flag@1',name,p:[Math.round(hit.point.x*10)/10,Math.round(hit.point.z*10)/10],state:{label}}],note:'flag from the website'})});
      const d=await r.json().catch(()=>null);if(!d?.accepted)problem(`Flag refused: ${d?.failures?.[0]?.code??r.status} ${d?.failures?.[0]?.detail??''}`);
    };
    renderer.domElement.addEventListener('click',onFlagClick);(window as unknown as {__simEntity?:unknown}).__simEntity={layer:entityLayer,camera,controls,scene,renderer,stats:()=>({draws:renderer.info.render.calls,tris:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,instances:entityLayer.instancer.instances,instanceDraws:entityLayer.instancer.draws,entities:entityLayer.entityCount})};  // the entity world (god mode), when this world has one
    const games=new WorldGames();scene.add(games.group);
    const platformDraw=new WorldPlatforms();scene.add(platformDraw.group);
    const placeActivity=new WorldPlaceActivity();scene.add(placeActivity.group);
    const fading=new WorldFadingLayer();scene.add(fading.group);let fadedOut=new Set<string>();const fadeOverride=parseFadeOverride(location.search),fadeSince=new Map<string,number>();
    // Balloon ride: Core's ride state (edge frames) or a native carrier; ?ride=Alice,Bob previews a flight locally.
    const balloonRide=new WorldBalloonRide();scene.add(balloonRide.group);const rideOverride=parseRideOverride(location.search),rideStart=performance.now();
    const atmosphere=createWorldAtmosphere(scene);let atmosphereSeconds=0;const reducedMotionQuery=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):null;
    const light = new Daylight(scene);
    const broadcast = new WorldBroadcast();
    broadcast.hints=()=>({soulEntity:id=>context.current.sim.conn.replica.souls.get(id)?.entityId??null,eden:!!expansion&&!past.current,daylight:light.daylight});  // VF1/VF5: who speaks; Eden town views; time of day
    const followView=new WorldFollow();
    const followMotion=new WorldFollowMotion();
    let followTick:number|null=null,followEpoch:string|null=null;
    let previousCameraMode: WorldCameraMode = 'broadcast';
    let logicalFov = 45;
    let expansion:ReturnType<typeof createWorldEdenExpansion>|null=null,expansionFailed=false;
    let expansionSceneInfo:ReturnType<typeof parseSceneInfo>|null=null;
    let cameraGroundInfo:ReturnType<typeof parseSceneInfo>|null|undefined,cameraGroundOwner:ReturnType<typeof createWorldEdenExpansion>|null|undefined;
    const refreshCameraGround=()=>{if(entityLayer.active){cameraGround.bindGround(entityLayer.groundAt,entityLayer);return;}const owner=expansion?.group.visible?expansion:null;if(cameraGroundInfo===expansionSceneInfo&&cameraGroundOwner===owner)return;cameraGroundInfo=expansionSceneInfo;cameraGroundOwner=owner;cameraGround.bindGround(cameraGroundSampler(expansionSceneInfo??undefined,owner?.sampleVisualGround),expansionSceneInfo);};
    let houseWindows:ReturnType<typeof createEdenHouseWindows>=null;
    let shadowDetail:WorldShadowDetail|null=null;
    const clearExpansion=()=>{shadowDetail?.dispose();shadowDetail=null;houseWindows?.dispose();houseWindows=null;expansion?.dispose();expansion=null;refreshCameraGround();};
    let geometry = new WorldGeometry(null);
    scene.add(geometry.group);
    const groupSelection=new Set<string>();
    const framing=new WorldPlaceCamera();let followed: string | null = null;
    const overview = (b: readonly [number, number, number, number]) => {
      if(entityWorldFramed)return;  // the entity world framed itself; a later scene install must not yank the camera back
      const [x0, z0, x1, z1] = b, span = Math.max(10, x1 - x0, z1 - z0);
      controls.target.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
      camera.position.set(controls.target.x + span * 0.1, span * 0.6, controls.target.z + span * 0.75);
      controls.update();
      framing.framed = true;
    };
    overview(geometry.bounds);
    framing.framed = false; // the placeholder ground does not count: frame again once the real layout (or the people) arrive
    controlsApi.current = {
      overview: () => { navigation?.release(); overview(expansion&&!past.current?[-100,-65,105,85]:geometry.bounds); },
      framePoint:(point,radius)=>{context.current.setCameraMode('manual');context.current.setManualNavigation('orbit');rts.frameSubject(point,radius);},
      frameSouls: ids => {
        const members=[...new Set(ids)].slice(0,12).flatMap(id=>{const soul=context.current.sim.conn.replica.souls.get(id),p=soul?shown.current.entities[soul.entityId]:null;return soul&&p?[{id,p:p.p,yaw:p.yaw??0}]:[];});
        if(!members.length)return false;
        navigation?.release();context.current.setManualNavigation('orbit');context.current.setCameraMode('manual');
        const shot=conversationFrame(members,camera,visualObstructionRoots(),(x,z)=>cameraGround.heightAt(scene,x,z)??0);
        if(!shot)return false;groupSelection.clear();members.forEach(m=>groupSelection.add(m.id));context.current.onSelect(members[0].id);controls.target.copy(shot.target);camera.position.copy(shot.position);camera.lookAt(shot.target);controls.update();return true;
      },
      framePlace: place => {const view=worldPlaceView(place);if(!view||!expansion||past.current)return false;framing.place(camera,()=>controls,view,()=>{context.current.manualNavigation='orbit';context.current.cameraMode='manual';context.current.follow=false;context.current.setManualNavigation('orbit');context.current.setCameraMode('manual');},()=>{rts.release();orbitPivot.cancel();navigation?.release();});return true;},
      releaseInput: () => {rts.release();navigation?.release();},
      move: delta => navigation?.move(delta) ?? false,
      inputOwned: () => navigation?.inputOwned ?? false,
      reset: () => {
        navigation?.release(); broadcast.reset();followView.reset();followMotion.reset();followed=null;
        if(context.current.cameraMode==='broadcast')return true;
        if(context.current.cameraMode==='follow'){
          const c=context.current,id=c.selected?c.sim.conn.replica.souls.get(c.selected)?.entityId:c.thing;
          const p=id?.startsWith('kin:')?kin.view.object(id)?.position.toArray():id?shown.current.entities[id]?.p:null;
          if(!p)return false;controls.target.set(p[0],p[1]+1,p[2]);camera.position.copy(controls.target).add(new THREE.Vector3(6,4,8));camera.lookAt(controls.target);return true;
        }
        overview(geometry.bounds);return true;
      },
      placePreview: place => context.current.edenExpansion&&!past.current ? placePreviews.capture(place) : Promise.resolve(null),
      focusSelected: () => {
        navigation?.release();
        const c = context.current;
        const entity = c.selected ? c.sim.conn.replica.souls.get(c.selected)?.entityId : c.thing;
        const position = entity ? shown.current.entities[entity]?.p : null;
        if (!position) return false;
        const offset = camera.position.clone().sub(controls.target);
        if (offset.length() > 12) offset.setLength(12);
        controls.target.set(position[0], position[1] + 1, position[2]);
        camera.position.copy(controls.target).add(offset); controls.update();
        return true;
      },
    };
    const resize = new ResizeObserver(() => {
      const w = host.clientWidth, h = host.clientHeight;
      renderer.setSize(w, h, false); labels2d.setSize(w, h);
      camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
    });
    resize.observe(host);

    // models: one loader (Draco for the character scans) shared by buildings, floaters and kin
    const diagnostics=new RendererDiagnostics(host);
    const downloads=new AssetDownloads(()=>{if(!abort.signal.aborted)setAssetProgress(downloads.snapshot());}),manager=new THREE.LoadingManager();
    manager.onStart=(url)=>downloads.start(url);
    manager.onProgress=(url)=>downloads.finish(url);
    manager.onError=(url)=>downloads.finish(url,true);
    const originalStart=manager.itemStart.bind(manager);manager.itemStart=(url)=>{downloads.start(url);originalStart(url);};
    const draco = new DRACOLoader(manager).setDecoderPath('/mars-assets/draco/');
    const placePreviews=new WorldPlacePreviews(renderer,()=>[geometry.group,...(expansion?[expansion.group]:[])]);
    const loader = new GLTFLoader(manager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
    setAssetLoader(loader);
    const floaters = new FloaterView(scene, { baseUrl: '/world-assets/littlemartians/characters/', loader });
    const bodyModels=new WorldBodyModels(loader,problem);
    let capturedPlatforms:readonly PlatformFloor[]|null=null;
    let currentPlatforms:{worldId:string;platforms:PlatformFloor[]}|null=null;
    void fetch(apiPath('/v1/edge/platforms'),{signal:abort.signal}).then(r=>r.ok?r.json():null).then(meta=>{
      if(!abort.signal.aborted&&meta?.contract==='eden-edge/1'&&meta.active===true&&meta.provenance?.contract==='render-platforms/1'&&typeof meta.worldId==='string')currentPlatforms={worldId:meta.worldId,platforms:parsePlatformFloors(meta.platforms)};
    }).catch(()=>{});
    const kin = new KinScenery(scene, { baseUrl: '/world-assets/littlemartians/characters/', loader });
    let templatesFailed = false, templates: Awaited<ReturnType<typeof loadTemplates>> = [];
    void loadTemplates(abort.signal, resources,{appearances:humanPresets,onAsset:(name,phase)=>{if(phase==='start')downloads.start('person:'+name);else downloads.finish('person:'+name,phase==='failed');}}).then((t) => { templates = t; people?.setTemplates(t); }).catch(() => {
      if (abort.signal.aborted) return;
      templatesFailed = true;
      problem('The people models could not be loaded, so people are shown as simple figures.');
    });

    // Current unbound live viewers retain their observed layout. Historical
    // bound segments load their verified base; old unbound history uses neutral ground.
    let dayTicks: number | null = null;
    let base: ReturnType<typeof parseSceneInfo>['scene'] = null, sceneSettled = false, people: TakePeople | null = null;
    let publication:unknown=null,restMarkers:ReturnType<typeof createPublishedRestMarkers>=null;
    let newcomerMarkers:ReturnType<typeof createPublishedNewcomerMarkers>=null,newcomerMarkersFailed=false;
    const clearNewcomerMarkers=()=>{const owner=newcomerMarkers;newcomerMarkers=null;newcomerMarkersFailed=false;try{owner?.dispose();}catch{if(!abort.signal.aborted)problem('Some sleeping-area scenery could not be shown; keeping the original ground.');}};
    const nativeSocialDraw=new WorldNativeSocialDraw();
    let socialPaths:ReturnType<typeof createNativeSocialPaths>=null;
    const clearSocialPaths=()=>{const previous=socialPaths;socialPaths=null;try{previous?.dispose();}catch{problem('Some path scenery could not be shown; keeping the original ground.');}};
    let planting:ReturnType<typeof createCurrentProvisionsUnderstory>=null,plantingFailed=false;
    let connectedDressing:ReturnType<typeof createCurrentSocialDressingOwner>=null,connectedDressingFailed=false;
    const clearConnectedDressing=()=>{const owner=connectedDressing;connectedDressing=null;connectedDressingFailed=false;try{owner?.dispose();}catch{problem('Some greenery could not be shown; keeping the original scenery.');}};
    const visualObstructionRoots=()=>worldCameraRenderRoots(geometry.group,people?.obstructionRoots()??[],[planting?.group,connectedDressing?.group,expansion?.group]);
    let nativeBoat:NonNullable<ConstructorParameters<typeof TakePeople>[1]>['nativeBoat'];
    let sceneKey:string|null=null,sceneRequest=0,sceneRetryAt=0,sceneReason:string|null=null;
    const sceneryStatus=(reason:string|null)=>{sceneReason=reason;setSceneryNotice(reason);};
    const sceneHistory=new WorldSceneHistory(context.current.sim.conn.welcome?.worldId??'',async(hash,signal)=>{
      const response=await fetch(apiPath('/v1/scenes/'+hash),{signal});
      if(!response.ok)throw Error('Recorded scenery unavailable');return response.json();
    },decodeSceneCapturePublication);
    const installScene=(info:ReturnType<typeof parseSceneInfo>,verifiedPublication?:unknown)=>{
      nativeSocialDraw.reset(people);
      clearExpansion();expansionFailed=false;
      clearConnectedDressing();
      planting?.dispose();planting=null;plantingFailed=false;
      clearSocialPaths();
      clearNewcomerMarkers();restMarkers?.dispose();restMarkers=null;publication=verifiedPublication??null;expansionSceneInfo=info;
      refreshCameraGround();
      people?.dispose();people=null;applied=null;
      base=info.scene;nativeBoat=info.shore?.metadata.boat&&info.shore.appearance?{layout:info.shore.metadata.boat.layout,proposal:info.shore.appearance.boat}:undefined;dayTicks=info.clock?.dayTicks??null;broadcast.reset();followView.reset();followed=null;
      capturedPlatforms=info.platforms??null;
      geometry.dispose();geometry=new WorldGeometry(base,info.ground,info.commons,info.shore,info.assetRoot);scene.add(geometry.group);light.fit(geometry.bounds);light.setCommonsReadability(geometry.hasAuthoredCommons);
      // Cosmetic paths require the verified full public capture and exact Core
      // social layout. Unknown/legacy scenes retain their original appearance.
      if((verifiedPublication as {body?:{scene?:{social?:{version?:unknown}}}}|undefined)?.body?.scene?.social?.version==='social-eden/1')try{socialPaths=createNativeSocialPaths(verifiedPublication,true);if(socialPaths)scene.add(socialPaths.group);}catch{}
      if(base)framing.initial(()=>overview(geometry.bounds));
      kin.place(info.kin);sceneSettled=true;
      const owner=geometry;
      if(info.backdrop)void owner.addBackdrop(info.backdrop,loader).then(ok=>{if(!ok&&!abort.signal.aborted&&owner===geometry)problem('The campus model could not be shown; its plain navigation walls remain visible.');});
      if(info.buildings.length){const buildingRoot=info.assetRoot?Promise.resolve(info.assetRoot):fetch(apiPath('/v1/worldmeta'),{signal:abort.signal}).then(r=>r.ok?r.json():null).then(meta=>typeof meta?.assetRoot==='string'?meta.assetRoot:undefined).catch(()=>undefined);
      void buildingRoot.then(assetRoot=>{if(assetRoot)owner.setAssetRoot(assetRoot);return owner.addBuildings(info.buildings,loader);}).then(failed=>{
        if(failed.length&&!abort.signal.aborted&&owner===geometry)problem('Some buildings could not be shown; their plain walls are drawn instead.');
      });}
    };
    let currentScene:Promise<ReturnType<typeof parseSceneInfo>>|null=null;
    const currentLayout=()=>currentScene??= (async()=>{
      for(let attempt=0;!abort.signal.aborted;attempt++){
        try{const response=await fetch(apiPath('/v1/scene'),{signal:abort.signal});if(!response.ok)throw Error('Layout unavailable');const info=parseSceneInfo(await response.json());setProblems(p=>p.filter(x=>!x.startsWith('The layout of the world')));return info;}
        catch{if(abort.signal.aborted)break;if(sceneKey==='current-unbound'){installScene(parseSceneInfo(null));sceneryStatus('The scenery is loading; showing people on plain ground.');renderer.domElement.dataset.sceneBinding='current-unbound-waiting';}if(attempt===1)problem('The layout of the world could not be loaded yet; still trying.');await new Promise<void>(r=>{const timer=setTimeout(done,Math.min(30000,2000*2**attempt));function done(){clearTimeout(timer);abort.signal.removeEventListener('abort',done);r();}abort.signal.addEventListener('abort',done,{once:true});});}
      }return parseSceneInfo(null);
    })();
    const ensureScene=(chunk:Chunk,history:boolean,now:number)=>{
      const reference=(chunk.take as Take&{renderSceneRef?:unknown}).renderSceneRef;
      const ref=reference as {contract?:unknown;hash?:unknown;rulesVersion?:unknown}|undefined;
      const mismatch=reference!==undefined&&ref?.rulesVersion!==chunk.take.rulesVersion;
      const key=reference===undefined?(history?'history-unbound':'current-unbound'):JSON.stringify([ref?.contract,ref?.hash,ref?.rulesVersion,mismatch]);
      if(key===sceneKey&&(sceneSettled||now<sceneRetryAt))return sceneSettled;
      const request=++sceneRequest;sceneKey=key;sceneRetryAt=Infinity;sceneSettled=false;
      nativeSocialDraw.reset(people);
      clearSocialPaths();
      clearConnectedDressing();
      sceneHistory.cancel();planting?.dispose();planting=null;plantingFailed=false;clearNewcomerMarkers();restMarkers?.dispose();restMarkers=null;publication=null;expansionSceneInfo=null;people?.dispose();people=null;applied=null;floaters.sync(new Map());kin.place([]);standIns.clear();
      for(const label of labels.values()){scene.remove(label.obj);label.obj.element.remove();}labels.clear();
      clearExpansion();geometry.dispose();geometry=new WorldGeometry(null);scene.add(geometry.group);base=null;nativeBoat=undefined;light.setCommonsReadability(false);
      capturedPlatforms=null;
      platformDraw.set([],0,false);
      shown.current={tick:0,datetime:null,take:null,entities:{}};drawnTick.current=null;
      renderer.domElement.dataset.sceneHash='';renderer.domElement.dataset.sceneBinding='loading';sceneryStatus('Loading the scenery for this recording.');
      const active=()=>!abort.signal.aborted&&request===sceneRequest;
      if(reference===undefined){
        const pending=history?Promise.resolve(parseSceneInfo(null)):currentLayout();
        void pending.then(info=>{if(!active())return;installScene(info);sceneryStatus(history?'This recording does not identify its scenery; showing people on plain ground.':null);renderer.domElement.dataset.sceneBinding=history?'unbound-history':'current-unbound';});
      }else if(mismatch){sceneryStatus('The scenery reference does not match this recording.');sceneRetryAt=now+5000;renderer.domElement.dataset.sceneBinding='unavailable';}
      else void sceneHistory.resolve(reference).then(result=>{
        if(!active())return;
        if(result.status==='bound'){installScene(result.info,result.publication);sceneryStatus(null);renderer.domElement.dataset.sceneHash=result.ref.hash;renderer.domElement.dataset.sceneBinding='bound';}
        else if(result.status!=='stale'){sceneryStatus(result.reason);sceneRetryAt=performance.now()+5000;renderer.domElement.dataset.sceneBinding='unavailable';}
      });
      return false;
    };

    // selection marker and stand-in figures (used only if the people models fail)
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.64, 40), new THREE.MeshBasicMaterial({ color: 0xffd34d, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    ring.rotation.x = -Math.PI / 2; ring.visible = false; scene.add(ring);
    const standInGeometry = new THREE.CapsuleGeometry(0.22, 1.2, 4, 12), standInMaterial = new THREE.MeshStandardMaterial({ color: 0x5d7f9e, roughness: 0.7 });
    const standIns = new THREE.Group(); scene.add(standIns);
    const labels = new Map<string, Label>();
    const labelFor = (soul: PublicSoul): Label => {
      let l = labels.get(soul.id);
      if (l) return l;
      const el = document.createElement('div');
      el.style.cssText = 'font:11px/1.25 system-ui,sans-serif;color:#fff;background:rgba(18,20,18,.66);padding:2px 7px 3px;border-radius:5px;text-align:center;white-space:nowrap;pointer-events:auto;cursor:pointer;max-width:260px';
      const name = document.createElement('b'), line = document.createElement('div'), card = document.createElement('div'), chan = document.createElement('div');
      line.style.cssText = 'opacity:.85'; card.style.cssText = 'opacity:.7;font-style:italic'; chan.style.cssText = 'display:none;font-size:10px;margin-top:1px;white-space:normal;max-width:240px'; chan.dataset.channelChip = '';
      const leader = document.createElement('div');
      leader.style.cssText = 'position:absolute;top:100%;left:50%;width:1px;background:rgba(255,255,255,.45);transform-origin:top;pointer-events:none';
      el.append(name, line, card, chan, leader);
      el.dataset.soulId = soul.id;
      el.addEventListener('click', e => { e.stopPropagation(); setPlaceCard(null); context.current.setThing(null); context.current.onSelect(soul.id); });
      el.addEventListener('dblclick', e => {
        e.preventDefault();e.stopPropagation();setPlaceCard(null);context.current.setThing(null);context.current.onSelect(soul.id);
        const point=shown.current.entities[soul.entityId]?.p;
        if(point){navigation?.release();context.current.setManualNavigation('orbit');context.current.setCameraMode('manual');rts.frameSubject(new THREE.Vector3(point[0],point[1]+1,point[2]),1);}
      });
      const obj = new CSS2DObject(el);
      obj.center.set(0.5, 1);
      scene.add(obj);
      l = { obj, name, line, card, leader, offset: {dx:0,dy:0}, text: '' };
      labels.set(soul.id, l);
      return l;
    };

    let liveArr: unknown = null, liveKey = '', live: Chunk[] = [], liveTick: number | null = null;
    const spot = new THREE.Vector3();
    const gaitContinuity=new RecordedGaitContinuity();
    let applied: Chunk | null = null, records: Record<string, Entity> = {}, frame = 0, last = performance.now(), labelAt = 0, brokenTake: string | null = null, frameGap = false;
    const liveChunks = () => {
      const t = takesOf(context.current.sim);
      const arr = t?.chunks ?? null, key = `${arr?.length ?? 0}:${(arr?.at(-1) as { toTick?: number } | undefined)?.toTick ?? ''}`;
      if (arr !== liveArr || key !== liveKey) { liveArr = arr; liveKey = key; live = validChunks(arr).filter((c) => c.fromTick <= (t?.serverTick ?? Infinity)); } // a restarted server starts its ticks again
      return live;
    };
    const goLive = () => { past.current = null; liveTick = null; setMode('live'); setNote(null); };

    const pacer = new FramePacer();
    const eyes=WorldEyes.fromSearch(location.search,{renderer,camera,scene,body:id=>people?.bodyObject(id)??floaters.object(id)??standIns.getObjectByName(id)??null,souls:()=>[...context.current.sim.conn.replica.souls.values()].map(x=>x.entityId),overlays:()=>[speechLayer.group,ring,orbitPivot.group,fading.group,hover.marker],tick:()=>shown.current.tick,ready:()=>sceneSettled&&drawnTick.current!==null});
    const officeGuardFrom=new THREE.Vector3(),authoredBoundaries=new WorldAuthoredBoundaries();
    const animate = () => {
      officeGuardFrom.copy(camera.position);
      if (abort.signal.aborted) return;
      frame = pacer.next(animate);
      if(eyes&&!eyes.wake(performance.now()))return;  // VF1b: a slow frame leaves room for socket messages
      const now = performance.now(), step = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = context.current.sim, dt = dtOf(s), liveList = liveChunks();
      let chunks: Chunk[], tick: number;
      const p = past.current;
      if (p) {
        const end = p.chunks.at(-1)!;
        if (p.playing) p.tick = Math.min(end.toTick, p.tick + step / dt); // replays run at the world's normal speed
        // A paused recent seek remains history. Playing history catches the actual
        // delayed live moment, not merely the oldest buffered chunk boundary.
        const liveHead = serverNow(s);
        if (p.playing && liveList.length && liveHead !== null &&
          p.tick >= Math.max(liveList[0].fromTick, liveHead - LIVE_DELAY)) { goLive(); return; }
        if (p.playing && !p.extending && !p.ended && now > p.retryAt && p.tick > end.toTick - 20 / dt) {
          p.extending = true;
          void fetchChunks(end.toTick, end.toTick + 60 / dt, 60, abort.signal).then((got) => {
            if (past.current !== p) return;
            const before = p.chunks.at(-1)!.toTick;
            p.chunks = mergeWindow(p.chunks, got, p.tick);
            if (p.chunks.at(-1)!.toTick <= before) p.ended = true;
          }).catch(() => { p.retryAt = performance.now() + 5000; }).finally(() => { p.extending = false; });
        }
        if (p.ended && p.tick >= end.toTick && p.playing) {
          const at = serverNow(s);
          if (at !== null && at - end.toTick < 120 / dt) { goLive(); return; } // only the last moments are missing: they are live
          p.playing = false;
          setNote('This is the end of what was recorded here. Go back to live to continue.');
        }
        chunks = p.chunks; tick = p.tick;
      } else {
        chunks = liveList;
        const target = (serverNow(s) ?? chunks.at(-1)?.toTick ?? 0) - LIVE_DELAY;
        if (liveTick === null || Math.abs(target - liveTick) > 80) liveTick = target;
        else liveTick += step * tpsOf(s) + (target - liveTick) * Math.min(1, step * 1.5); // run at the clock rate, drift gently toward the server
        if (chunks.length) liveTick = Math.max(chunks[0].fromTick, Math.min(chunks.at(-1)!.toTick, liveTick));
        tick = liveTick;
      }

      const candidate = chunkAt(chunks, tick);
      const pick = candidate && ensureScene(candidate.chunk,!!past.current,now) ? candidate : null;
      frameGap = !!pick && !pick.exact;
      if (pick) {
        const chunk = pick.chunk, take = chunk.take;
        const depictedTick = recordingTick(chunk, tick);
        try {
          if (!people) {
            people = new TakePeople(take, { scene: base ?? undefined,nativeBoat,commonsContrast:geometry.hasAuthoredCommons,humanPresets:humanPresets&&geometry.hasAuthoredCommons });
            people.setTemplates(templates);
            people.setBodyTemplates(bodyModels.templates);
            scene.add(people.group);
          }
          if (chunk !== applied) {
            if(!restMarkers&&publication){const choice=publishedRestSelection(context.current.sim.conn.welcome?.worldId??'',(take as Take&{renderSceneRef?:unknown}).renderSceneRef);if(choice){restMarkers=createPublishedRestMarkers(publication,take,choice,{enabled:true});if(restMarkers)scene.add(restMarkers.group);}}
            restMarkers?.setTake(take);
            if(!newcomerMarkers&&!newcomerMarkersFailed&&publication){const choice=publishedNewcomerSelection(context.current.sim.conn.welcome?.worldId??'',(take as Take&{renderSceneRef?:unknown}).renderSceneRef);if(choice)try{newcomerMarkers=createPublishedNewcomerMarkers(publication,take,choice,{enabled:true});if(newcomerMarkers)scene.add(newcomerMarkers.group);}catch{newcomerMarkersFailed=true;problem('Some sleeping-area scenery could not be shown; keeping the original ground.');}}
            if(newcomerMarkers)try{newcomerMarkers.setTake(take);}catch{clearNewcomerMarkers();newcomerMarkersFailed=true;problem('Some sleeping-area scenery could not be shown; keeping the original ground.');}
            if(!planting&&!plantingFailed&&publication){
              let createPlanting:typeof createCurrentProvisionsUnderstory|undefined;
              try{if(inspectCurrentProvisionsUnderstory(publication,take,{enabled:true}))createPlanting=createCurrentProvisionsUnderstory;else if(inspectLiveKitchenUnderstory(publication,take,{enabled:true}))createPlanting=createLiveKitchenUnderstory;else if(inspectLiveFoodShoreUnderstory(publication,take,{enabled:true}))createPlanting=createLiveFoodShoreUnderstory;else if(inspectLiveSocialUnderstory(publication,take,{enabled:true}))createPlanting=createLiveSocialUnderstory;else if(inspectLiveFoodBUnderstory(publication,take,{enabled:true}))createPlanting=createLiveFoodBUnderstory;}catch{}
              if(createPlanting)try{planting=createPlanting(publication,take,{enabled:true});if(planting)scene.add(planting.group);}catch{plantingFailed=true;problem('Some planting could not be shown; keeping the original scenery.');}
            }
            if(planting)try{planting.setTake(take);}catch{const failed=planting;planting=null;plantingFailed=true;try{failed.dispose();}catch{}problem('Some planting could not be shown; keeping the original scenery.');}
            // Eligibility reserves the whole recorded chunk; never rehash it per display frame.
            if(publication&&!connectedDressingFailed){
              if(!connectedDressing)try{connectedDressing=createCurrentSocialDressingOwner(publication,take,true);if(connectedDressing)scene.add(connectedDressing.group);}catch{connectedDressingFailed=true;}
              else try{connectedDressing.setTake(take);}catch{clearConnectedDressing();connectedDressingFailed=true;}
            }
            people.setTake(take,gaitContinuity.offsets(chunks,chunk));
            records = { ...(take.entities0 as Record<string, Entity> | undefined), ...take.finalState.entities };
            applied = chunk;
            geometry.markRegions(take.finalState.regions);
            if (!framing.framed) { // no layout: frame whatever the world has in it
              const box = new THREE.Box3();
              for (const e of Object.values(take.finalState.entities)) box.expandByPoint(new THREE.Vector3(...e.pose.p));
              if (!box.isEmpty()) overview([box.min.x - 4, box.min.z - 4, box.max.x + 4, box.max.z + 4]);
            }
          }
          const local = Math.max(0, Math.min(take.ticks, depictedTick - take.startTick));
          people.setWaterHistory(chunks.map(c=>c.take));
          const floors=capturedPlatforms??(!past.current&&currentPlatforms&&currentPlatforms.worldId===s.conn.welcome?.worldId?currentPlatforms.platforms:[]);
          platformDraw.set(floors,base?.levels.find(l=>l.id===0)?.y??0,!!expansion&&!past.current);
          people.setPlatformFloors(floors,base?.levels.find(l=>l.id===0)?.y??0);
          const beat=worldDepictionBeat(context.current.depictionBeatAt,s.conn.welcome?.worldId,take,depictedTick,past.current?'history':'live',pick.exact);
          const sampled = people.show(local * take.dt, depictedTick * dt,beat);
          games.update(sampled.entities,depictedTick);
          bodyModels.sync(records,sampled.entities);
          const sampledFloaters=new Map(Object.entries(sampled.entities).flatMap(([id,e])=>{const body=recordedBody(records[id]?.body,e.state);if(body?.family!=='floater')return [];const url=admittedBodyUrl(body.modelUrl,apiPath('').replace(/\/$/,''));return [[id,{...body,...(url?{modelUrl:url}:{})} as NonNullable<Entity['body']>]] as [string,NonNullable<Entity['body']>][];}));
          floaters.sync(sampledFloaters);
          nativeSocialDraw.update(people,publication,take,records,sampled);
          geometry?.setRecordedFixtures(sampled.entities,records);
          geometry?.setViewTime(depictedTick*take.dt);
          const expansionWanted=edenExpansionCapture(!!context.current.edenExpansion,s.conn.welcome?.worldId,expansionSceneInfo,publication,!!past.current);
          if(!expansionWanted&&expansion)clearExpansion();
          if(expansionWanted&&!expansion&&!expansionFailed)try{expansion=createWorldEdenExpansion(officeGuardsFromPublication(publication,depictedTick),expansionSceneInfo??undefined);scene.add(expansion.group);try{houseWindows=createEdenHouseWindows();if(houseWindows)expansion.group.add(houseWindows.group);}catch{houseWindows=null;}expansion.replaceCosmeticBackdrop(geometry.group);light.fit([-100,-65,105,85]);}catch{expansionFailed=true;problem('Some new Eden scenery could not be shown.');}
          expansion?.sync(sampled.entities,!!past.current,depictedTick*take.dt);
          expansion?.setLocalPresentation(context.current.localClassroomPresentation,s.conn.welcome?.worldId??'',Object.hasOwn(sampled.entities,'eden-classroom-screen-1')&&records['eden-classroom-screen-1']?.kind==='fixture'&&records['eden-classroom-screen-1']?.def==='standing-display',!!past.current);
          floaters.update(sampled.entities, take.startTick + sampled.tick, take.dt); // absolute tick: the bob is replay-stable
          kin.update(depictedTick, dt);
          // stand-ins if the people models never arrived
          {
            const seen = new Set<string>();
            for (const [id, e] of Object.entries(sampled.entities)) {
              const rec = records[id];
              if(rec?.kind!=='human'||recordedBody(rec.body,e.state)?.family==='floater'||!(bodyModels.unresolved.has(id)||templatesFailed&&!recordedBody(rec.body,e.state)?.modelUrl))continue;
              seen.add(id);const hidden=people.bodyObject(id);if(hidden)hidden.visible=false;
              let m = standIns.getObjectByName(id) as THREE.Mesh | undefined;
              if (!m) { m = new THREE.Mesh(standInGeometry, standInMaterial); m.name = id; m.castShadow = true; standIns.add(m); }
              m.position.set(e.p[0], e.p[1] + 0.82, e.p[2]);
            }
            for (const m of [...standIns.children]) if (!seen.has(m.name)) standIns.remove(m);
          }
          // world clock at the moment shown (the sim's clock, moved back by how far behind it we are)
          const clock = take.finalState.env?.datetime ?? null;
          const ref = take.startTick + take.ticks;
          const clockOffset=(depictedTick-ref)*(dayTicks?86400/dayTicks:dt);
          const datetime = clock ? shiftIso(clock, clockOffset) : null;
          light.update(clock?shiftIso(clock,clockOffset,true):null);
          light.setNightLighting(!!expansion);setNightLightStrength(expansion?light.daylight:1);houseWindows?.setNight(nightLightStrength());
          shown.current = { tick: depictedTick, datetime, take, entities: sampled.entities };
          brokenTake = null;
        } catch (e) {
          if (brokenTake !== take.id) { brokenTake = take.id; console.warn('live view: a recorded moment could not be drawn', e); }
        }
      }

      // names over Souls, the selection ring, follow
      const { selected: soulId, thing: thingId, follow: following, cameraMode: viewing } = context.current;
      if(following||soulId&&!groupSelection.has(soulId))groupSelection.clear();
      if (viewing !== previousCameraMode) { broadcast.reset(); previousCameraMode = viewing; renderer.domElement.dataset.cameraShot=''; }
      renderer.domElement.dataset.cameraMode = viewing;
      const souls = [...s.conn.replica.souls.values()];
      const refresh = now - labelAt > 250;
      if (refresh) labelAt = now;
      if(refresh)balloonRide.ingest(((context.current.sim as unknown as {edge?:readonly EdgeSpectatorMessage[]}).edge??[]));
      const ridePreview=rideOverride&&!past.current?(()=>{const st=previewState((performance.now()-rideStart)/1000,rideOverride.speed),ids=rideOverride.names.flatMap(n=>{const soul=souls.find(x=>x.name.toLowerCase()===n);return soul?[soul.id]:[];});return {riders:ids.slice(0,st.aboard),phase:st.phase,flight:st.flight};})():null;
      // Riders stand in the basket for labels, speech, camera and drawing (presentation only; the recording is untouched).
      const at = balloonRide.update(shown.current,{dt,seconds:atmosphereSeconds,eden:!!expansion,history:!!past.current,soulEntity:id=>s.conn.replica.souls.get(id)?.entityId??null,preview:ridePreview});
      const cards = refresh ? cardsAt(s.plays, at.tick) : null;
      const alive = new Set<string>();
      let focus: THREE.Vector3 | null = null;
      for (const soul of souls) {
        const pos = at.entities[soul.entityId]?.p, rec = records[soul.entityId];
        if (!pos || fadedOut.has(soul.id)) continue;   // DLG1: a faded (absent) Soul has no name tag or speech anchor
        alive.add(soul.id);
        const drawnBody=recordedBody(rec?.body,at.entities[soul.entityId]?.state??{});
        const lift = drawnBody?.family === 'floater' ? (() => { const b = floaterBody(drawnBody); return b.hoverHeight + b.radius + 0.15; })() : 2.05;
        if(refresh&&!eyes)portraits.capture(soul.id,JSON.stringify([drawnBody,soul.entityId]),people?.bodyObject(soul.entityId)??floaters.object(soul.entityId)??standIns.getObjectByName(soul.entityId)??null,drawnBody?.family==='floater',now);
        const l = labelFor(soul);
        l.obj.position.set(pos[0], pos[1] + lift, pos[2]);
        l.obj.visible = true;
        if (cards) {
          const activity = at.entities[soul.entityId]?.activity;
          const doing = past.current ? activityWords(activity,soul.id) : doingText(soul.doing,activity,soul.id);
          const card = cardText(cards.get(soul.id));
          const text = `${soul.name}|${doing}|${card}|${soul.id === soulId||groupSelection.has(soul.id)}`;
          if (text !== l.text) {
            l.text = text; l.name.textContent = soul.name; l.line.textContent = clip(doing, 48); l.card.textContent = clip(card, 48);
            l.line.style.display = doing && soul.id===soulId ? '' : 'none'; l.card.style.display = card && soul.id===soulId ? '' : 'none';
            (l.obj.element as HTMLElement).style.outline = soul.id === soulId||groupSelection.has(soul.id) ? '2px solid #ffd34d' : 'none';
          }
        }
        if (soul.id === soulId) focus = spot.set(pos[0], pos[1], pos[2]);
      }
      // W4: who can hear each recent line (spectators see all channels).
      if(refresh){const now=Date.now(),recent=past.current?[]:context.current.sim.talk.filter(t=>now-t.at<20000);
        // Prefer Core's edge spectator feed (exact channels) when the client provides it; else legacy talk lines.
        const edgeFeed=((context.current.sim as unknown as {edge?:readonly EdgeSpectatorMessage[]}).edge??[]).filter(m=>now-m.at<120000);
        const posOf=(soulId:string)=>{const id=s.conn.replica.souls.get(soulId)?.entityId,p=id?at.entities[id]?.p:null;return p?[p[0],p[1],p[2]] as const:null;};
        speeches=past.current?[]:edgeFeed.length?speechFromEdge(edgeFeed,posOf).filter(sp=>now-sp.at<20000):recent.map(t=>speechFromTalk(t,posOf(t.from)));
        attentionTargets=new Map([...s.conn.replica.souls.keys()].map(id=>[id,conversationAttention(id,speeches,now)]));
        if(edgeFeed.length&&!fadeOverride.size){const wallToPerf=performance.now()-now,states=fadingFromEdge(edgeFeed,a=>a+wallToPerf);fading.setStates(states);fadedOut=past.current?new Set():beamedOut(states,performance.now());}
        const nameOf=(id:string)=>s.conn.replica.souls.get(id)?.name??'someone',latest=new Map<string,SpectatorSpeech>();
        for(const sp of speeches)if(now-sp.at<8000&&(!latest.get(sp.speaker)||latest.get(sp.speaker)!.at<sp.at))latest.set(sp.speaker,sp);
        for(const [id,l] of labels){
          // DLG2: in dock mode the dialogue dock carries the words and who can hear; the tag only gets a small speaking dot.
          paintSpeakingDot(l.obj.element as HTMLElement,id,context.current.publishSpeechAnchors,performance.now(),camera.position.distanceTo(l.obj.position));
          const chip=l.obj.element.querySelector('[data-channel-chip]') as HTMLElement|null;if(!chip)continue;const sp=latest.get(id);
          if(!sp||context.current.publishSpeechAnchors){chip.style.display='none';continue;}const c=channelChip(sp,nameOf);chip.textContent=c.text;chip.style.color=c.colour;chip.style.display='';}}
      speechLayer.update(speeches,Date.now(),soulId=>{const id=s.conn.replica.souls.get(soulId)?.entityId,e=id?at.entities[id]:null;if(!id||!e)return null;const body=recordedBody(records[id]?.body,e.state),b=body?.family==='floater'?floaterBody(body):null;return speechHead.set(e.p[0],e.p[1]+(b?b.hoverHeight+b.radius+.05:1.95),e.p[2]).clone();});
      for (const [id, l] of labels) if (!alive.has(id)) { l.obj.visible = false; if (!s.conn.replica.souls.has(id)) { scene.remove(l.obj); l.obj.element.remove(); labels.delete(id); } }
      if (!focus && thingId) {
        const q = thingId.startsWith('kin:') ? kin.view.object(thingId)?.position.toArray() : at.entities[thingId]?.p;
        if (q) focus = spot.set(q[0], q[1], q[2]);
      }
      ring.visible = !!focus;
      if (!following) {followed = null;followView.reset();followMotion.reset();followTick=null;followEpoch=null;}
      if (focus) {
        ring.position.set(focus.x, (thingId?.startsWith('kin:') ? 0 : focus.y) + 0.03, focus.z);
        if (following) {
          const target = new THREE.Vector3(focus.x, (thingId?.startsWith('kin:') ? 0 : focus.y) + 1, focus.z);
          const offset = camera.position.clone().sub(controls.target);
          const focusId = soulId ?? thingId;
          const epoch=JSON.stringify([s.conn.welcome?.worldId,s.conn.welcome?.epoch,sceneKey,!!past.current]);
          const discontinuity=followTick!==null&&(at.tick<followTick||Math.abs(at.tick-followTick)*dt>1);
          if (followed !== focusId||followEpoch!==epoch||discontinuity) {
            followView.reset();if(offset.length()>12)offset.setLength(12);
            // Explicit selection/seek/scene changes frame the chosen moment.
            // Continuous movement thereafter retains separate position/aim lag.
            followMotion.reset(target.toArray(),target.toArray());controls.target.copy(target);camera.position.copy(target).add(offset);
          }
          followed = focusId;
          followTick=at.tick;followEpoch=epoch;
          const tracked=followMotion.sample(target.toArray(),target.toArray(),step);
          if(tracked){
            camera.position.add(new THREE.Vector3(...tracked.translation));controls.target.fromArray(tracked.aim);
            followView.shiftFrame(new THREE.Vector3(...tracked.offsetTranslation));
          }
        }
      }
      if(viewing==='follow' && at.take && !focus){navigation?.release();context.current.setCameraMode('manual');followed=null;}
      entityLayer.applyEdge(context.current.sim.edge??[]);entityLayer.update(step,now,geometry.group);
      navigation?.update(step);
      rts.update(step);
      hover.update(now);
      // Orbit click-to-centre glide; any other mode or a new gesture cancels it.
      if(viewing!=='manual'||context.current.manualNavigation!=='orbit')orbitPivot.cancel();
      orbitPivot.update(step,camera,controls.target);
      atmosphereSeconds+=step;try{atmosphere.update({seconds:atmosphereSeconds,dt:step,daylight:light.daylight,camera,eden:!!expansion&&!past.current,reducedMotion:!!reducedMotionQuery?.matches,clock:shown.current?.datetime??null});}catch{}
      if(controls.enabled)controls.update();
      if(context.current.cameraMode==='follow'&&focus){renderer.domElement.dataset.cameraShot='follow:'+(soulId?s.conn.replica.souls.get(soulId)?.entityId??'':thingId??'');const offset=followView.resolve(controls.target,camera.position.clone().sub(controls.target),visualObstructionRoots(),step);camera.position.copy(controls.target).add(offset);camera.lookAt(controls.target);}
      const area = visibleViewport(host.clientWidth, host.clientHeight, context.current.viewportInsets);
      if (context.current.cameraMode === 'broadcast') {
        const shot = broadcast.sample(at.entities, records, base, at.tick, dt, area?.aspect ?? camera.aspect, now / 1000, step,visualObstructionRoots());
        if (shot?.pose) {
          camera.position.fromArray(shot.pose.position);
          controls.target.fromArray(shot.pose.target);
          logicalFov = shot.pose.fov;
          camera.lookAt(controls.target);
          renderer.domElement.dataset.cameraShot = shot.shot ?? '';
        }
      }
      refreshCameraGround();
      if(cameraGround.apply(camera,scene)>0&&!(viewing==='manual'&&context.current.manualNavigation==='free'))camera.lookAt(controls.target);  // never underground (Gene)
      if(context.current.cameraMode==='manual'&&expansion?.group.visible)constrainOfficeGuardCamera(camera,controls.target,officeGuardFrom,expansion.officeGuards);
      authoredBoundaries.bind(publication);if(context.current.cameraMode==='manual')authoredBoundaries.constrain(camera,controls.target,officeGuardFrom,at.tick);
      composeVisibleViewport(camera, host.clientWidth, host.clientHeight, context.current.viewportInsets, logicalFov);
      if(fadeOverride.size&&!past.current){const states=new Map<string,FadingState>(),now=performance.now();
        for(const soul of s.conn.replica.souls.values()){const v=fadeOverride.get(soul.name.toLowerCase());if(!v)continue;if(!fadeSince.has(soul.id))fadeSince.set(soul.id,now);
          states.set(soul.id,v==='beam'?{idleMinutes:60,beamedAt:fadeSince.get(soul.id)}:v==='reclaim'?{idleMinutes:0,reclaimedAt:fadeSince.get(soul.id)}:{idleMinutes:Number(v)||0});}
        fading.setStates(states);}
      balloonRide.pose(id=>people?.bodyObject(id)??null);
      fading.update(performance.now(),atmosphereSeconds,soulId=>{const id=s.conn.replica.souls.get(soulId)?.entityId,p=id?at.entities[id]?.p:null;return p?new THREE.Vector3(p[0],p[1],p[2]):null;},
        soulId=>{const id=s.conn.replica.souls.get(soulId)?.entityId;return id?people?.bodyObject(id)??null:null;});
      // Idle life: breathing, weight shifts, head turns, speaking nods (render-time only).
      idleSouls.length=0;if(!past.current){const nowMs=Date.now();for(const soul of s.conn.replica.souls.values()){const e=at.entities[soul.entityId];if(!e)continue;
        idleSouls.push({id:soul.id,root:people?.bodyObject(soul.entityId)??null,p:e.p,yaw:e.yaw??0,activity:String(e.activity??'idle'),speaking:speeches.some(sp=>sp.speaker===soul.id&&nowMs-sp.at<4000),attention:attentionTargets.get(soul.id)});}}
      if(refresh)idleLife.forget(new Set(idleSouls.map(s=>s.id)));
      idleLife.apply(idleSouls,atmosphereSeconds,step,!!reducedMotionQuery?.matches);
      people?.setSpeaking(new Set(idleSouls.flatMap(x=>{const id=x.speaking?s.conn.replica.souls.get(x.id)?.entityId:undefined;return id?[id]:[];})));  // speakers talk with their hands (library clips)
      placeActivity.update(shown.current.datetime,atmosphereSeconds,light.daylight===null?0:1-light.daylight,!!expansion);
      // Shadow pass: no sub-texel plant stems, no small far casters (render-time only).
      if(expansion){shadowDetail??=new WorldShadowDetail(expansion.group);shadowDetail.apply(camera.position);}
      eyes?.aim();
      expansion?.wallFrames.update(camera,expansion.group.visible&&!past.current);
      if(!eyes?.render())renderer.render(scene,camera);
      if(diagnostics.enabled)diagnostics.sample(renderer,now,performance.now()-now,expansion?.wallFrames.inspection()??[]);
      shadowDetail?.restore();
      idleLife.restore();
      fading.restore();
      balloonRide.restore();
      if(!eyes)labels2d.render(scene,camera);
      // CSS2D owns each projected transform. Read all boxes before writing our
      // separate CSS translation, so packing never changes a body's anchor.
      const hostBox = labels2d.domElement.getBoundingClientRect(), boxes: LabelBox[] = [];
      for (const [id,l] of labels) {
        if (!l.obj.visible || l.obj.element.style.display === 'none') continue;
        const b=l.obj.element.getBoundingClientRect();
        boxes.push({id,x:b.left-hostBox.left-l.offset.dx,y:b.top-hostBox.top-l.offset.dy,width:b.width,height:b.height,selected:id===soulId,previous:l.offset});
      }
      const placements=placeWorldLabels(boxes,area);
      for(const [id,l] of labels) {
        const offset=placements.get(id), el=l.obj.element;
        el.style.visibility=offset?'visible':'hidden';
        if(!offset) continue;
        l.offset=offset; el.style.translate=`${offset.dx}px ${offset.dy}px`;
        l.leader.style.height=`${Math.hypot(offset.dx,offset.dy)}px`;
        l.leader.style.transform=`rotate(${Math.atan2(offset.dx,-offset.dy)}rad)`;
      }
      if (!renderer.getContext().isContextLost()) drawnTick.current = at.take ? at.tick : null;
      // A paused seek is a discrete displayed moment. Publish its first drawn
      // frame immediately; moving playback retains the existing 250ms cadence.
      const pausedFrameChanged = !!past.current && !past.current.playing &&
        latestViewerState.current?.shownTick !== drawnTick.current;
      if (refresh || pausedFrameChanged) {
        const points:SpeechAnchorPoint[]=context.current.publishSpeechAnchors?souls.flatMap(soul=>{
          const label=labels.get(soul.id),rec=records[soul.entityId];
          if(!at.take||!at.entities[soul.entityId]||!label?.obj.visible||rec?.kind!=='human')return [];
          const rendered=!!floaters.object(soul.entityId)||!!people?.bodyObject(soul.entityId)||!!standIns.getObjectByName(soul.entityId);
          return [{soulId:soul.id,point:label.obj.position.toArray() as [number,number,number],rendered}];
        }):[];
        let speechAnchors:ReturnType<typeof projectSpeechAnchors>|undefined;
        if(context.current.publishSpeechAnchors)try{
          speechVisibility.prepare(visualObstructionRoots());
          speechAnchors=projectSpeechAnchors(points,camera,host.clientWidth,host.clientHeight,area,p=>speechVisibility.score({position:camera.position.toArray(),target:[...p],fov:camera.fov},['anchor'],{anchor:{p:[...p],yaw:0,points:[[...p]]}})===1);
        }catch{speechAnchors=[];}finally{speechVisibility.reset();}
        emitState(viewerPresentation({room:context.current.edenExpansion?exploreRoom(camera.position.toArray(),EDEN_VIEWER_PLACES,s.conn.replica.souls,at.entities):null,assetDownloads:downloads.snapshot(),soulIds:[...groupSelection],
          drawnTick: drawnTick.current, history: !!past.current, playing: past.current?.playing ?? false,
          cameraMode: viewing, manualNavigation: context.current.manualNavigation, inputOwned: navigation?.inputOwned ?? false, soulId, entityId: soulId ? s.conn.replica.souls.get(soulId)?.entityId ?? null : thingId,
          loading: context.current.loading || (!at.take && renderer.domElement.dataset.sceneBinding!=='unavailable'),
          unavailableReason: context.current.graphicsUnavailable ?? sceneReason ?? (!area ? 'The world view is covered by controls or has no visible area.' : brokenTake ? 'A recorded moment could not be drawn.' : frameGap ? 'No recording covers that moment; displaying the nearest recorded frame.' : !at.take ? 'Waiting for a recorded world frame.' : connectionLost(s.conn) && !past.current ? 'Reconnecting; displaying the last recorded frame.' : null),
          speechAnchors,
        }));
      }

    };

    // click (not drag) to select a Soul, a thing, or a kin
    const inspectHover=(t:HoverTarget)=>{if(t.kind==='soul'){setPlaceCard(null);context.current.setThing(null);context.current.onSelect(t.id);}else if(t.kind==='object'){setPlaceCard(null);context.current.onSelect(null);context.current.setThing(t.id);}else setPlaceCard(t);};
    const hover=new WorldHover(renderer.domElement,camera,{scene:()=>scene,roots:()=>[floaters.root,kin.view.root,standIns,...(people?.pickingRoots()??[]),...visualObstructionRoots()],entity:id=>{const soul=[...context.current.sim.conn.replica.souls.values()].find(s=>s.entityId===id);if(soul)return {kind:'soul',id:soul.id,name:soul.name,point:new THREE.Vector3(...(shown.current.entities[id]?.p??[0,0,0])),detail:doingText(soul.doing,shown.current.entities[id]?.activity,soul.id)};const rec=records[id];return rec?{kind:'object',id,name:rec.label??plainWords(rec.def),point:new THREE.Vector3(...(shown.current.entities[id]?.p??[0,0,0])),detail:plainWords(shown.current.entities[id]?.activity)}:null;},places:()=>entityLayer.active?[]:expansion?EDEN_VIEWER_PLACES.filter(p=>p.kind!=='world'):Object.entries(shown.current.take?.finalState.regions??{}).flatMap(([id,r])=>r.polygon&&r.label?[{id,name:r.label,polygon:r.polygon}]:[]),available:()=>drawnTick.current!==null&&!context.current.loading&&!context.current.graphicsUnavailable,inspect:inspectHover});scene.add(hover.marker);
    const onDown = (e: PointerEvent) => { groupSelection.clear(); orbitPivot.cancel(); down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null; };
    const onMove = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) context.current.setCameraMode(cameraModeAfterGesture(context.current.cameraMode));
    };
    const onWheel = () => context.current.setCameraMode(cameraModeAfterGesture(context.current.cameraMode));
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
      down = null;
      if (e.altKey || flagModeRef.current) return;  // a flag drop (onFlagClick), not a selection: no place card over the god panel
      const target=hover.pick(e.clientX,e.clientY);if(target)inspectHover(target);else{setPlaceCard(null);context.current.setThing(null);}

    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: true });
    renderer.domElement.addEventListener('pointerup', onUp);
    animate();

    return () => {
      eyes?.dispose();
      games.dispose();
      platformDraw.dispose();
      hover.dispose();
      portraits.dispose();
      orbitPivot.dispose();
      rts.dispose();
      atmosphere.dispose();
      speechLayer.dispose();
      fading.dispose();
      balloonRide.dispose();
      placeActivity.dispose();
      try{nativeSocialDraw.dispose(people);}catch{problem('Some fixture scenery could not be released.');}
      clearConnectedDressing();
      abort.abort();
      cancelAnimationFrame(frame);
      resize.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('click', onFlagClick);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      navigation?.dispose();
      controls.dispose();
      controlsApi.current = null;
      for (const l of labels.values()) { scene.remove(l.obj); l.obj.element.remove(); }
      labels.clear();
      people?.dispose();
      if(entityWorldFramed)entityView.current={eye:camera.position.toArray(),target:controls.target.toArray()};  // entity worlds only: the camera survives the scene re-mount
      edgeItems.dispose();entityLayer.dispose();
      diagnostics.dispose();placePreviews.dispose();bodyModels.dispose();
      floaters.dispose();
      kin.dispose();
      sceneRequest++;sceneHistory.dispose();
      draco.dispose();
      clearSocialPaths();
      planting?.dispose();planting=null;
      clearNewcomerMarkers();restMarkers?.dispose();restMarkers=null;publication=null;
      clearExpansion();cameraGround.bindGround(undefined);geometry.dispose();
      light.dispose();
      ring.geometry.dispose(); (ring.material as THREE.Material).dispose();
      standInGeometry.dispose(); standInMaterial.dispose();
      resources.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      labels2d.domElement.remove();
    };
  }, [sim.conn.welcome?.worldId, sim.conn.welcome?.epoch]);

  useEffect(() => {
    if (!graphicsUnavailable && shown.current.take) return;
    emitState(viewerPresentation({assetDownloads:assetProgress, drawnTick: drawnTick.current,
      history: !!past.current, playing: past.current?.playing ?? false, cameraMode, manualNavigation, inputOwned: controlsApi.current?.inputOwned() ?? false,
      soulId: selected, entityId: selected ? sim.conn.replica.souls.get(selected)?.entityId ?? null : thing,
      loading: !graphicsUnavailable, unavailableReason: graphicsUnavailable ?? 'Waiting for a recorded world frame.',
    }));
  }, [graphicsUnavailable, cameraMode, selected, thing, loading, mode, manualNavigation,assetProgress]);

  // stop any rewind fetch when the view goes away
  useEffect(() => () => { seeking.current?.abort(); if (commitTimer.current) clearTimeout(commitTimer.current); }, []);

  // ------------------------------------------------------------------ rewind
  const dt = dtOf(sim), now = serverNow(sim), hour = HOUR_SECONDS / dt;
  const p = past.current;
  const shownTick = p ? p.tick : (now ?? 0);
  const lo = Math.max(0, Math.floor((now ?? 0) - hour)), hi = Math.max(lo + 1, Math.floor(now ?? 0));
  const goLive = () => { controlsApi.current?.releaseInput(); seeking.current?.abort(); seeking.current = null; setLoading(false); past.current = null; setDraft(null); setNote(null); setMode('live'); };
  const seek = async (wanted: number) => {
    controlsApi.current?.releaseInput();
    const s = context.current.sim, at = serverNow(s), dts = dtOf(s);
    if (at === null) { setDraft(null); return; }
    // An explicit seek chooses a recorded moment even inside the live buffer.
    // The separate live command resumes the delayed live view.
    const tick = Math.floor(Math.max(at - HOUR_SECONDS / dts, Math.min(at, wanted), 0));
    // A newer buffered seek also supersedes an older network request.
    seeking.current?.abort(); seeking.current = null;
    const cur = past.current;
    if (cur && cur.chunks[0].fromTick <= tick && tick <= cur.chunks.at(-1)!.toTick) { cur.tick = tick; setLoading(false); setDraft(null); setNote(null); refreshPlayback(n=>n+1); return; }
    const ctl = new AbortController();
    seeking.current = ctl;
    setLoading(true); setNote(null);
    try {
      const { from, to } = rewindWindow(tick, 1 / dts);
      const got = await fetchChunks(from, to, MAX_PAST_CHUNKS, ctl.signal);
      if (ctl.signal.aborted) return;
      if (!got.length) { setNote('Nothing was recorded at that moment. Try a later time.'); return; }
      past.current = { tick: Math.max(got[0].fromTick, Math.min(got.at(-1)!.toTick, tick)), playing: cur?.playing ?? true, chunks: got, extending: false, retryAt: 0, ended: false };
      setMode('past');
      if (got[0].fromTick > tick + 5 / dts) setNote('The recording starts later than that, so this is the earliest moment kept.');
    } catch {
      if (!ctl.signal.aborted) setNote('That moment could not be loaded. Check the connection and try again.');
    } finally {
      if (seeking.current === ctl) { seeking.current = null; setLoading(false); setDraft(null); }
    }
  };
  const commit = (v: number) => { if (commitTimer.current) clearTimeout(commitTimer.current); commitTimer.current = null; void seek(v); };
  const onSlide = (v: number) => {
    setDraft(v);
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => commit(v), 600); // keyboard and slow drags; a release commits at once
  };
  const togglePlay = () => { if (past.current) { past.current.playing = !past.current.playing; setNote(null); setMode('past'); refreshPlayback(n=>n+1); } };
  playbackCommands.current = { seek, live: goLive, setPlaying: (playing) => {
    if (!past.current) return false;
    past.current.playing = playing; setNote(null); setMode('past'); refreshPlayback(n=>n+1); return true;
  } };
  useEffect(() => {
    const handle = createWorldViewerHandle(() => ({
      setCameraMode: mode => { controlsApi.current?.releaseInput(); context.current.setCameraMode(mode); },
      setManualNavigation: mode => { controlsApi.current?.releaseInput(); context.current.setManualNavigation(mode); context.current.setCameraMode('manual'); },
      resetView: () => controlsApi.current?.reset() ?? false,
      releaseInput: () => controlsApi.current?.releaseInput(),
      moveCamera: delta => controlsApi.current?.move(delta) ?? false,
      framePlace: place => controlsApi.current?.framePlace(place) ?? false,
      frameSouls: ids => controlsApi.current?.frameSouls(ids) ?? false,
      frameAll: () => { context.current.setCameraMode('manual'); controlsApi.current?.overview(); },
      placePreview: place => controlsApi.current?.placePreview(place) ?? Promise.resolve(null),
      focusSelected: () => { const found = controlsApi.current?.focusSelected() ?? false; if (found) context.current.setCameraMode('manual'); return found; },
      hasSoul: id => context.current.sim.conn.replica.souls.has(id),
      hasEntity: id => !!shown.current.entities[id],
      select: (soulId, entityId) => { context.current.onSelect(soulId); context.current.setThing(entityId); },
      seek: tick => playbackCommands.current?.seek(tick) ?? Promise.resolve(),
      live: () => playbackCommands.current?.live(),
      setPlaying: playing => playbackCommands.current?.setPlaying(playing) ?? false,
    }));
    onViewerHandle?.(handle);
    return () => onViewerHandle?.(null);
  }, [onViewerHandle]);

  // ------------------------------------------------------------------ what is shown
  const s = shown.current, r = sim.conn.replica, state = sim.conn.stats.state;
  const takes = takesOf(sim);
  const status = state !== 'open' ? 'Reconnecting to the world…' : !takes ? 'Waiting for the world…' : null;
  const when = clockText(s.datetime);
  const ago = p && now !== null ? agoText((now - p.tick) * dt) : '';
  const soul = selected ? r.souls.get(selected) : undefined;
  const cards = cardsAt(sim.plays, s.tick);
  return (
    <section className="wide world-viewer" data-world-viewer="1" style={embedded ? { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative' } : { position: 'relative' }}>
      {entityWorld && <GodPanel flagMode={flagMode} onFlagMode={setFlagMode} />}
      {!hideControls && <div className="row">
        <h2 style={{ margin: 0 }}>World</h2>
        {mode === 'live' && !status ? <span className="ok"><b>● Live</b></span> : null}
        {mode === 'past' ? <span className="warn"><b>⏪ Replaying {ago}</b></span> : null}
        {status ? <span className="dim">{status}</span> : null}
        {when ? <span className="dim">world time {when}</span> : null}
        <span style={{ marginLeft: 'auto' }} />
        <button aria-pressed={cameraMode === 'broadcast'} className={cameraMode === 'broadcast' ? 'on primary' : ''} onClick={() => setCameraMode('broadcast')}>Broadcast</button>
        <button aria-pressed={cameraMode === 'manual'} onClick={() => { setCameraMode('manual'); controlsApi.current?.overview(); }}>see everything</button>
        <button disabled={!selected && !thing} aria-pressed={follow} className={follow ? 'on primary' : ''} onClick={() => setCameraMode(follow ? 'manual' : 'follow')}>{follow ? 'following' : 'follow selected'}</button>
      </div>}
      {!hideControls && <div className="row">
        <button aria-pressed={cameraMode==='manual'&&manualNavigation==='orbit'} onClick={()=>{controlsApi.current?.releaseInput();setManualNavigation('orbit');setCameraMode('manual');}}>Orbit camera</button>
        <button aria-pressed={cameraMode==='manual'&&manualNavigation==='free'} onClick={()=>{controlsApi.current?.releaseInput();setManualNavigation('free');setCameraMode('manual');}}>Free camera</button>
        <button onClick={()=>controlsApi.current?.reset()}>Reset camera</button>
        <button onClick={()=>controlsApi.current?.releaseInput()}>Release camera controls</button>
        {cameraMode==='manual'&&<span className="dim">WASD moves horizontally · arrows look left/right/up/down · Q/E down/up (F/R also) · Shift faster · Alt precision. Drag to orbit; right-drag to look in place. Free camera also supports touch look. Escape releases.</span>}
        {cameraMode==='manual'&&manualNavigation==='free' && <>
          {([['Forward',{forward:.5}],['Back',{forward:-.5}],['Left',{right:-.5}],['Right',{right:.5}],['Up',{up:.5}],['Down',{up:-.5}]] as [string,CameraMove][]).map(([label,delta])=><button key={label} onClick={()=>controlsApi.current?.move(delta)}>{label}</button>)}
        </>}
      </div>}
      <div className="world-viewport" style={{ position: 'relative', height: embedded ? undefined : 540, flex: embedded ? 1 : undefined, minHeight: 0, width: '100%', overflow: 'hidden', borderRadius: 4 }}>
        <div className="world-canvas-host" ref={mount} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
        {placeCard&&<article className="world-place-card" aria-label="Selected place"><button className="panel-close" aria-label="Close place" onClick={()=>setPlaceCard(null)}>×</button><h2>{placeCard.name}</h2>{placeCard.detail&&<p>{placeCard.detail}</p>}<p>{[...sim.conn.replica.souls.values()].filter(soul=>{const e=shown.current.entities[soul.entityId];return e&&Math.hypot(e.p[0]-placeCard.point.x,e.p[2]-placeCard.point.z)<placeCard.radius;}).map(soul=>soul.name).join(', ')||'No Souls nearby in the current frame.'}</p><button onClick={()=>{controlsApi.current?.framePoint(placeCard.point,placeCard.radius);setPlaceCard(null);}}>Go to</button></article>}
        {sceneryNotice&&<div role="status" className="world-scenery-note" style={{position:'absolute',left:12,bottom:12,maxWidth:'min(420px, calc(100% - 24px))',padding:'8px 12px',background:'rgba(238,233,221,.94)',color:'#463f32',borderRadius:6,pointerEvents:'none'}}>{sceneryNotice}</div>}
        {(soul ? !hideSoulInfo : !!thing) && <InfoPanel sim={sim} soul={soul ?? null} thing={thing} shown={s} card={soul ? cardText(cards.get(soul.id)) : ''} past={!!p} close={() => { setThing(null); if (soul) onSelect(null); }} />}
      </div>
      {!hideControls && <div className="row">
        <span className={mode === 'live' ? 'ok' : 'warn'} style={{ minWidth: 96 }}>{mode === 'live' ? 'Live now' : `Earlier · ${ago}`}</span>
        <input type="range" aria-label="Look back over the last hour" min={lo} max={hi} step={1} disabled={now === null}
          value={Math.max(lo, Math.min(hi, draft ?? shownTick))}
          onChange={(e) => onSlide(Number(e.target.value))}
          onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key.startsWith('Page')) commit(Number((e.target as HTMLInputElement).value)); }} />
        <button disabled={now === null || loading} onClick={() => commit((draft ?? shownTick) - 60 / dt)}>back 1 min</button>
        {p ? <button onClick={togglePlay}>{p.playing ? 'pause' : 'play'}</button> : null}
        {p || loading ? <button className="primary" onClick={goLive}>back to live</button> : null}
      </div>}
      {loading ? <p className="dim">Loading that moment…</p> : null}
      {draft !== null && !loading && now !== null ? <p className="dim">Release to watch from {agoText((now - draft) * dt)}.</p> : null}
      {note ? <p className="warn">{note}</p> : null}
      {problems.map((x) => <p key={x} className="warn">{x}</p>)}
      {!hideControls && <p className="dim">Drag to look around, scroll to zoom, click a person or an object to see what it is. The slider looks back over the last hour; “back to live” returns to now.</p>}
    </section>
  );
}

const panelStyle: React.CSSProperties = { position: 'absolute', top: 10, left: 10, zIndex: 2, maxWidth: 300, background: 'var(--panel)', color: 'var(--fg)', border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px', boxShadow: '0 2px 10px rgba(0,0,0,.18)' };

/** A small card about the selected Soul or thing, from what is on screen and the world's public state. */
function InfoPanel({ sim, soul, thing, shown, card, past, close }: { sim: Sim; soul: PublicSoul | null; thing: string | null; shown: Shown; card: string; past: boolean; close(): void }) {
  const head = (title: string) => <div className="row" style={{ margin: 0 }}><b style={{ flex: 1 }}>{title}</b><button aria-label="close" onClick={close}>×</button></div>;
  const regions = shown.take?.finalState.regions;
  if (soul) {
    const e = shown.entities[soul.entityId], where = e ? placeOf(e.p, regions) : null;
    const doing = past ? activityWords(e?.activity,soul.id) : doingText(soul.doing,e?.activity,soul.id);
    return (
      <div className="world-selection-info world-soul-info" style={panelStyle}>
        {head(soul.name)}
        <div className="dim">{soul.description}</div>
        {doing ? <div>{doing}</div> : null}
        {card ? <div className="dim">last card {card}</div> : null}
        {where ? <div className="dim">in {where}</div> : null}
        {!e ? <div className="dim">not in view at this moment</div> : null}
      </div>
    );
  }
  if (!thing) return null;
  if (thing.startsWith('kin:')) {
    return <div className="world-selection-info world-object-info" style={panelStyle}>{head(plainWords(thing.split(':')[2]) || 'kin')}<div className="dim">A kin floating by. Part of the scenery, not a Soul.</div></div>;
  }
  const take = shown.take, rec = take?.finalState.entities[thing] ?? (take?.entities0?.[thing] as Entity | undefined), e = shown.entities[thing];
  const k = sim.kernel?.things[thing];
  const name = k?.name ?? rec?.label ?? plainWords(rec?.def ?? thing);
  const kind = rec ? (rec.kind === 'human' ? 'a person' : plainWords(rec.def)) : '';
  const where = placeOf(e?.p ?? rec?.pose.p ?? [0, 0, 0], regions);
  const st = (e?.state ?? {}) as { contents?: Entity['contents'] | null };
  const contents = st.contents ?? rec?.contents;
  const phase = e?.phase ?? rec?.phase;
  return (
    <div className="world-selection-info world-object-info" style={panelStyle}>
      {head(name)}
      {kind && kind !== name.toLowerCase() ? <div className="dim">{kind}</div> : null}
      {where ? <div className="dim">in {where}</div> : null}
      {contents ? <div>{contents.fraction > 0 ? `${plainWords(contents.food)}, ${Math.round(contents.fraction * 100)}% full` : 'empty'}</div> : null}
      {phase ? <div>{plainWords(String(phase))}</div> : null}
      {k ? Object.entries(k.states).slice(0, 6).map(([key, v]) => <div key={key}><span className="dim">{plainWords(key)}</span> {typeof v === 'object' ? JSON.stringify(v) : String(v)}</div>) : null}
      {!rec && !e ? <div className="dim">Not here at this moment.</div> : null}
    </div>
  );
}
