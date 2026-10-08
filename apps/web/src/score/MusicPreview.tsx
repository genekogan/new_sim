import { useEffect, useRef, useState } from 'react';
import { createPreview, type Preview, type PreviewState, type ScoreTone } from './preview.mjs';
import './MusicPreview.css';

type Props = { tone: ScoreTone; worldId: string; worldName: string; onControlsFocus?: () => void };
/** Injected local sample only. Boot/distribution and canonical shared cues remain separate. */
export function MusicPreview(props: Props) { return <LocalPreview key={props.worldId} {...props} />; }
function LocalPreview({ tone, worldName, onControlsFocus }: Props) {
  const player = useRef<Preview | null>(null);
  const [piece, setPiece] = useState('starfield');
  const [state, setState] = useState<PreviewState>({phase:'idle',nodeCount:0,ownsPlayback:false,muted:false,volume:0.5});
  useEffect(() => {
    let active = true;
    let preview: Preview;
    try {
      preview = createPreview(tone, {onState: next => { if (active) setState(next); }});
      player.current = preview; setState(preview.snapshot());
    } catch { setState(s => ({...s,phase:'unavailable'})); return; }
    return () => { active = false; preview.dispose(); if (player.current === preview) player.current = null; };
  }, [tone]);
  const busy = state.phase === 'starting';
  const running = busy || state.phase === 'playing';
  const status = state.phase === 'starting' ? 'Preparing music…'
    : state.phase === 'playing' ? state.muted ? 'Playing · muted' : 'Playing local sample'
    : state.phase === 'unavailable' ? 'Music could not start. You can try again.'
    : state.phase === 'gesture-required' ? 'Press Listen to enable audio.' : 'Ready when you are.';
  return <section className="music-preview" aria-label="Music preview" onFocusCapture={onControlsFocus}>
    <div className="music-title"><strong>Music preview</strong><span>{worldName}</span></div>
    <p className="music-note">An 8-second local sample. Shared world music is still in development.</p>
    <label>Piece<select aria-label="Piece" value={piece} disabled={busy} onChange={event => { player.current?.stop(); setPiece(event.target.value); }}>
      <option value="starfield">Starfield</option><option value="zoning-board">Zoning Board</option>
    </select></label>
    <div className="music-actions">
      <button disabled={busy || !player.current} onClick={() => { const p = player.current; if (p) void p.start({pieceId:piece,seed:7,durationSeconds:8}).catch(() => { if (player.current === p) setState(s => ({...s,phase:'unavailable'})); }); }}>Listen</button>
      <button disabled={!running} onClick={() => player.current?.stop()}>Stop</button>
      <button aria-pressed={state.muted} onClick={() => player.current?.setMuted(!state.muted)}>{state.muted ? 'Unmute' : 'Mute'}</button>
    </div>
    <label>Volume<input aria-label="Music volume" type="range" min="0" max="1" step="0.05" value={state.volume} onChange={event => player.current?.setVolume(Number(event.target.value))} /></label>
    <p role="status" className="music-status">{status}</p>
  </section>;
}
