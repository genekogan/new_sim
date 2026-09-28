// "Replay take" control for /studio (every year) and the header's "Watch it being built" picker
// (docs/engineering/STUDIO_REPLAY.md). Manifest-driven: every entry of `takes` and `otherYears` in
// public/engine/takes/manifest.json whose `year` is the studio's year, so a newly recorded take appears without a
// code change; year-build entries (`isYearBuild`) are also offered under the year picker. Mouse-only transport:
// take select, play/pause, scrubber with the take's key moments, speed, engine-camera toggle, current shot/steps,
// the take's refusal / blocked-wait log as it happens, the final-frame checks and camera direction.
import { useEffect, useState } from 'react';
import { TAKE_MANIFEST_URL, isYearBuild, type TakeManifest, type TakeManifestEntry } from '../engine-view/take-replay.ts';
import type { TakeHost } from './take-host.ts';
import { DirectPanel } from './direct-panel';

const SPEEDS = [0.5, 1, 2, 4, 8, 16, 64];
const MOMENT_LABELS: Record<string, string> = {
  carry: 'first carry',
  held: 'frames held',
  deck: 'deck on',
  visitor: 'visitor on deck',
  beam: 'first beam hung',
  bay: 'bay standing',
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const shortLabel = (l: string) => l.replace(/\s*\((HYPOTHETICAL|historical)[^)]*\)\s*$/i, '');
const ticksOf = (t: TakeManifestEntry) => t.ticks ?? Math.round(t.duration / 0.05);
/** Take length for the picker: "9 min", "34 min", "1 h 38 min". */
const span = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);
/** Picker text: label · year · length · ticks · hypothetical / historical. */
export const takeOptionText = (t: TakeManifestEntry) =>
  `${shortLabel(t.label)} · ${t.year} · ${span(t.duration)} · ${ticksOf(t).toLocaleString('en-US')} ticks · ${t.hypothetical ? 'hypothetical' : 'historical'}`;

const manifests = new Map<string, Promise<TakeManifest | null>>();
/** Every manifest entry recorded for `year` (`takes` + `otherYears`), in manifest order. */
export function useYearTakes(year: number) {
  const [takes, setTakes] = useState<TakeManifestEntry[]>([]);
  useEffect(() => {
    let live = true;
    let p = manifests.get(TAKE_MANIFEST_URL);
    if (!p) {
      p = fetch(TAKE_MANIFEST_URL).then((r) => (r.ok ? (r.json() as Promise<TakeManifest>) : null)).catch(() => null);
      manifests.set(TAKE_MANIFEST_URL, p);
    }
    void p.then((m) => { if (live) setTakes([...(m?.takes ?? []), ...(m?.otherYears ?? [])].filter((t) => t.year === year)); });
    return () => { live = false; };
  }, [year]);
  return takes;
}

/** Re-render on host changes (open / close / checks / directed) and every 100 ms while a take is open. */
function useHost(host: () => TakeHost | null) {
  const [, setTick] = useState(0);
  const h = host();
  useEffect(() => h?.subscribe(() => setTick((n) => n + 1)), [h]);
  const open = !!h?.entry();
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setTick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [open]);
  return { host: h, bump: () => setTick((n) => n + 1) };
}

