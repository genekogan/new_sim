import { useState } from 'react';
import type { LabSim } from './sim.ts';
import type { Runtime } from '../../engine/runtime/runtime.ts';
import {
  libraryReading,
  libraryReadingControl,
  libraryReadingReadout,
} from '../../engine/activities/library-reading.ts';
import { LIBRARY_READING_BINDING } from '../../engine/scenarios/library-reading.ts';
import { heldBy } from '../../engine/items/model.ts';

/** Ordinary registered requests only; Reset invalidates every captured handler. */
export function LibraryReadingHud({
  sim,
  refresh,
}: {
  sim: LabSim;
  refresh: () => void;
}) {
  const [feedback, setFeedback] = useState<{
    runtime: Runtime;
    epoch: number;
    text: string;
  }>();
  if (sim.scenario.name !== 'library-reading') return null;
  const rt = sim.rt,
    epoch = sim.scenarioEpoch;
  const latest = [...rt.records.values()].findLast(
    (r) => r.verb === 'library_reading',
  );
  const state = latest ? libraryReadingReadout(rt, latest.id) : undefined;
  const binding = state?.params ?? LIBRARY_READING_BINDING;
  const fresh = () => sim.rt === rt && sim.scenarioEpoch === epoch;
  const live = !!state && rt.isActive(state.id);
  const pending = () =>
    [...rt.records.values()].some(
      (r) =>
        r.verb === 'library_reading_control' &&
        rt.isActive(r.id) &&
        (r.params as { session?: string }).session === state?.id,
    );
  const walking = () =>
    [...rt.records.values()].some(
      (r) =>
        r.verb === 'walk_to' &&
        !r.parent &&
        rt.isActive(r.id) &&
        (r.params as { actor?: string }).actor === binding.actor,
    );
  const admission = (intent: 'pause' | 'resume' | 'end') =>
    live && state && !pending() && rt.registry.has('library_reading_control')
      ? libraryReadingControl.plan(rt, { session: state.id, intent })
      : undefined;
  const startAdmission =
    !latest && rt.registry.has('library_reading')
      ? libraryReading.plan(rt, binding)
      : undefined;
  const resumeAdmission =
    state && ['paused', 'waiting'].includes(state.mode) && !walking()
      ? admission('resume')
      : undefined;
  const walkParams = { actor: binding.actor, x: -3, z: -3 };
  const walk = rt.registry.get('walk_to');
  const directReady = () =>
    !!state &&
    live &&
    ['paused', 'waiting'].includes(state.mode) &&
    !pending() &&
    !walking() &&
    state.children.every((c) => !rt.isActive(c.id)) &&
    !rt.holder(`actor:${binding.actor}`).length &&
    !rt.holder(`hand:${binding.actor}:left`).length &&
    !rt.holder(`hand:${binding.actor}:right`).length &&
    heldBy(rt.world, binding.actor).length === 0 &&
    walk?.plan(rt, walkParams).ok === true;
  const reply = (
    record: { diagnostic?: { code: string; message: string } },
    text: string,
  ) => {
    setFeedback({
      runtime: rt,
      epoch,
      text: record.diagnostic
        ? `${record.diagnostic.code}: ${record.diagnostic.message}`
        : text,
    });
    refresh();
  };
  const control = (intent: 'pause' | 'resume' | 'end') => {
    if (
      !fresh() ||
      !state ||
      !admission(intent)?.ok ||
      (intent === 'resume' && walking())
    )
      return;
    reply(
      rt.submit('library_reading_control', { session: state.id, intent }),
      intent === 'resume'
        ? 'Resume requested for the same book and retained bookmark.'
        : `${intent === 'pause' ? 'Pause' : 'End'} requested. End retains unfinished reading; it does not finish the book.`,
    );
  };
  const support = state?.support ?? rt.world.entities[binding.book]?.support;
  const supportLabel =
    support?.kind === 'resting-on'
      ? `${support.on}#${support.slot ?? 'unspecified'}`
      : support?.kind === 'in-hand'
        ? `held by ${support.by}`
        : (support?.kind ?? 'missing');
  const problem =
    state?.diagnostic ??
    latest?.diagnostic ??
    (startAdmission && !startAdmission.ok
      ? startAdmission.diagnostic
      : undefined);
  return (
    <section
      className="lab-hud lab-classroom"
      data-testid="library-reading-hud"
    >
      <h3>Library reading · same book and bookmark</h3>
      <p>
        Hypothetical quiet study: read {binding.duration}s, retain the partial
        bookmark after {binding.transferAfter}s, carry the same book between the
        declared tables, then finish from the other chair.
      </p>
      <div data-testid="library-reading-readout">
        {state
          ? `${state.mode === 'completed' && !state.finished ? 'ended · unfinished reading retained' : state.mode} · ${state.stage} · ${state.elapsed.toFixed(2)}/${binding.duration}s`
          : 'Not started'}{' '}
        · {binding.book} · {supportLabel}
      </div>
      <div className="lab-classroom-controls">
        <button
          disabled={!startAdmission?.ok}
          onClick={() => {
            if (
              !fresh() ||
              [...rt.records.values()].some(
                (r) => r.verb === 'library_reading',
              ) ||
              !libraryReading.plan(rt, binding).ok
            )
              return;
            reply(
              rt.submit('library_reading', binding, { preempt: false }),
              'Reading requested. Play advances arrival, reading and the physical book transfer.',
            );
          }}
        >
          Start library reading
        </button>
        <button
          disabled={state?.mode !== 'running' || !admission('pause')?.ok}
          onClick={() => control('pause')}
        >
          Pause reading
        </button>
        <button
          disabled={!resumeAdmission?.ok}
          onClick={() => control('resume')}
        >
          Resume reading
        </button>
        <button
          disabled={!live || state?.mode === 'ending' || !admission('end')?.ok}
          onClick={() => control('end')}
        >
          End reading
        </button>
        <button
          disabled={!directReady()}
          onClick={() => {
            if (!fresh() || !directReady()) return;
            reply(
              rt.submit('walk_to', walkParams),
              'Ordinary direction requested away from the tables. Reading remains suspended; Resume is explicit.',
            );
          }}
        >
          Direct reader away
        </button>
      </div>
      {pending() && (
        <p role="status">
          Control pending. Global Pause freezes requests too; use Play to
          complete the request before another control.
        </p>
      )}
      {state && ['draining', 'ending'].includes(state.mode) && (
        <p role="status">
          Keep Play running until the book has supported release and the reader
          has departed safely.
        </p>
      )}
      {resumeAdmission && !resumeAdmission.ok && (
        <p role="alert">
          Resume refused: {resumeAdmission.diagnostic.code}:{' '}
          {resumeAdmission.diagnostic.message}
        </p>
      )}
      {problem && (
        <p role="alert">
          {problem.code}: {problem.message}
        </p>
      )}
      {feedback?.runtime === rt && feedback.epoch === epoch && (
        <p role="status">{feedback.text}</p>
      )}
    </section>
  );
}
