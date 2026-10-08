import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {ImportCredits} from './ImportCredits.tsx';
import { createPortal } from 'react-dom';
import type { ViewportInsets, WorldViewerHandle, WorldViewerState } from './WorldViewer.ts';
import { arrivalStage, heldLabel } from './viewer-arrival.ts';

/** Edge overlays are measured against World's actual viewport, never the window. */
export function useViewerInsets(root: RefObject<HTMLDivElement | null>, visible: boolean, layout: string): ViewportInsets {
  const [insets, setInsets] = useState<ViewportInsets>({});
  useLayoutEffect(() => {
    const frame = root.current, viewport = frame?.querySelector('.world-viewport');
    if (!frame || !viewport) return;
    const overlays = [...frame.querySelectorAll<HTMLElement>('.human-panel, .world-hud, .viewer-camera, .viewer-history, .dialogue-dock')];
    const measure = () => {
      const v = viewport.getBoundingClientRect();
      const origin = frame.getBoundingClientRect().top;
      const hud = frame.querySelector<HTMLElement>('.world-hud');
      if (hud) {
        const bottom = `${Math.ceil(hud.getBoundingClientRect().bottom - origin)}px`;
        if (frame.style.getPropertyValue('--app-hud-bottom') !== bottom) frame.style.setProperty('--app-hud-bottom', bottom);
      }
      const camera = frame.querySelector<HTMLElement>('.viewer-camera');
      if (camera) {
        const bottom = `${Math.ceil(camera.getBoundingClientRect().bottom - origin)}px`;
        if (frame.style.getPropertyValue('--app-camera-bottom') !== bottom) frame.style.setProperty('--app-camera-bottom', bottom);
      }
      const next: ViewportInsets = {};
      const phone = matchMedia('(max-width: 700px)').matches;
      if (!frame.classList.contains('has-advanced')) for (const el of overlays) {
        if (el.hidden || (el.matches('.human-panel') && !visible) || el.dataset.inset === 'none' || (el.matches('.viewer-history') && el.closest('.world-hud'))) continue;
        const p = el.getBoundingClientRect();
        if (!p.width || !p.height || p.right <= v.left || p.left >= v.right || p.bottom <= v.top || p.top >= v.bottom) continue;
        // DLG2: the dialogue dock is a left column (desktop) or bottom sheet (phone); keep Souls out from under it.
        const edge = el.matches('.human-panel, .dialogue-dock') ? phone ? 'bottom' : el.matches('.dialogue-dock') ? 'left' : 'right'
          : el.matches('.viewer-history') ? 'bottom'
          : 'top';
        const covered = edge === 'bottom' ? v.bottom - Math.max(v.top, p.top)
          : edge === 'right' ? v.right - Math.max(v.left, p.left)
          : edge === 'left' ? Math.min(v.right, p.right) - v.left
          : Math.min(v.bottom, p.bottom) - v.top;
        next[edge] = Math.max(next[edge] ?? 0, Math.ceil(covered));
      }
      setInsets(old => JSON.stringify(old) === JSON.stringify(next) ? old : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport); overlays.forEach(el => observer.observe(el));
    window.addEventListener('resize', measure); measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [root, visible, layout]);
  return insets;
}

/** VF2 (Gene): one "your camera" (drag orbits, right-drag pans, scroll zooms to the pointer, WASD/QE/RF keys;
 * WorldRtsCamera), Broadcast as an on/off pill beside "● Live · time", Follow from the Soul card with a
 * "Following … ×" chip, and one camera help card (opened from the header's camera button). */
export function ViewerFrame({ handle, state, dt, navigationOpen, onNavigationChange, worldTime, connected = true, connecting = false, worldName, followName, slots }: { handle: WorldViewerHandle | null; state: WorldViewerState | null; dt: number; navigationOpen: boolean; onNavigationChange: (open: boolean) => void; onNavigationOpen?: () => void; worldTime?: string; connected?: boolean; connecting?: boolean; worldName?: string; followName?: string | null; slots?: { status: HTMLElement | null; camera: HTMLElement | null } }) {
  const [cameraNote, setCameraNote] = useState('');
  // DLG3 (Gene): the history scrub ("Back 1 min") is hidden for now; `?rewind` keeps it reachable for tests.
  const [rewind] = useState(() => { try { return new URLSearchParams(location.search).has('rewind'); } catch { return false; } });
  const help = useRef<HTMLDivElement>(null);
  const unavailable = !!state?.unavailableReason;
  const current = state?.shownTick != null && !state.loading && !unavailable;
  // VF1: arriving = no frame drawn yet. It gets one calm card (not warnings); a drawn view that stops being
  // current says why only once that lasts (transient gaps never flash), and the pill never says "Held".
  const reason = state?.unavailableReason ?? null;
  const blocked = !!reason && /graphics|3D/.test(reason);
  const drawnOnce = useRef(false);
  if (state?.shownTick != null && !state.loading) drawnOnce.current = true;
  const arriving = !blocked && (!state || state.shownTick == null || (state.loading && !drawnOnce.current));
  const [settledReason, setSettledReason] = useState<string | null>(null);
  useEffect(() => {
    if (!reason || arriving) { setSettledReason(null); return; }
    const id = setTimeout(() => setSettledReason(reason), blocked || /covered by controls/.test(reason) ? 0 : 4000);
    return () => clearTimeout(id);
  }, [reason, arriving, blocked]);
  const [arrivalShown, setArrivalShown] = useState(true);
  useEffect(() => { if (arriving) { setArrivalShown(true); return; } const id = setTimeout(() => setArrivalShown(false), 700); return () => clearTimeout(id); }, [arriving]);
  const lost = !connected && !arriving;
  const live = current && state?.presentation === 'live' && connected;
  const status = blocked && state?.shownTick == null ? 'View unavailable'
    : arriving || state!.loading ? 'Loading…'
    : lost ? 'Reconnecting…'
    : settledReason ? heldLabel(settledReason)
    : state!.presentation === 'history' ? 'Recorded' : 'Live';
  const statusClass = arriving || state?.loading ? 'loading' : !lost && !settledReason && current && connected ? 'ok' : 'warn';
  const kind = state?.cameraMode === 'follow' ? 'follow' : state?.cameraMode === 'manual' ? 'yours' : 'broadcast';
  // Touch gestures on phones/tablets, read when the help is shown (the window may have been resized since).
  const touch = navigationOpen && (() => { try { return matchMedia('(pointer: coarse)').matches || matchMedia('(max-width: 700px)').matches; } catch { return false; } })();
  const close = () => { onNavigationChange(false); setCameraNote(''); };
  // VF6 (Gene: "if you touch WASD you break out of that mode so it's intuitive"): a short cue when Follow starts,
  // and a shorter one when a move key (or ×) hands the camera back to you.
  const [followCue, setFollowCue] = useState<'' | 'follow' | 'free'>('');
  const lastKind = useRef(kind);
  useEffect(() => {
    const was = lastKind.current; lastKind.current = kind;
    if (kind === was) return;
    const cue = kind === 'follow' ? 'follow' : was === 'follow' && kind === 'yours' ? 'free' : '';
    setFollowCue(cue); if (!cue) return;
    const id = setTimeout(() => setFollowCue(''), cue === 'follow' ? 5000 : 2500); return () => clearTimeout(id);
  }, [kind]);
  const coarse = (() => { try { return matchMedia('(pointer: coarse)').matches; } catch { return false; } })();
  useEffect(() => {
    if (!navigationOpen) return;
    handle?.releaseInput?.(); help.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onNavigationChange(false); } };
    addEventListener('keydown', key); return () => removeEventListener('keydown', key);
  }, [navigationOpen, handle, onNavigationChange]);
  const toBroadcast = () => { setCameraNote(''); handle?.setCameraMode('broadcast'); };
  const yourCamera = () => { setCameraNote(''); if (handle?.setManualNavigation) handle.setManualNavigation('orbit'); else handle?.setCameraMode('manual'); };
  // VF3 (Gene): the status ("● Live · time", and any reason it is not live) and the camera chip live in the top bar
  // (Shell's slots); nothing sits at the bottom of the screen.
  const statusBlock = <div className="viewer-history" data-viewer-navigation={state?.manualNavigation ?? ''} data-viewer-input={state?.inputOwned ?? false} data-viewer-mode={state?.cameraMode ?? ''} data-viewer-presentation={state?.presentation ?? ''} data-viewer-tick={state?.shownTick ?? ''} data-viewer-selection={state?.selection.soulId ?? state?.selection.entityId ?? ''} data-viewer-ready={!!handle}>
      <div className="row viewer-status">
        <span className={statusClass} data-viewer-status data-viewer-live={live} title={state?.shownTick == null ? undefined : `Recorded tick ${state.shownTick.toFixed(0)}`}>{status}</span>
        {state?.shownTick != null && !arriving && worldTime && <span className="world-time">{worldTime.includes(' · ') ? <><span className="world-day">{worldTime.split(' · ')[0]} </span>{worldTime.split(' · ').slice(1).join(' · ')}</> : worldTime}</span>}
        {settledReason && !lost && <span role="status" className="warn viewer-reason" title={settledReason}>{settledReason}</span>}
        {rewind && <button disabled={!handle || state?.shownTick == null || state.loading} onClick={() => { if (state?.shownTick != null) void handle?.seek(Math.max(0, state.shownTick - 60 / dt)); }}>Back 1 min</button>}
        {state?.presentation === 'history' && <>
          <button onClick={() => handle?.setPlaying(state.playback !== 'playing')}>{state.playback === 'playing' ? 'Pause recording' : 'Play recording'}</button>
          <button onClick={() => handle?.live()}>Return to live</button>
        </>}
      </div>
    </div>;
  const cameraBlock = !arriving && state?.presentation !== 'history' ? <div className="viewer-camera-chip" data-camera={kind}>
        {kind === 'follow'
          ? <span className="viewer-following"><span className="viewer-following-label">Following <b>{followName ?? 'a Soul'}</b></span><button type="button" aria-label="Stop following" title="Stop following" onClick={yourCamera}><span aria-hidden="true">×</span></button></span>
          : <button type="button" className="viewer-broadcast" aria-pressed={kind === 'broadcast'} title={kind === 'broadcast' ? 'Broadcast is directing the camera. Turn off to take it yourself.' : 'Let Broadcast direct the camera again'}
              onClick={() => kind === 'broadcast' ? yourCamera() : toBroadcast()}>{kind === 'broadcast' ? <><span className="viewer-broadcast-dot" aria-hidden="true" />Broadcast</> : <><span className="viewer-broadcast-icon" aria-hidden="true">↺</span>Back to broadcast</>}</button>}
      </div> : null;
  return <>
    {arrivalShown && !blocked && <div className="viewer-arrival" data-done={!arriving} role="status" aria-live="polite">
      <div className="viewer-arrival-card"><span className="viewer-arrival-spinner" aria-hidden="true" />
        <div><p className="viewer-arrival-title">Arriving in {worldName ?? 'the world'}</p>
          <p className="viewer-arrival-stage">{arriving ? `${arrivalStage(reason, connecting)}…` : 'Ready'}</p></div></div>
    </div>}
    {followCue && !arriving && <div className="viewer-follow-hint" role="status" aria-live="polite" data-cue={followCue}>{followCue === 'follow'
      ? coarse ? <>Following <b>{followName ?? 'a Soul'}</b> · drag to look around · × to stop</> : <>Following <b>{followName ?? 'a Soul'}</b> · drag to look around, scroll to zoom · press <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to look around freely</>
      : <>Your camera · <b>Back to broadcast</b> is top left</>}</div>}
    {navigationOpen && <div className="camera-help-scrim" onPointerDown={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="camera-help" role="dialog" aria-modal="true" aria-labelledby="camera-help-title" tabIndex={-1} ref={help}>
        <button type="button" className="camera-help-close" aria-label="Close" title="Close (Esc)" onClick={close}><span aria-hidden="true">×</span></button>
        <h2 id="camera-help-title">Camera</h2>
        <p><b>Broadcast</b> directs itself, cutting between Souls and whatever is happening. Any drag, scroll or move key gives you the camera; <b>Back to broadcast</b> (top left, beside Live) returns it.</p>
        {touch ? <><h3>Touch</h3>
          <ul className="camera-keys"><li><span>One finger</span><span>orbit</span></li><li><span>Two fingers</span><span>pan · pinch to zoom</span></li><li><span>Double-tap</span><span>fly there</span></li><li><span>Tap a name plate</span><span>meet that Soul</span></li></ul></> : <><h3>Mouse</h3>
          <ul className="camera-keys"><li><span>Drag</span><span>orbit around the centre</span></li><li><span>Right-drag</span><span>pan</span></li><li><span>Scroll</span><span>zoom toward the pointer</span></li><li><span>Double-click</span><span>fly there</span></li><li><span>Click a name plate</span><span>meet that Soul</span></li></ul>
          <h3>Keyboard</h3>
          <ul className="camera-keys"><li><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> · arrows</span><span>move</span></li><li><span><kbd>Q</kbd><kbd>E</kbd></span><span>rotate</span></li><li><span><kbd>R</kbd><kbd>F</kbd></span><span>raise · lower</span></li><li><span><kbd>Shift</kbd></span><span>faster</span></li><li><span>Right mouse + <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>fly</span></li></ul></>}
        <p className="camera-help-follow"><b>Follow</b> a Soul from its card: the camera stays on it. Drag orbits around it, scroll zooms{touch ? ', pinch zooms' : ', right-drag raises or lowers the camera'}. A move key or × stops following, right where you are.</p>
        <div className="camera-help-actions">
          <button type="button" disabled={kind === 'broadcast' || !handle} onClick={() => { toBroadcast(); close(); }}>Back to broadcast</button>
          <button type="button" disabled={kind === 'broadcast' || !current || !handle?.resetView} onClick={() => setCameraNote(handle?.resetView?.() ? '' : 'The current view could not be reset.')}>Reset view</button>
        </div>
        {cameraNote && <p role="status">{cameraNote}</p>}
        <ImportCredits />
      </div>
    </div>}
    {slots ? <>{slots.status && createPortal(statusBlock, slots.status)}{slots.camera && createPortal(cameraBlock, slots.camera)}</>
      : <div className="viewer-bottom">{statusBlock}{cameraBlock}</div>}
  </>;
}
