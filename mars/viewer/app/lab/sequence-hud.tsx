// Sequence timeline for sequence-driven presets (build-bay): an on-canvas HUD
// (active steps with phase, blocked waits with their diagnostic, recent
// diagnostics) and a panel section (every step as a status chip). Reads the
// live SequenceRunner reports + runtime records; never mutates anything.
import type { LabSim } from './sim.ts';
import { sequenceOf } from './build-bay.ts';

export type StepRow = { id: string; verb: string; status: string; phase?: string; blockedTicks: number; code?: string; message?: string; start?: number; end?: number };

export function sequenceRows(sim: LabSim): StepRow[] | null {
  const seq = sequenceOf(sim.rt);
  if (!seq) return null;
  return seq.reports.map((r) => {
    const rec = r.actionId ? sim.rt.records.get(r.actionId) : undefined;
    const diag = r.status === 'blocked' || r.status === 'failed' || r.status === 'skipped' ? (rec?.diagnostic ?? r.diagnostic) : undefined;
    return { id: r.id, verb: r.verb, status: r.status, phase: rec?.phase, blockedTicks: r.blockedTicks, code: diag?.code, message: diag?.message, start: r.submittedTick, end: r.endedTick };
  });
}

const fmt = (tick: number) => `${(tick / 20).toFixed(1)} s`;

export function SequenceHud({ sim }: { sim: LabSim }) {
  const rows = sequenceRows(sim);
  if (!rows) return null;
  const done = rows.filter((r) => r.status === 'completed').length;
  const active = rows.filter((r) => r.status === 'executing' || r.status === 'blocked');
  const diags = sim.diagnostics.slice(-5).reverse();
  return (
    <div className="lab-hud" data-testid="sequence-hud">
      <div className="lab-hud-head">
        sequence {done}/{rows.length} steps · t {fmt(sim.rt.tick)}
        {sim.rt.violations.length ? ` · ${sim.rt.violations.length} VIOLATIONS` : ' · 0 violations'}
      </div>
      {active.map((r) => (
        <div key={r.id} className={`lab-hud-step ${r.status}`}>
          <b>{r.id}</b> {r.verb}
          {r.phase ? ` · ${r.phase}` : ''}
          {r.status === 'blocked' ? ` · BLOCKED ${r.code}: ${r.message}` : ''}
        </div>
      ))}
      {!active.length && <div className="lab-hud-step">{done === rows.length ? 'sequence complete' : 'no step running'}</div>}
      {diags.length > 0 && (
        <ol className="lab-hud-diags" aria-label="Recent diagnostics">
          {diags.map((d, i) => (
            <li key={i} className={d.level}>
              <span>{fmt(d.tick)}</span> {d.text}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function SequencePanel({ sim }: { sim: LabSim }) {
  const rows = sequenceRows(sim);
  if (!rows) return null;
  const blocked = rows.reduce((n, r) => n + r.blockedTicks, 0);
  return (
    <>
      <h2>Sequence timeline</h2>
      <p className="lab-meta">
        {rows.filter((r) => r.status === 'completed').length}/{rows.length} completed · blocked {fmt(blocked)} total (Σ steps)
      </p>
      <ol className="lab-steps" aria-label="Sequence steps">
        {rows.map((r) => (
          <li
            key={r.id}
            className={r.status}
            data-step={r.id}
            data-status={r.status}
            title={`${r.id} · ${r.verb} · ${r.status}${r.phase ? ` [${r.phase}]` : ''}${r.start !== undefined ? ` · start ${fmt(r.start)}` : ''}${r.end !== undefined ? ` · end ${fmt(r.end)}` : ''}${r.blockedTicks ? ` · blocked ${fmt(r.blockedTicks)}` : ''}${r.message ? ` · ${r.code}: ${r.message}` : ''}`}
          >
            {r.id}
            {r.blockedTicks > 0 && <sup>⏸</sup>}
          </li>
        ))}
      </ol>
    </>
  );
}
