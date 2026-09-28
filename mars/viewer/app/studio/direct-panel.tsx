// "Direct camera" in the replay bar (docs/engineering/STUDIO_REPLAY.md). The director builds typed
// `CameraDirection`s (CAMERA_DIRECT.md §1) with a small form — or edits the JSON list the compiler takes — and the
// studio compiles them against the open take in the browser (direct-camera.ts: the same `directCamera` the
// `engine_direct_camera` op runs, phase 2 self-correction on). It shows the shot list, per shot the corrections
// with their reasons (or the refusal with its candidates), and plays the directed track with the engine camera.
// No natural-language parsing in this tranche.
import { useState } from 'react';
import type { TakeReplay } from '../engine-view/take-replay.ts';
import type { TakeHost } from './take-host.ts';

const KINDS = ['entity', 'assembly', 'region', 'group'] as const;
const VERBS = ['orbit', 'pan', 'tilt', 'dolly', 'crane', 'push_in', 'pull_out', 'fly_through', 'hold'] as const;
const DIRS: Record<string, string[]> = { pan: ['left', 'right'], tilt: ['up', 'down'], orbit: ['cw', 'ccw'], crane: ['up', 'down'], dolly: ['left', 'right'] };
const SIDES = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const r1 = (x: number) => Math.round(x * 10) / 10;

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

export function DirectPanel({ host, replay, onChange }: { host: TakeHost; replay: TakeReplay; onChange: () => void }) {
  const [form, setForm] = useState<Form>(INITIAL);
  const [json, setJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const directed = host.directed();
  const playing = !replay.trackInfo().own;

  const list = (): unknown[] => {
    if (!json.trim()) return [];
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v : [v];
  };
  const add = (replace: boolean) => {
    try {
      const d = direction(form, replay.t);
      setJson(JSON.stringify(replace ? [d] : [...list(), d], null, 1));
      setError('');
    } catch (e) {
      setError(`Directions JSON: ${(e as Error).message}`);
    }
  };
  const compute = async () => {
    let dirs: unknown[];
    try {
      dirs = list();
      if (!dirs.length) dirs = [direction(form, replay.t)];
      setJson(JSON.stringify(dirs, null, 1));
    } catch (e) {
      return setError(`Directions JSON: ${(e as Error).message}`);
    }
    setBusy(true);
    setError('');
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
    <details className="take-direct">
      <summary>Direct camera{directed ? ` · ${res?.ok ? `${res.report.shots.length} shot${res.report.shots.length === 1 ? '' : 's'}` : 'refused'}` : ''}{playing ? ' · playing the directed track' : ''}</summary>
      <div className="direct-form" role="group" aria-label="Direction builder">
        <label>Subject<select aria-label="Subject kind" value={form.kind} onChange={(e) => set('kind', e.target.value as Form['kind'])}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
        <input aria-label="Subject" value={form.ref} onChange={(e) => set('ref', e.target.value)} placeholder="rack bay · chiba · carryA · p1" />
        <label>Verb<select aria-label="Verb" value={form.verb} onChange={(e) => set('verb', e.target.value as Form['verb'])}>{VERBS.map((v) => <option key={v}>{v}</option>)}</select></label>
        {(form.verb === 'orbit' || form.verb === 'pan' || form.verb === 'tilt') && <label>°<input aria-label="Degrees" type="number" value={form.degrees} onChange={(e) => set('degrees', e.target.value)} /></label>}
        {DIRS[form.verb] && <select aria-label="Direction" value={form.dir} onChange={(e) => set('dir', e.target.value)}><option value="">default</option>{DIRS[form.verb].map((d) => <option key={d}>{d}</option>)}</select>}
        <label>Duration s<input aria-label="Duration" type="number" min={0} value={form.duration} onChange={(e) => set('duration', e.target.value)} placeholder="auto" /></label>
        <label><input type="checkbox" aria-label="Start at the current time" checked={form.atNow} onChange={(e) => set('atNow', e.target.checked)} />at {r1(replay.t)} s</label>
        <label>Framing<select aria-label="Framing" value={form.size} onChange={(e) => set('size', e.target.value)}><option value="">auto</option><option>wide</option><option>medium</option><option>close</option></select></label>
        <select aria-label="Side" value={form.side} onChange={(e) => set('side', e.target.value)}><option value="">any side</option>{SIDES.map((s) => <option key={s}>{s}</option>)}</select>
        <label><input type="checkbox" aria-label="Sun behind" checked={form.sunBehind} onChange={(e) => set('sunBehind', e.target.checked)} />sun behind</label>
        {form.sunBehind && <label><input type="checkbox" aria-label="Sunset" checked={form.sunset} onChange={(e) => set('sunset', e.target.checked)} />sunset</label>}
        <input aria-label="Interior" value={form.interior} onChange={(e) => set('interior', e.target.value)} placeholder="interior region" />
        <input aria-label="Look at" value={form.lookAt} onChange={(e) => set('lookAt', e.target.value)} placeholder="look at fixture" />
        <button onClick={() => add(false)}>Add</button>
        <button onClick={() => add(true)}>Replace</button>
      </div>
      <textarea aria-label="Directions JSON" value={json} spellCheck={false} onChange={(e) => setJson(e.target.value)} placeholder="[] — the typed CameraDirection list (CAMERA_DIRECT.md §1); empty = the form above" />
      <div className="direct-actions">
        <button onClick={() => void compute()} disabled={busy}>{busy ? 'Computing…' : 'Compute camera'}</button>
        {res?.ok && (
          <button onClick={() => { host.playDirected(!playing); replay.playing = !playing; onChange(); }}>
            {playing ? "Back to the take's camera" : 'Play directed track'}
          </button>
        )}
        {directed && <span className="direct-meta">{directed.track ? `${directed.track.id} · ` : ''}{directed.ms} ms · scene {directed.scene}</span>}
      </div>
      {error && <p className="direct-error" role="alert">{error}</p>}
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
