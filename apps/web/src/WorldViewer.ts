import type {WorldPlaceId} from './WorldPlaces.ts';
import type { WorldCameraMode } from './WorldBroadcast.ts';
export type { ViewportInsets } from './WorldViewport.ts';
import type { CameraMove, ManualNavigation } from './WorldNavigation.ts';
import type {WorldSpeechAnchor} from './WorldSpeechAnchors.ts';
export type {WorldSpeechAnchor} from './WorldSpeechAnchors.ts';
export type { CameraMove, ManualNavigation } from './WorldNavigation.ts';

/** Additive presentation boundary v1. Commands never steer or pause the world. */
export interface WorldViewerHandle {
  setCameraMode(mode: WorldCameraMode): void;
  frameAll(): void;
  /** Select and frame the speakers together; presentation only. */
  frameSouls?(ids:readonly string[]):boolean;
  /** Local current-world scenery tour; no simulation command or selection. */
  framePlace?(place:WorldPlaceId): boolean;
  focusSelected(): boolean;
  selectSoul(id: string | null): boolean;
  selectEntity(id: string | null): boolean;
  seek(tick: number): Promise<void>;
  live(): void;
  setPlaying(playing: boolean): boolean;
  setManualNavigation?(mode: ManualNavigation): void;
  resetView?(): boolean;
  releaseInput?(): void;
  moveCamera?(delta: CameraMove): boolean;
}
export interface WorldViewerState {
  /** Last successfully drawn recording tick, not the server's latest tick. */
  shownTick: number | null;
  presentation: 'live' | 'history';
  cameraMode: WorldCameraMode;
  /** Canonical selection only. Decorative kin inspection stays inside the viewer. */
  selection: { soulId: string | null; entityId: string | null; soulIds?:readonly string[] };
  playback: 'live' | 'playing' | 'paused';
  loading: boolean;
  unavailableReason: string | null;
  /** All movement keys/pointers are scoped to the viewport, never document keys. */
  inputScope: 'viewport-pointer';
  manualNavigation?: ManualNavigation;
  inputOwned?: boolean;
  /** Last drawn frame, canvas-local CSS pixels. Empty during unavailable views.
   * Scenery/fixture occlusion, not other actors or CSS label packing. */
  speechAnchors?: readonly WorldSpeechAnchor[];
}
export const WORLD_VIEWER_CAPABILITIES = Object.freeze({
  version: 1, manualOrbit: true, manualFree: 'controls-preview' as const, movablePivot: 'pan-focus-preview' as const,
  reset: true, releaseInput: true, keyboardNavigation: 'controls-preview' as const,
  followOrbitZoom: true, viewportInsets: 'projection-preview' as const, broadcast: 'preview' as const,
});

/** A replaceable port keeps a published handle fresh across React renders. */
export interface WorldViewerPort {
  setCameraMode(mode: WorldCameraMode): void;
  frameAll(): void;
  /** Select and frame the speakers together; presentation only. */
  frameSouls?(ids:readonly string[]):boolean;
  /** Local current-world scenery tour; no simulation command or selection. */
  framePlace?(place:WorldPlaceId): boolean;
  focusSelected(): boolean;
  hasSoul(id: string): boolean;
  hasEntity(id: string): boolean;
  select(soulId: string | null, entityId: string | null): void;
  seek(tick: number): Promise<void>;
  live(): void;
  setPlaying(playing: boolean): boolean;
  setManualNavigation?(mode: ManualNavigation): void;
  resetView?(): boolean;
  releaseInput?(): void;
  moveCamera?(delta: CameraMove): boolean;
}
export function createWorldViewerHandle(current: () => WorldViewerPort): WorldViewerHandle {
  return {
    setCameraMode: mode => { if (mode === 'broadcast' || mode === 'follow' || mode === 'manual') current().setCameraMode(mode); },
    frameAll: () => current().frameAll(),
    frameSouls: ids => current().frameSouls?.(ids) ?? false,
    framePlace: place => current().framePlace?.(place) ?? false,
    focusSelected: () => current().focusSelected(),
    selectSoul: id => { const p = current(); if (id !== null && !p.hasSoul(id)) return false; p.select(id, null); return true; },
    selectEntity: id => { const p = current(); if (id !== null && !p.hasEntity(id)) return false; p.select(null, id); return true; },
    seek: tick => Number.isFinite(tick) ? current().seek(tick) : Promise.resolve(),
    live: () => current().live(),
    setPlaying: playing => current().setPlaying(playing),
    setManualNavigation: mode => { if(mode==='free'||mode==='orbit')current().setManualNavigation?.(mode); },
    resetView: () => current().resetView?.() ?? false,
    releaseInput: () => current().releaseInput?.(),
    moveCamera: delta => current().moveCamera?.(delta) ?? false,
  };
}
export function viewerPresentation(input: {
  drawnTick: number | null; history: boolean; playing: boolean;
  cameraMode: WorldCameraMode; soulId: string | null; entityId: string | null;
  loading: boolean; unavailableReason: string | null;
  manualNavigation?: ManualNavigation; inputOwned?: boolean; soulIds?:readonly string[];
  speechAnchors?: readonly WorldSpeechAnchor[];
}): WorldViewerState {
  return {
    shownTick: input.drawnTick !== null && Number.isFinite(input.drawnTick) ? input.drawnTick : null,
    presentation: input.history ? 'history' : 'live', cameraMode: input.cameraMode,
    selection: { ...(input.soulIds?.length?{soulIds:[...input.soulIds]}:{}),soulId: input.soulId, entityId: !input.soulId && input.entityId?.startsWith('kin:') ? null : input.entityId },
    playback: input.history ? input.playing ? 'playing' : 'paused' : 'live',
    loading: input.loading, unavailableReason: input.unavailableReason,
    inputScope: 'viewport-pointer',
    ...(input.manualNavigation ? {manualNavigation:input.manualNavigation} : {}),
    ...(input.inputOwned!==undefined ? {inputOwned:input.inputOwned} : {}),
    ...(input.speechAnchors!==undefined ? {speechAnchors:input.drawnTick===null||!Number.isFinite(input.drawnTick)||input.loading||input.unavailableReason?[]:input.speechAnchors.map(a=>({...a}))} : {}),
  };
}
/** A gesture adjusts Follow; it only takes over an automatic Broadcast shot. */
export const cameraModeAfterGesture = (mode: WorldCameraMode): WorldCameraMode => mode === 'broadcast' ? 'manual' : mode;
