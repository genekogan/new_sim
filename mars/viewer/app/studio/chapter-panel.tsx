// Transport for a chapter set (STUDIO_REPLAY.md "Chapter sets: playback"): play / pause, the set clock, a scrubber over
// the whole set, speed, engine camera (each chapter's own planned camera), the chapter bar (A · D0 · … with the chapter
// on screen highlighted and the continuity check at every seam), the log on the set clock, and the whole-set checks.
// W48: the shot hold (each engine-camera shot ≥ HOLD_S on screen) and Direct camera on the chapter on screen.
import type { ChapterSetReplay } from './chapter-set.ts';
import { HOLD_S, setClock } from './chapter-set.ts';
import type { TakeHost } from './take-host.ts';
import { DirectPanel } from './direct-panel';

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

export function SetTransport({ r, host, onChange }: { r: ChapterSetReplay; host: TakeHost; onChange: () => void }) {
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
  const track = r.trackInfo();
  const seg = r.engineCamera && track.own ? r.holdSeg() : null;
  const held = !!seg && r.t >= seg.end - 1e-6; // on screen past its planned end
  // Direct camera acts on the chapter on screen; a track compiled against another chapter still names that chapter
  const dc = host.directedChapter();
  const file = r.set.chapters[ch.k].file.split('/').pop();
  const scope = {
    chapter: ch.id,
    text: `Applies to chapter ${ch.k + 1}/${n} · ${ch.id}: ${ch.label}. Directions compile against ${ch.id}'s take, with ${ch.id}'s own times (now ${setClock(ch.local)} in); the track plays while ${ch.id} is on screen; Save track adds it to ${ch.id}'s file (${file}).${dc && dc.k !== ch.k ? ` The computed track belongs to ${dc.id}.` : ''}`,
  };
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
        <label className="take-camera" title={`each chapter's own planned shot list · now ${track.id}`}>
          <input type="checkbox" aria-label="Engine camera" checked={r.engineCamera} onChange={(e) => { r.engineCamera = e.target.checked; onChange(); }} />
          Engine camera
        </label>
        <label className="take-camera" title={`At high speed a planned shot can flash by. Each shot stays on screen for at least ${HOLD_S} s (${HOLD_S} s × speed of take time); held past its planned end, the camera keeps that shot's last pose while the build goes on, then cuts to the shot planned at that moment. Shots that fall wholly inside a hold are skipped. At speeds where every shot lasts ${HOLD_S} s or more nothing changes.`}>
          <input type="checkbox" aria-label="Hold shots" checked={r.hold} onChange={(e) => { r.hold = e.target.checked; onChange(); }} />
          Hold shots ≥ {HOLD_S} s
        </label>
        {r.waiting !== null && <span className="take-loading" role="status">{r.gaitWaiting ? `Reading the walks of the chapters before ${r.set.chapters[r.waiting].id}…` : `Loading chapter ${r.set.chapters[r.waiting].id}…`}</span>}
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
        <span aria-label="Shot now">{r.engineCamera ? `${track.own ? 'Shot' : `Directed (${ch.id})`}: ${r.shotLabel()}${held ? ' · held' : ''}` : 'Your camera · orbit freely'}</span>
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
      <DirectPanel host={host} clock={{ t: ch.local, playing: r.playing, directedOn: !!r.directed, setPlaying: (on) => { r.playing = on; }, scope }} onChange={onChange} />
    </>
  );
}
