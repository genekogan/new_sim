// "Direct camera" in the replay bar (docs/engineering/STUDIO_REPLAY.md). The director builds typed
// `CameraDirection`s (CAMERA_DIRECT.md §1) with a small form — or edits the JSON list the compiler takes — and the
// studio compiles them against the open take in the browser (direct-camera.ts: the same `directCamera` the
// `engine_direct_camera` op runs, phase 2 self-correction on). It shows the shot list, per shot the corrections
// with their reasons (or the refusal with its candidates), and plays the directed track with the engine camera.
// Sentences (W48, on Codex's engine/camera/parse.ts): "Say it" parses one or more sentences ("… then …") into typed
// directions and appends them to the JSON list; a refusal (ambiguous / missing / deictic / unknown verb …) is shown with
// its question, candidates and the words it points at, and nothing is appended. The active take supplies the same
// vocabulary, aliases and semantic resolution as engine_parse_camera; shipped files need no simulation room.
// For a chapter set (W48) it acts on the chapter on screen: `scope` names that chapter, times are its own (local), the
// directed track plays while that chapter is on screen and "Save track" adds it to that chapter's file.
import { useRef, useState } from 'react';
import type { TakeHost } from './take-host.ts';
import type { SentenceRefusal } from '../../engine/api/camera-vocab.ts';

/** The last "Say it": the text, and either the directions appended or the refusals (by clause number, 1-based). */
type Said = { text: string; added: unknown[]; notes: string[]; refused: { n: number; of: number; refusal: Pick<SentenceRefusal, 'code' | 'message' | 'question' | 'candidates' | 'span'> }[] };

/**
 * What the panel directs: the take time directions start at (a set: the chapter's local time), play state, whether the
 * directed track drives the camera, and for a set the chapter it applies to (`scope`: shown at the top of the panel).
 */
export type DirectClock = {
  t: number;
  playing: boolean;
  directedOn: boolean;
  setPlaying: (on: boolean) => void;
  scope?: { chapter: string; text: string } | null;
};

const KINDS = ['entity', 'assembly', 'region', 'group', 'fixture'] as const;
const VERBS = ['orbit', 'pan', 'tilt', 'dolly', 'crane', 'push_in', 'pull_out', 'fly_through', 'hold'] as const;
const DIRS: Record<string, string[]> = { pan: ['left', 'right'], tilt: ['up', 'down'], orbit: ['cw', 'ccw'], crane: ['up', 'down'], dolly: ['left', 'right'] };
const SIDES = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Offer `json` as a file download (the browser cannot write public/engine/takes/). */
function download(name: string, json: string) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

type Form = {
  kind: (typeof KINDS)[number]; ref: string; verb: (typeof VERBS)[number]; degrees: string; dir: string; duration: string;
  atNow: boolean; size: string; side: string; sunBehind: boolean; sunset: boolean; interior: string; lookAt: string;
};
const INITIAL: Form = { kind: 'assembly', ref: 'rack bay', verb: 'orbit', degrees: '90', dir: '', duration: '', atNow: true, size: '', side: '', sunBehind: false, sunset: false, interior: '', lookAt: '' };

/** The form as one typed direction (only the fields that are set). */
function direction(f: Form, t: number): Record<string, unknown> {
  const deg = Number(f.degrees);
  const motion: Record<string, unknown> = { verb: f.verb };
  if ((f.verb === 'orbit' || f.verb === 'pan' || f.verb === 'tilt') && f.degrees !== '' && Number.isFinite(deg)) motion.degrees = deg;
  if (f.verb === 'orbit' && motion.degrees === undefined) motion.degrees = 90; // an orbit needs its angle
  if (f.dir && DIRS[f.verb]?.includes(f.dir)) motion.direction = f.dir;
  const framing = { ...(f.size ? { size: f.size } : {}), ...(f.side ? { side: f.side } : {}) };
  const context = {
    ...(f.sunBehind ? { sunBehind: f.sunset ? { sunset: true } : true } : {}),
    ...(f.interior ? { interior: f.interior } : {}),
    ...(f.lookAt ? { lookAt: f.lookAt } : {}),
  };
  return {
    subject: { kind: f.kind, ref: f.ref },
    motion,
    ...(f.duration !== '' && Number(f.duration) > 0 ? { duration: Number(f.duration) } : {}),
    ...(f.atNow ? { at: r1(t) } : {}),
    ...(Object.keys(framing).length ? { framing } : {}),
    ...(Object.keys(context).length ? { context } : {}),
  };
}