/** Header control under the year picker: the year's year-build takes ("Watch it being built"). Hidden when none. */
export function BuildPicker({ host, year }: { host: () => TakeHost | null; year: number }) {
  const builds = useYearTakes(year).filter(isYearBuild);
  const { host: h } = useHost(host);
  if (!builds.length) return null;
  const current = h?.entry();
  const value = current && builds.some((b) => b.id === current.id) ? current.id : '';
  return (
    <label className="year-picker build-picker">
      Watch it being built
      <select aria-label="Watch it being built" value={value} onChange={(e) => void host()?.open(builds.find((b) => b.id === e.target.value) ?? null)}>
        <option value="">— off —</option>
        {builds.map((b) => (
          <option key={b.id} value={b.id}>
            {takeOptionText(b)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TakePanel({ host, year }: { host: () => TakeHost | null; year: number }) {
  const takes = useYearTakes(year);
  const { host: h, bump } = useHost(host);
  if (!takes.length) return null;
  const replay = h?.replay() ?? null;
  const entry = h?.entry() ?? null;
  const building = !!entry && isYearBuild(entry);
  const diag = replay?.diagnostics();
  const steps = replay?.activeSteps() ?? [];
  const checks = h?.checks() ?? null;
  const done = !!replay && replay.t >= replay.duration - 1e-6;
  const track = replay?.trackInfo();
  return (
    <div className={`take-panel ${replay ? 'open' : ''}`} data-testid="take-panel">
      <div className="take-row">
        <label className="take-picker">
          {building ? 'Watch it being built' : 'Replay take'}
          <select aria-label="Replay take" value={entry?.id ?? ''} onChange={(e) => void host()?.open(takes.find((t) => t.id === e.target.value) ?? null)}>
            <option value="">— off —</option>
            {takes.map((t) => (
              <option key={t.id} value={t.id}>
                {takeOptionText(t)}
              </option>
            ))}
          </select>
        </label>
        {h?.loading() && <span className="take-loading" role="status">Loading take…</span>}
        {replay && entry && (
          <div className="take-banner" role="note">
            {entry.hypothetical ? 'HYPOTHETICAL build scenario — not historical' : 'Historical record'}
          </div>
        )}
        {replay && diag && (
          <details className="take-diagnostics">
            <summary>
              Diagnostics: {diag.violations} violations · {diag.failed} refused / failed · {diag.blocked} blocked waits
            </summary>
            <ol>
              {diag.lines.slice(-12).map((l, i) => (
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
              bump();
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
                onChange={(e) => { replay.seek(Number(e.target.value)); bump(); }}
              />
              <div className="take-moments">
                {Object.entries(entry.moments).map(([k, t]) => (
                  <button key={k} style={{ left: `${(t / replay.duration) * 100}%` }} title={`${MOMENT_LABELS[k] ?? k} · ${clock(t)}`} aria-label={`Jump to ${MOMENT_LABELS[k] ?? k}`} onClick={() => { replay.seek(t); bump(); }} />
                ))}
              </div>
            </div>
            <label>
              Speed
              <select aria-label="Take speed" value={replay.speed} onChange={(e) => { replay.speed = Number(e.target.value); bump(); }}>
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
            </label>
            <label className="take-camera">
              <input type="checkbox" aria-label="Engine camera" checked={replay.engineCamera} onChange={(e) => { replay.engineCamera = e.target.checked; bump(); }} />
              Engine camera
            </label>
            <label className="take-camera-track">
              Camera
              <select aria-label="Camera track" value={track?.id ?? ''} onChange={(e) => { h!.useCamera(e.target.value); bump(); }}>
                {h!.cameras().map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="take-row take-now">
            <span>{replay.engineCamera ? `${track && !track.own ? 'Directed' : 'Shot'}: ${replay.shotLabel()}` : 'Your camera · orbit freely'}</span>
            <span>{steps.length ? steps.map((s) => s.label ?? s.id).join(' · ') : done ? 'Build complete' : 'Between steps'}</span>
            <span className="take-note">
              {building ? `Fork of Mars ${year}${h?.hiddenAssembly() ? ` · ${h.hiddenAssembly()} rebuilt from the piles` : ''}` : `Fork of Mars ${year}`} · generic people, not attendees · {entry.entities} entities
            </span>
          </div>
          {diag && (
            <ol className="take-row take-log" role="log" aria-label="Take log">
              {diag.lines.slice(-2).map((l, i) => (
                <li key={`${l.t}-${i}`} className={l.kind}>
                  <b>{clock(l.t)}</b> {l.kind === 'blocked' ? 'blocked' : l.kind === 'failed' ? 'refused' : 'violation'} · {l.text}
                </li>
              ))}
              {!diag.lines.length && <li>No refusals or blocked waits yet.</li>}
            </ol>
          )}
          <div className="take-row take-checks" aria-label="Final state check">
            {!checks ? (
              <span>Final state: checking…</span>
            ) : (
              <>
                <span className={checks.hash.ok && checks.frame.ok ? 'ok' : 'bad'} title={`replayed ${checks.hash.replayed}\nrecorded ${checks.hash.recorded}\nmanifest ${checks.hash.manifest ?? '—'}\nlast frame vs final state: max ${checks.frame.maxMm} mm`}>
                  {checks.hash.ok && checks.frame.ok ? '✓' : '✗'} final state {checks.hash.replayed.slice(0, 8)}… {checks.hash.ok ? '= recorded' : '≠ recorded'} · last frame {checks.frame.ok ? '=' : '≠'} final state ({checks.frame.maxMm} mm)
                </span>
                {checks.canonical && (
                  <span className={checks.canonical.ok ? 'ok' : 'bad'} title={checks.canonical.failures.map((f) => `${f.node} ${f.kind} ${f.phase ?? ''} ${f.mm} mm ${f.deg}°`).join('\n')}>
                    {checks.canonical.ok ? '✓' : '✗'} {checks.canonical.atPose} / {checks.canonical.total} frames + beams at the {checks.canonical.checkpoint} canonical pose (≤ 1 cm, 1°; max {checks.canonical.maxMm} mm)
                    {checks.canonical.outside ? ` · ${checks.canonical.outside} of ${checks.canonical.assembly}'s outside this take` : ''}
                  </span>
                )}
              </>
            )}
          </div>
          <DirectPanel host={h!} replay={replay} onChange={bump} />
        </>
      )}
    </div>
  );
}
