// GODUI (Gene, 2026-10-11): the owner's lightning-bolt button right of the Explore bar, on new worlds only. Its panel
// holds the god pairing (moved here from the god panel's Start tab) and three weather buttons that call the same god
// env ops as the CLI (POST /v1/god/env, POST /v1/god/strike), so they land in the ledger like the CLI's. Visitors and
// the old worlds see nothing.
import { useCallback, useEffect, useRef, useState } from 'react';
import { worldKey } from '../world-path.ts';
import { Markdown } from './markdown.tsx';
import * as G from './god-api.ts';
import './god-panel.css';

const PAIRED_KEY = `sim.godPaired:${worldKey}`;
type Sim = { controls?: { target: { x: number; z: number } } };
/** Where the camera looks (the orbit target), for a strike near the view's centre. */
const viewCentre = (): [number, number] | null => { const t = (window as unknown as { __simEntity?: Sim }).__simEntity?.controls?.target; return t ? [Math.round(t.x * 10) / 10, Math.round(t.z * 10) / 10] : null; };

export function GodBolt() {
  const [status, setStatus] = useState<G.Status | null>(null);
  const hashCode = location.hash.startsWith('#godpair/') ? decodeURIComponent(location.hash.slice('#godpair/'.length)) : null;
  const [open, setOpen] = useState(!!hashCode);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  const pendingSeen = useRef(0);
  const owner = status?.you === 'owner' || status?.you === 'god';

  const refresh = useCallback(async () => { const s = await G.getStatus(); if (s) setStatus(s); }, []);
  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 4000); return () => clearInterval(t); }, [refresh]);
  // a new pairing request opens the panel (the agent tells its human to approve it here)
  useEffect(() => { const n = status?.pending.length ?? 0; if (owner && n > pendingSeen.current) setOpen(true); pendingSeen.current = n; }, [status, owner]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  if (!status || !owner) return null;
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key); setNote(null);
    try { await fn(); setNote({ text: ok }); await refresh(); }
    catch (e) { setNote({ text: String((e as Error).message), bad: true }); }
    finally { setBusy(null); }
  };
  const approve = (code: string) => run(code, async () => {
    await G.approve(code); try { localStorage.setItem(PAIRED_KEY, '1'); } catch { /* storage disabled */ }
    if (hashCode === code) history.replaceState(null, '', location.pathname + location.search);
  }, `Approved. Your agent is now this world's god.`);
  const env = (body: unknown) => G.god('/v1/god/env', { method: 'POST', body: JSON.stringify(body) });
  const rain = () => run('rain', () => env({ weather: { kind: 'rain', intensity: 0.8 }, note: 'weather' }), 'Rain.');
  const haze = () => run('haze', () => env({ weather: { kind: 'fog', intensity: 0.6 }, note: 'weather' }), 'Haze.');
  const lightning = () => run('lightning', async () => {
    await env({ weather: { kind: 'storm', intensity: 0.8 }, note: 'weather' });
    const at = viewCentre();
    await G.god('/v1/god/strike', { method: 'POST', body: JSON.stringify(at ? { at } : {}) });
  }, 'Lightning.');
  const paired = (status.agents ?? 0) > 0;

  return (
    <span ref={root} className="god-bolt">
      <button type="button" className="god-bolt-open" data-god-bolt="1" aria-haspopup="dialog" aria-expanded={open} aria-label="God controls" title="God controls" onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11.5 2 4.5 11.2h4.6L8 18l7.5-9.6h-4.7z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>
        {status.pending.length ? <span className="gp-badge">{status.pending.length}</span> : null}
      </button>
      {open && (
        <div className="gp-card god-bolt-panel" role="dialog" aria-label="God controls" data-god-bolt-panel="1">
          {hashCode && !status.pending.some((p) => p.code === hashCode) && <p className="gp-bad">Pairing request <code>{hashCode}</code> is not pending (expired, or already approved).</p>}
          {status.pending.length > 0 && (
            <div className="gp-pairs" data-pairing="1">
              <b>Your agent asks to be this world's god</b><span className="gp-dim">Check the code matches what your agent shows, then approve.</span>
              {status.pending.map((p) => (
                <div key={p.code} className="gp-row">
                  <span><code className="gp-code-big">{p.code}</code> {p.agent} <span className="gp-dim">({Math.max(1, Math.round(p.expiresIn / 60))} min)</span></span>
                  <button data-approve={p.code} className="gp-btn gp-primary" disabled={busy === p.code} onClick={() => approve(p.code)}>Approve</button>
                </div>
              ))}
            </div>
          )}
          <div className="gp-next" data-next-step={paired ? 'build' : 'pair'}>
            {paired
              ? <><b>Your agent is this world's god.</b><p>Ask it for things: “a cottage by the pond”, “hills to the east”, “undo that”. Invite friends from your account menu (Copy invite link).</p><p className="gp-dim">Another agent or folder? Give it the same line:</p></>
              : <><b>Next: give your agent this line</b><p className="gp-dim">Paste it to Claude Code, Codex or any agent you use. It sets itself up and shows a code here: press Approve.</p></>}
            <Markdown source={'```paste-to-your-agent\n' + G.godPrompt(status.base) + '\n```'} />
          </div>
          <div className="god-bolt-weather" data-weather="1">
            <button className="gp-btn" data-weather-kind="rain" disabled={!!busy} onClick={rain}>Rain</button>
            <button className="gp-btn" data-weather-kind="lightning" disabled={!!busy} onClick={lightning}>Lightning</button>
            <button className="gp-btn" data-weather-kind="haze" disabled={!!busy} onClick={haze}>Haze</button>
          </div>
          {note && <p className={note.bad ? 'gp-bad' : 'gp-ok'}>{note.text}</p>}
        </div>
      )}
    </span>
  );
}