export function DirectPanel({ host, clock, onChange }: { host: TakeHost; clock: DirectClock; onChange: () => void }) {
  const [form, setForm] = useState<Form>(INITIAL);
  const [json, setJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [say, setSay] = useState('');
  const [said, setSaid] = useState<Said | null>(null);
  const box = useRef<HTMLDetailsElement>(null);
  const parseRequest = useRef(0);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const directed = host.directed();
  const playing = clock.directedOn;

  const list = (): unknown[] => {
    if (!json.trim()) return [];
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v : [v];
  };
  const add = (replace: boolean) => {
    parseRequest.current++;
    try {
      const d = direction(form, clock.t);
      setJson(JSON.stringify(replace ? [d] : [...list(), d], null, 1));
      setError('');
    } catch (e) {
      setError(`Directions JSON: ${(e as Error).message}`);
    }
  };
  /** Parse the sentence box; all clauses or nothing is appended to the JSON list. */
  const parse = async () => {
    const text = say.trim();
    if (!text) return;
    let dirs: unknown[];
    try {
      dirs = list();
    } catch (e) {
      return setError(`Directions JSON: ${(e as Error).message}`);
    }
    const request = ++parseRequest.current;
    try {
      const result = await host.parseDirections(text);
      if (request !== parseRequest.current) return;
      if (!result) return setError('The active take or chapter changed. Parse the sentence again.');
      const total = result.directions.length + result.refusals.length;
      const refused = result.refusals.map((refusal) => ({ n: refusal.index + 1, of: total, refusal }));
      const added = refused.length ? [] : result.directions.map((r) => r.direction);
      if (added.length) setJson(JSON.stringify([...dirs, ...added], null, 1));
      setSaid({ text, added, notes: result.directions.flatMap((r) => r.notes), refused });
      setError('');
    } catch (e) {
      if (request === parseRequest.current) setError(`Camera sentence: ${(e as Error).message}`);
    }
  };
  const compute = async () => {
    parseRequest.current++;
    let dirs: unknown[];
    try {
      dirs = list();
      if (!dirs.length) dirs = [direction(form, clock.t)];
      setJson(JSON.stringify(dirs, null, 1));
    } catch (e) {
      return setError(`Directions JSON: ${(e as Error).message}`);
    }
    setBusy(true);
    setError('');
    setSaved('');
    try {
      host.playDirected(false);
      await host.direct(dirs);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      onChange();
    }
  };

  const res = directed?.result;
  return (
    <details className="take-direct" ref={box}>
      <summary>Direct camera{clock.scope ? ` · chapter ${clock.scope.chapter}` : ''}{directed ? ` · ${res?.ok ? `${res.report.shots.length} shot${res.report.shots.length === 1 ? '' : 's'}` : 'refused'}` : ''}{playing ? ' · playing the directed track' : ''}</summary>
      {clock.scope && <p className="direct-scope" role="note" aria-label="Direct camera applies to">{clock.scope.text}</p>}
      <div className="direct-say" role="group" aria-label="Say it">
        <input aria-label="Direction sentence" value={say} onChange={(e) => { parseRequest.current++; setSay(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') void parse(); }} placeholder="do a 270° revolution around the rack bay over 2 minutes" />
        <button onClick={() => void parse()}>Parse &amp; add</button>
      </div>
      {said && !said.refused.length && (
        <p className="direct-said" role="status" aria-label="Sentence parsed">
          Added {said.added.length} direction{said.added.length === 1 ? '' : 's'}: {said.added.map((d) => JSON.stringify(d)).join(' · ')}
          {said.notes.length ? ` — ${said.notes.join('; ')}` : ''}
        </p>
      )}
      {said && said.refused.length > 0 && (
        <div className="direct-refused" role="alert" aria-label="Sentence refused">
          <p>Nothing added.</p>
          {said.refused.map(({ n, of, refusal: r }) => (
            <p key={n}>
              {of > 1 ? `Sentence ${n}/${of}: ` : ''}<b>{r.code}</b> {r.message}
              {r.question ? ` — ${r.question}` : ''}
              {r.candidates?.length ? ` Candidates: ${r.candidates.join(', ')}.` : ''}
              {of === 1 && r.span && r.span[1] > r.span[0] ? (
                <span className="direct-span"> “{said.text.slice(0, r.span[0])}<mark>{said.text.slice(r.span[0], r.span[1])}</mark>{said.text.slice(r.span[1])}”</span>
              ) : null}
            </p>
          ))}
        </div>
      )}
      <div className="direct-form" role="group" aria-label="Direction builder">
        <label>Subject<select aria-label="Subject kind" value={form.kind} onChange={(e) => set('kind', e.target.value as Form['kind'])}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
        <input aria-label="Subject" value={form.ref} onChange={(e) => set('ref', e.target.value)} placeholder="rack bay · chiba · carryA · p1" />
        <label>Verb<select aria-label="Verb" value={form.verb} onChange={(e) => set('verb', e.target.value as Form['verb'])}>{VERBS.map((v) => <option key={v}>{v}</option>)}</select></label>
        {(form.verb === 'orbit' || form.verb === 'pan' || form.verb === 'tilt') && <label>°<input aria-label="Degrees" type="number" value={form.degrees} onChange={(e) => set('degrees', e.target.value)} /></label>}
        {DIRS[form.verb] && <select aria-label="Direction" value={form.dir} onChange={(e) => set('dir', e.target.value)}><option value="">default</option>{DIRS[form.verb].map((d) => <option key={d}>{d}</option>)}</select>}
        <label>Duration s<input aria-label="Duration" type="number" min={0} value={form.duration} onChange={(e) => set('duration', e.target.value)} placeholder="auto" /></label>
        <label><input type="checkbox" aria-label="Start at the current time" checked={form.atNow} onChange={(e) => set('atNow', e.target.checked)} />at {r1(clock.t)} s{clock.scope ? ` of ${clock.scope.chapter}` : ''}</label>
        <label>Framing<select aria-label="Framing" value={form.size} onChange={(e) => set('size', e.target.value)}><option value="">auto</option><option>wide</option><option>medium</option><option>close</option></select></label>
        <select aria-label="Side" value={form.side} onChange={(e) => set('side', e.target.value)}><option value="">any side</option>{SIDES.map((s) => <option key={s}>{s}</option>)}</select>
        <label><input type="checkbox" aria-label="Sun behind" checked={form.sunBehind} onChange={(e) => set('sunBehind', e.target.checked)} />sun behind</label>
        {form.sunBehind && <label><input type="checkbox" aria-label="Sunset" checked={form.sunset} onChange={(e) => set('sunset', e.target.checked)} />sunset</label>}
        <input aria-label="Interior" value={form.interior} onChange={(e) => set('interior', e.target.value)} placeholder="interior region" />
        <input aria-label="Look at" value={form.lookAt} onChange={(e) => set('lookAt', e.target.value)} placeholder="look at fixture" />
        <button onClick={() => add(false)}>Add</button>
        <button onClick={() => add(true)}>Replace</button>
      </div>
      <textarea aria-label="Directions JSON" value={json} spellCheck={false} onChange={(e) => { parseRequest.current++; setJson(e.target.value); }} placeholder="[] — the typed CameraDirection list (CAMERA_DIRECT.md §1); empty = the form above" />
      <div className="direct-actions">
        <button onClick={() => void compute()} disabled={busy}>{busy ? 'Computing…' : 'Compute camera'}</button>
        {res?.ok && (
          <button onClick={() => {
            host.playDirected(!playing);
            clock.setPlaying(!playing);
            if (!playing && box.current) box.current.open = false; // fold the form away: the shot needs the view
            onChange();
          }}>
            {playing ? "Back to the take's camera" : 'Play directed track'}
          </button>
        )}
        {res?.ok && directed?.track && (
          <button onClick={() => {
            try {
              const s = host.saveDirected();
              if (!s) return;
              download(s.name, s.json);
              setSaved(`Saved ${s.trackId} into ${s.name} (${s.cameras.length} extra camera${s.cameras.length === 1 ? '' : 's'}, ${(s.json.length / 1e6).toFixed(2)} MB) — downloaded: put it in public/engine/takes/ to ship it. Not posted to a room: no simulation op stores a computed track for a file take (STUDIO_REPLAY.md §3).`);
              onChange();
            } catch (e) {
              setError(`Save track: ${(e as Error).message}`);
            }
          }}>
            Save track
          </button>
        )}
        {directed && <span className="direct-meta">{directed.track ? `${directed.track.id} · ` : ''}{directed.ms} ms · scene {directed.scene}</span>}
      </div>
      {error && <p className="direct-error" role="alert">{error}</p>}
      {saved && <p className="direct-saved" role="status" aria-label="Saved track">{saved}</p>}
      {res && !res.ok && (
        <div className="direct-refused" role="alert" aria-label="Direction refused">
          {res.diagnostics.map((d, i) => {
            const cands = (d.details as { candidates?: { kind: string; id: string; label: string }[] } | undefined)?.candidates;
            return (
              <p key={i}>
                <b>{d.code}</b> {d.message}
                {cands?.length ? ` — candidates: ${cands.map((c) => `${c.kind} ${c.id} (${c.label})`).join('; ')}` : ''}
              </p>
            );
          })}
        </div>
      )}
      {res?.ok && (
        <ol className="direct-shots" aria-label="Shot list">
          {res.report.shots.map((s, i) => (
            <li key={i}>
              <div>
                <b>{s.label}</b> · {s.verb} · {r1(s.t0)}–{r1(s.t1)} s · {s.subject.label}
                {s.planner ? ` · readability min ${s.planner.minReadability} / mean ${s.planner.meanReadability} · ${s.planner.invalidSamples} invalid` : ''}
                {s.simulation ? ` · simulated ${s.simulation.valid ? 'valid' : `${s.simulation.failingSamples} failing samples`}` : ''}
              </div>
              {s.corrections.length ? (
                <ul className="direct-corrections" aria-label={`Corrections for ${s.label}`}>
                  {s.corrections.map((c, j) => (
                    <li key={j}>
                      <b>{c.failure} → {c.strategy}</b> ({c.samples.count} samples, {r1(c.samples.t0)}–{r1(c.samples.t1)} s): {c.reason}
                      {c.tried.length ? ` · tried first: ${c.tried.map((x) => `${x.strategy} ${x.outcome}`).join(', ')}` : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="direct-none">valid as computed — no correction</div>
              )}
              {s.notes.length ? <div className="direct-notes">{s.notes.slice(0, 3).join(' · ')}</div> : null}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
