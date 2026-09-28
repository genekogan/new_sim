// Transport for a chapter set (STUDIO_REPLAY.md "Chapter sets: playback"): play / pause, the set clock, a scrubber over
// the whole set, speed, engine camera (each chapter's own planned camera), the chapter bar (A · D0 · … with the chapter
// on screen highlighted and the continuity check at every seam), the log on the set clock, and the whole-set checks.
import type { ChapterSetReplay } from './chapter-set.ts';
import { setClock } from './chapter-set.ts';

const SPEEDS = [0.5, 1, 2, 4, 8, 16, 64];
const h8 = (h: string) => `${h.slice(0, 8)}…`;

/** Seam status of chapter k's start (k = 0: the set's start state): ✓ / ✗ from the worker, … while it reads. */
function seam(r: ChapterSetReplay, k: number) {
  const c = r.checks[k];
  const prev = k ? r.set.chapters[k - 1].id : null;
  const cur = r.set.chapters[k].id;
  if (!c) return { state: 'wait', mark: '…', text: prev ? `${prev} → ${cur}: checking…` : `${cur} start: checking…`, title: '' };
  const mark = c.start.ok ? '✓' : '✗';
  const text = prev ? `${prev} → ${cur}: ${mark} ${h8(c.start.expected)} (first frame ${c.start.ok ? '=' : '≠'} ${prev}'s final state)` : `${cur} starts from the pile yard ${h8(c.start.expected)} ${mark}`;
  return { state: c.start.ok ? 'ok' : 'bad', mark, text, title: [`expected ${c.start.expected}`, `take baseline ${c.start.baseline}`, `manifest startHash ${c.start.manifest ?? '—'}`, ...c.start.problems].join('\n') };
}

