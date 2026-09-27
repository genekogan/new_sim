// "Replay take" control for /studio (2026). Hidden unless the take manifest
// lists at least one take. Mouse-only transport: take select, play/pause,
// scrubber with the take's key moments, speed, engine-camera toggle, current
// shot/steps and the take's diagnostics log.
import { useEffect, useState } from 'react';
import { TAKE_MANIFEST_URL, type TakeManifest, type TakeManifestEntry } from '../engine-view/take-replay.ts';
import type { TakeHost } from './take-host.ts';

const SPEEDS = [0.5, 1, 2, 4, 8, 16];
const MOMENT_LABELS: Record<string, string> = { carry: 'first carry', held: 'frames held', deck: 'deck on', visitor: 'visitor on deck' };
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function TakePanel({ host }: { host: () => TakeHost | null }) {
  const [takes, setTakes] = useState<TakeManifestEntry[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    fetch(TAKE_MANIFEST_URL, { signal: abort.signal })
      .then((r) => (r.ok ? (r.json() as Promise<TakeManifest>) : null))
      .then((m) => setTakes(m?.takes ?? []))
      .catch(() => setTakes([])); // no manifest → no control
    return () => abort.abort();
  }, []);

  const replay = host()?.replay() ?? null;
  useEffect(() => {
    if (!selected) return;
    const id = setInterval(() => setTick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [selected]);

  if (!takes.length) return null;
  const entry = takes.find((t) => t.id === selected);
  const choose = async (id: string) => {
    setSelected(id);
    setLoading(!!id);
    await host()?.open(takes.find((t) => t.id === id) ?? null);
    setLoading(false);
  };
  const diag = replay?.diagnostics();
  const steps = replay?.activeSteps() ?? [];
  return (
    <div className={`take-panel ${replay ? 'open' : ''}`} data-testid="take-panel">
      <div className="take-row">
        <label className="take-picker">
          Replay take
          <select aria-label="Replay take" value={selected} onChange={(e) => void choose(e.target.value)}>
            <option value="">— off —</option>
            {takes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {loading && <span className="take-loading" role="status">Loading take…</span>}
        {replay && (
          <div className="take-banner" role="note">
            HYPOTHETICAL build scenario — not historical
          </div>
        )}
        {replay && diag && (
          <details className="take-diagnostics">
            <summary>
              Diagnostics: {diag.violations} violations · {diag.failed} failed · {diag.blocked} blocked waits
            </summary>
            <ol>
              {diag.lines.slice(-6).map((l, i) => (
                <li key={i} className={l.kind}>
                  <b>{clock(l.t)}</b> {l.text}
                </li>
              ))}
              {!diag.lines.length && <li>No diagnostics yet at this time.</li>}
            </ol>
          </details>
        )}
      </div>
      {replay && entry && (
        <>
          <div className="take-row take-transport">
            <button aria-label={replay.playing ? 'Pause take' : 'Play take'} onClick={() => {
              if (!replay.playing && replay.t >= replay.duration) replay.seek(0);
              replay.playing = !replay.playing;
              setTick((n) => n + 1);
            }}>
              {replay.playing ? 'Pause' : 'Play'}
            </button>
            <span className="take-time" aria-label="Take time">
              {clock(replay.t)} / {clock(replay.duration)}
            </span>
            <div className="take-scrub">
              <input
                type="range"
                aria-label="Take time scrubber"
                min={0}
                max={replay.duration}
                step={0.1}
                value={replay.t}
                onChange={(e) => { replay.seek(Number(e.target.value)); setTick((n) => n + 1); }}
              />
              <div className="take-moments">
                {Object.entries(entry.moments).map(([k, t]) => (
                  <button key={k} style={{ left: `${(t / replay.duration) * 100}%` }} title={`${MOMENT_LABELS[k] ?? k} · ${clock(t)}`} aria-label={`Jump to ${MOMENT_LABELS[k] ?? k}`} onClick={() => { replay.seek(t); setTick((n) => n + 1); }} />
                ))}
              </div>
            </div>
            <label>
              Speed
              <select aria-label="Take speed" value={replay.speed} onChange={(e) => { replay.speed = Number(e.target.value); setTick((n) => n + 1); }}>
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
            </label>
            <label className="take-camera">
              <input type="checkbox" aria-label="Engine camera" checked={replay.engineCamera} onChange={(e) => { replay.engineCamera = e.target.checked; setTick((n) => n + 1); }} />
              Engine camera
            </label>
          </div>
          <div className="take-row take-now">
            <span>{replay.engineCamera ? `Shot: ${replay.shotLabel()}` : 'Your camera · orbit freely'}</span>
            <span>{steps.length ? steps.map((s) => s.label ?? s.id).join(' · ') : replay.t >= replay.duration ? 'Build complete' : 'Between steps'}</span>
            <span className="take-note">Fork of Mars 2026 · generic people, not attendees · {entry.entities} entities</span>
          </div>
        </>
      )}
    </div>
  );
}
