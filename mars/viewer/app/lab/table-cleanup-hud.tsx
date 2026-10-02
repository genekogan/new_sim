import { useState } from 'react';
import type { LabSim } from './sim.ts';
import type { Runtime } from '../../engine/runtime/runtime.ts';
import type { Support } from '../../engine/world/types.ts';
import {
  tidyTable,
  tidyTableControl,
  readTidyTable,
  type TidyTableControlParams,
} from '../../engine/activities/table-cleanup.ts';
import { tidyTableBinding } from '../../engine/scenarios/table-cleanup.ts';
import { rot2 } from '../../engine/core/math.ts';
function supportText(s: Support | undefined) {
  if (!s) return 'missing support';
  if (s.kind === 'resting-on')
    return `${s.on}#${s.slot ?? '(unspecified surface)'}`;
  if (s.kind === 'in-hand') return `${s.by} · ${s.hand} hand`;
  return s.kind;
}
/** Requests registered actions; never moves people or changes item supports. */
export function TableCleanupHud({
  sim,
  refresh,
}: {
  sim: LabSim;
  refresh: () => void;
}) {
  const [feedback, setFeedback] = useState<{
    runtime: Runtime;
    text: string;
  }>();
  if (!['table-cleanup', 'table-cleanup-rotated'].includes(sim.scenario.name))
    return null;
  const rt = sim.rt,
    binding = tidyTableBinding(),
    records = [...rt.records.values()].filter((r) => r.verb === 'tidy_table');
  const active = records.findLast((r) => rt.isActive(r.id)),
    retained = active ?? records.findLast((r) => !!readTidyTable(rt, r.id)),
    state = retained ? readTidyTable(rt, retained.id) : undefined,
    latest = records.at(-1),
    live = !!state && rt.isActive(state.task);
  const pendingControl = () =>
    [...rt.records.values()].some(
      (r) =>
        r.verb === 'tidy_table_control' &&
        rt.isActive(r.id) &&
        (r.params as TidyTableControlParams).task === state?.task,
    );
  const can = (intent: TidyTableControlParams['intent']) =>
    live &&
    !pendingControl() &&
    rt.registry.has('tidy_table_control') &&
    tidyTableControl.plan(rt, { task: state!.task, intent }).ok;
  const startAdmission = rt.registry.has('tidy_table')
      ? tidyTable.plan(rt, binding)
      : undefined,
    startReady = !live && startAdmission?.ok === true;
  const direction = rot2(
      [-5, -5],
      sim.scenario.name === 'table-cleanup-rotated' ? Math.PI / 2 : 0,
    ),
    walkParams = { actor: binding.actor, x: direction[0], z: direction[1] },
    walk = rt.registry.get('walk_to'),
    walkAdmission = walk?.plan(rt, walkParams);
  const pendingDirection = () =>
    [...rt.records.values()].some(
      (r) =>
        r.verb === 'walk_to' &&
        !r.parent &&
        rt.isActive(r.id) &&
        (r.params as { actor?: string }).actor === binding.actor,
    );
  const directReady =
    !!walkAdmission?.ok && !pendingDirection() && !pendingControl();
  const reply = (
    record: { diagnostic?: { code: string; message: string } },
    text: string,
  ) => {
    setFeedback({
      runtime: rt,
      text: record.diagnostic
        ? `${record.diagnostic.code}: ${record.diagnostic.message}`
        : text,
    });
    refresh();
  };
  const control = (intent: TidyTableControlParams['intent']) => {
    // Recheck the exact task and Runtime at click time. No UI queue or effect
    // dispatches controls after lifecycle changes or Reset.
    if (sim.rt !== rt || !state || !rt.isActive(state.task) || !can(intent))
      return;
    reply(
      rt.submit('tidy_table_control', { task: state.task, intent }),
      intent === 'resume'
        ? 'Resume accepted for the remaining same items. Play advances physical transfers.'
        : `${intent === 'pause' ? 'Pause' : 'End'} accepted. Keep Play running for safe supported release; both blocked supports require intervention.`,
    );
  };
  const problem =
    state?.diagnostic ??
    latest?.diagnostic ??
    (!state && startAdmission && !startAdmission.ok
      ? startAdmission.diagnostic
      : undefined);
  const items =
    state?.items ??
    binding.transfers.map((q) => ({
      item: q.item,
      def: rt.world.entities[q.item]?.def,
      support: rt.world.entities[q.item]?.support,
      contents: rt.world.entities[q.item]?.contents,
    }));
  const resumeAdmission =
    live &&
    state &&
    ['paused', 'waiting'].includes(state.mode) &&
    !pendingControl()
      ? tidyTableControl.plan(rt, { task: state.task, intent: 'resume' })
      : undefined;
  return (
    <section className="lab-hud lab-classroom" data-testid="table-cleanup-hud">
      <h3>Communal table cleanup · same objects</h3>
      <p>
        Hypothetical two-table tidying. One grounded person carries the same
        bowls and book to declared empty surface slots. Contents stay in their
        bowls. This moves objects; it does not wash, delete or replace them.
      </p>
      <div data-testid="table-cleanup-readout">
        {state
          ? `${state.task} · ${state.status} · ${state.mode === 'completed' && !state.finished ? 'ended' : state.mode} · ${state.completed.length}/${state.bindings.transfers.length} actual transfers retained`
          : 'Not started · source-table → destination-table'}
      </div>
      <div className="lab-classroom-controls">
        <button
          disabled={!startReady}
          onClick={() => {
            if (
              sim.rt !== rt ||
              [...rt.records.values()].some(
                (r) => r.verb === 'tidy_table' && rt.isActive(r.id),
              ) ||
              !rt.registry.has('tidy_table') ||
              !tidyTable.plan(rt, binding).ok
            )
              return;
            reply(
              rt.submit('tidy_table', binding, { preempt: false }),
              'Cleanup requested. Play walks to and takes the actual first item.',
            );
          }}
        >
          Start cleanup
        </button>
        <button
          disabled={!live || state?.mode !== 'tidying' || !can('pause')}
          onClick={() => control('pause')}
        >
          Pause cleanup
        </button>
        <button
          disabled={
            !live ||
            !['paused', 'waiting'].includes(state!.mode) ||
            !can('resume')
          }
          onClick={() => control('resume')}
        >
          Resume cleanup
        </button>
        <button
          disabled={!live || state?.mode === 'ending' || !can('end')}
          onClick={() => control('end')}
        >
          End cleanup
        </button>
        <button
          disabled={!directReady}
          onClick={() => {
            if (
              sim.rt !== rt ||
              pendingControl() ||
              pendingDirection() ||
              !walk?.plan(rt, walkParams).ok
            )
              return;
            reply(
              rt.submit('walk_to', walkParams),
              `Ordinary direction requested to [${direction.map((v) => v.toFixed(0)).join(', ')}]. Any held cleanup item must reach a declared support before walking away; Resume is explicit.`,
            );
          }}
        >
          Direct tidier away
        </button>
      </div>
      {state && (
        <div data-testid="table-cleanup-transfers">
          <div>Completed transfers</div>
          {state.completed.length ? (
            <ul>
              {state.completed.map((q) => (
                <li key={q.item}>
                  {q.item} · {q.from} → {q.to}
                </li>
              ))}
            </ul>
          ) : (
            <div>None yet.</div>
          )}
          <div>Remaining transfers</div>
          {state.remaining.length ? (
            <ul>
              {state.remaining.map((q) => (
                <li key={q.item}>
                  {q.item} · {q.from} → {q.to}
                </li>
              ))}
            </ul>
          ) : (
            <div>None.</div>
          )}
        </div>
      )}
      <div data-testid="table-cleanup-items">
        {items.map((item) => (
          <div key={item.item}>
            {item.item} · {item.def ?? 'missing item'} ·{' '}
            {supportText(item.support)}
            {item.contents
              ? ` · ${item.contents.food}: ${item.contents.fraction.toFixed(4)} bowl`
              : ''}
          </div>
        ))}
      </div>
      {state?.current && (
        <div data-testid="table-cleanup-held">
          {state.current.item} · {state.current.phase} ·{' '}
          {state.current.held ? 'actually held' : 'supported / approaching'}
          {state.current.returnSlot
            ? ` · returning to ${state.current.returnSlot}`
            : ''}
        </div>
      )}
      {problem && (
        <p role="alert" data-testid="table-cleanup-diagnostic">
          {problem.code}: {problem.message}
        </p>
      )}
      {!rt.registry.has('tidy_table') && (
        <p role="alert">
          action.unregistered: tidy_table must be registered before this preset
          can start.
        </p>
      )}
      {resumeAdmission && !resumeAdmission.ok && (
        <p role="alert" data-testid="table-cleanup-resume-refusal">
          Resume refused · {resumeAdmission.diagnostic.code}:{' '}
          {resumeAdmission.diagnostic.message}
        </p>
      )}
      <p role="status" data-testid="table-cleanup-feedback">
        {state?.mode === 'completed'
          ? state.finished
            ? 'All actual transfers complete. Same objects and contents remain on the destination table.'
            : 'Cleanup ended early. Completed placements remain; no automatic restart.'
          : feedback?.runtime === rt
            ? feedback.text
            : 'Start cleanup, then Play. Controls advance through ordinary runtime actions.'}
      </p>
      <p>
        Pause and End return a held item to its declared source slot, or the
        declared destination if the source refuses. If both are unavailable, the
        person keeps holding it and the refusal names the intervention. Keep
        Play running for safe release; global Pause freezes time. Resume
        continues remaining same items in this runtime. Reset creates a fresh
        hypothetical world. Ground routes and existing right-hand item actions
        only; no active reload restoration.
      </p>
    </section>
  );
}