export function SetTransport({ r, onChange }: { r: ChapterSetReplay; onChange: () => void }) {
  const ch = r.chapter();
  const n = r.set.chapters.length;
  const diag = r.diagnostics();
  const steps = r.activeSteps();
  const done = r.t >= r.duration - 1e-6;
  const here = seam(r, ch.k);
  const seams = r.set.chapters.map((_, k) => seam(r, k));
  const known = r.checks.filter(Boolean).length;
  const okSeams = r.checks.filter((c) => c?.start.ok).length;
  const f = r.final;
  const pin = /\(([^()]*\+[^()]*)\)/.exec(r.set.label)?.[1];
  return (
    <>
      <div className="take-row take-transport">
        <button aria-label={r.playing ? 'Pause take' : 'Play take'} onClick={() => {
          if (!r.playing && r.t >= r.duration) r.seek(0);
          r.playing = !r.playing;
          onChange();
        }}>
          {r.playing ? 'Pause' : 'Play'}
        </button>
        <span className="take-time" aria-label="Take time">
          {setClock(r.t)} / {setClock(r.duration)}
        </span>
        <div className="take-scrub">
          <input type="range" aria-label="Take time scrubber" min={0} max={r.duration} step={0.1} value={r.t} onChange={(e) => { r.seek(Number(e.target.value)); onChange(); }} />
          <ol className="set-chapters" aria-label="Chapters">
            {r.set.chapters.map((c, k) => (
              <li key={c.id} style={{ flexGrow: c.ticks }} className={k === ch.k ? 'current' : undefined} aria-current={k === ch.k ? 'step' : undefined}>
                {k > 0 && (
                  <span className={`set-seam ${seams[k].state}`} title={`${seams[k].text}\n${seams[k].title}`} aria-label={`Continuity ${seams[k].text}`}>
                    {seams[k].mark}
                  </span>
                )}
                <button title={`${k + 1}/${n} ${c.id}: ${c.label} · ${setClock(r.startOf(k))}–${setClock(c.to * r.dt)}`} aria-label={`Chapter ${c.id}: ${c.label}`} onClick={() => { r.seek(r.startOf(k)); onChange(); }}>
                  {c.id}
                </button>
              </li>
            ))}
          </ol>
        </div>
        <label>
          Speed
          <select aria-label="Take speed" value={r.speed} onChange={(e) => { r.speed = Number(e.target.value); onChange(); }}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        <label className="take-camera" title={`each chapter's own planned shot list · now ${r.trackInfo().id}`}>
          <input type="checkbox" aria-label="Engine camera" checked={r.engineCamera} onChange={(e) => { r.engineCamera = e.target.checked; onChange(); }} />
          Engine camera
        </label>
        {r.waiting !== null && <span className="take-loading" role="status">Loading chapter {r.set.chapters[r.waiting].id}…</span>}
      </div>
      <div className="take-row take-now">
        <span aria-label="Chapter now">
          Chapter {ch.k + 1}/{n} · {ch.id}: {ch.label} · {setClock(ch.local)} in
        </span>
        <span className={`set-seam-now ${here.state}`} aria-label="Chapter start check" title={here.title}>
          {here.text}
        </span>
      </div>
      <div className="take-row take-now">
        <span>{r.engineCamera ? `Shot: ${r.shotLabel()}` : 'Your camera · orbit freely'}</span>
        <span>{steps.length ? steps.map((s) => s.label ?? s.id).join(' · ') : done ? 'Build complete' : 'Between steps'}</span>
      </div>
      <ol className="take-row take-log" role="log" aria-label="Take log">
        {diag.lines.slice(-2).map((l, i) => (
          <li key={`${l.t}-${i}`} className={l.kind}>
            <b>{setClock(l.t)}</b> {l.kind === 'blocked' ? 'blocked' : l.kind === 'failed' ? 'refused' : 'violation'} · {l.text}
          </li>
        ))}
        {!diag.lines.length && <li>No refusals or blocked waits yet.</li>}
      </ol>
      <div className="take-row take-checks" aria-label="Final state check">
        <span className={known < n ? '' : okSeams === n ? 'ok' : 'bad'} aria-label="Continuity check" title="each chapter's first frame = the previous chapter's final state (hashes, entities0, first frame within ½ mm / ½ mrad)">
          {known < n ? `Continuity: ${okSeams} / ${known} chapter starts ✓ (reading ${known}/${n}…)` : `${okSeams === n ? '✓' : '✗'} continuity: ${okSeams} / ${n} chapter starts`}
        </span>
        {!f ? (
          <span>Final state: checking…</span>
        ) : (
          <>
            <span className={f.hash.ok && f.frame.ok ? 'ok' : 'bad'} title={`replayed ${f.hash.replayed}\nset ${f.hash.set}\nlast frame vs final state: max ${f.frame.maxMm} mm`}>
              {f.hash.ok && f.frame.ok ? '✓' : '✗'} final state {h8(f.hash.replayed)} {f.hash.ok ? '=' : '≠'} {pin ? `${pin} pin` : "the set's"} · last frame {f.frame.ok ? '=' : '≠'} final state ({f.frame.maxMm} mm)
            </span>
            {f.canonical && (
              <span className={f.canonical.ok ? 'ok' : 'bad'} title={[`parts by role: ${Object.entries(f.canonical.parts.byRole).map(([k, v]) => `${k} ${v}`).join(', ')}`, ...f.canonical.failures].join('\n')}>
                {f.canonical.ok ? '✓' : '✗'} {f.canonical.frames.atPose} frames + beams + {f.canonical.parts.atPose} parts at the {f.canonical.checkpoint} canonical pose
                {f.canonical.ok ? '' : ` (of ${f.canonical.frames.total} + ${f.canonical.parts.total})`} (≤ 1 cm, 1°; max {Math.max(f.canonical.frames.maxMm, f.canonical.parts.maxMm)} mm)
              </span>
            )}
          </>
        )}
        {r.error && <span className="bad" role="alert">{r.error}</span>}
      </div>
    </>
  );
}
