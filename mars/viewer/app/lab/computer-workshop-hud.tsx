import { useState } from 'react';
import type { LabSim } from './sim.ts';
import type { Runtime } from '../../engine/runtime/runtime.ts';
import {
  computerWorkshop,
  computerWorkshopControl,
  readComputerWorkshop,
  type ComputerWorkshopControlParams,
} from '../../engine/activities/computer-workshop.ts';
import { computerWorkshopBinding } from '../../engine/scenarios/computer-workshop.ts';
import { walkTo } from '../../engine/locomotion/walk.ts';
import { heldBy } from '../../engine/items/model.ts';

/** Intent requests only; ordinary children own physical execution. */
export function ComputerWorkshopHud({
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
  if (sim.scenario.name !== 'computer-workshop') return null;
  const rt = sim.rt,
    epoch = sim.scenarioEpoch,
    binding = computerWorkshopBinding();
  const latest = [...rt.records.values()]
    .filter((r) => r.verb === 'computer_workshop')
    .at(-1);
  const state = latest ? readComputerWorkshop(rt, latest.id) : undefined;
  const bound = state?.bindings ?? binding;
  const fresh = () => sim.rt === rt && sim.scenarioEpoch === epoch;
  const pending = () =>
    [...rt.records.values()].some(
      (r) =>
        rt.isActive(r.id) &&
        r.verb === 'computer_workshop_control' &&
        (r.params as { workshop?: string }).workshop === state?.workshop,
    );
  const admission = !latest ? computerWorkshop.plan(rt, binding) : undefined;
  const live = !!state && rt.isActive(state.workshop);
  const plan = (
    intent: ComputerWorkshopControlParams['intent'],
    actor?: string,
  ) =>
    live && !pending() && rt.registry.has('computer_workshop_control')
      ? computerWorkshopControl.plan(rt, {
          workshop: state!.workshop,
          intent,
          ...(actor ? { actor } : {}),
        })
      : undefined;
  const reply = (
    result: { diagnostic?: { code: string; message: string } },
    text: string,
  ) => {
    setFeedback({
      runtime: rt,
      epoch,
      text: result.diagnostic
        ? `${result.diagnostic.code}: ${result.diagnostic.message}`
        : text,
    });
    refresh();
  };
  const command = (
    intent: ComputerWorkshopControlParams['intent'],
    actor?: string,
  ) => {
    if (!fresh() || !state || plan(intent, actor)?.ok !== true) return;
    reply(
      rt.submit('computer_workshop_control', {
        workshop: state.workshop,
        intent,
        ...(actor ? { actor } : {}),
      }),
      intent === 'end'
        ? 'End requested. Keep Play running for safe cleanup; retained work stays.'
        : intent === 'join'
          ? `${actor} rejoined. A paused learner still needs Resume.`
          : `Accepted ${intent}${actor ? ` for ${actor}` : ''}. Play advances ordinary actions.`,
    );
  };
  const control = (
    label: string,
    intent: ComputerWorkshopControlParams['intent'],
    actor?: string,
  ) => (
    <button
      key={label}
      disabled={plan(intent, actor)?.ok !== true}
      onClick={() => command(intent, actor)}
    >
      {label}
    </button>
  );
  // Only a safely released practice participant can be directed from this HUD.
  const directive = (actor: string) => ({
    actor,
    x: actor === 'learner-b' ? 8 : -8,
    z: 9,
  });
  const canDirect = (actor: string) =>
    live &&
    state?.stage === 'practice' &&
    !['ending', 'pausing'].includes(state.mode) &&
    !heldBy(rt.world, actor).length &&
    !rt.holder(`actor:${actor}`).length &&
    rt.registry.has('walk_to') &&
    walkTo.plan(rt, directive(actor)).ok;
  const pause = plan('pause');
  const problem =
    state?.diagnostic ??
    latest?.diagnostic ??
    (admission && !admission.ok ? admission.diagnostic : undefined);
  return (
    <section
      className="lab-hud lab-classroom"
      data-testid="computer-workshop-hud"
    >
      <h3>Demonstrate, practice and review</h3>
      <p>
        Three hypothetical people, a working display and two supported
        computers. Learners keep distinct tasks and clocks; learner A presents
        the review while learner B listens. Silent task progress does not
        generate images or simulate typing.
      </p>
      <div data-testid="computer-workshop-readout">
        {state
          ? `${state.workshop} · ${state.status} · ${state.stage} · ${state.mode}`
          : 'Ready: demonstration → independent practice → review'}
      </div>
      <div className="lab-classroom-controls">
        <button
          disabled={!!latest || admission?.ok !== true}
          onClick={() => {
            if (
              !fresh() ||
              [...rt.records.values()].some(
                (r) => r.verb === 'computer_workshop',
              ) ||
              !rt.registry.has('computer_workshop')
            )
              return;
            const p = computerWorkshop.plan(rt, binding);
            if (!p.ok) {
              reply(p, '');
              return;
            }
            reply(
              rt.submit('computer_workshop', binding, { preempt: false }),
              'Workshop requested. Press Play for arrival and demonstration.',
            );
          }}
        >
          Start workshop
        </button>
        {control('Pause workshop', 'pause')}
        {control('Resume workshop', 'resume')}
        {control('End workshop', 'end')}
      </div>
      {pause &&
        !pause.ok &&
        pause.diagnostic.code ===
          'computer_workshop.session-pause-unsupported' && (
          <p role="status">
            Use global Pause during demonstration/review. Local Pause safely
            stops practice; End drains every phase.
          </p>
        )}
      {pending() && (
        <p role="status">
          Control accepted. Press Play to finish its tick before another local
          control.
        </p>
      )}
      {state && ['pausing', 'ending'].includes(state.mode) && (
        <p>
          Keep Play running until safe cleanup finishes. Ending cannot be
          reversed.
        </p>
      )}
      <div data-testid="computer-workshop-session">
        {state?.current
          ? `Gathering ${state.current.session} · ${state.current.phase} · floor ${state.current.floorHolder ?? 'none'}${state.current.waitingReason ? ` · ${state.current.waitingReason}` : ''}`
          : 'No current gathering'}
        <div className="lab-classroom-controls">
          {control('Question learner-b', 'question', 'learner-b')}
          {control('Advance workshop', 'advance')}
        </div>
      </div>
      {bound.learners.map((p) => {
        const l = state?.learners.find((l) => l.actor === p.actor),
          w = l?.workstation;
        const elapsed =
          w && !('code' in w) && w.task === p.task
            ? w.elapsed
            : (l?.elapsed ?? 0);
        return (
          <div key={p.actor} data-testid={`learner-${p.actor}`}>
            <strong>{p.actor}</strong> · {p.task} · {elapsed.toFixed(2)}/
            {p.duration}s ·{' '}
            {l?.completed
              ? 'complete'
              : state?.mode === 'ended'
                ? 'retained unfinished; workshop ended'
                : l?.paused
                  ? 'paused; explicit Resume required'
                  : l?.current
                    ? `${l.current.status} ${l.current.phase ?? ''}`
                    : 'not yet working'}
            <div>
              {p.station} · {p.seat} · {l?.actions.length ?? 0} ordinary work
              records
            </div>
            {l?.diagnostic && (
              <p role="status">
                {state?.mode === 'ended' && 'Historical stop: '}
                {l.diagnostic.code}: {l.diagnostic.message}
              </p>
            )}
            <div className="lab-classroom-controls">
              {control(`Pause ${p.actor}`, 'pause-learner', p.actor)}
              {control(`Resume ${p.actor}`, 'resume-learner', p.actor)}
            </div>
          </div>
        );
      })}
      {[bound.facilitator, ...bound.learners.map((p) => p.actor)].map(
        (actor) => (
          <div key={actor}>
            {actor} ·{' '}
            {state?.members.find((m) => m.actor === actor)?.present === false
              ? 'withdrawn; explicit Join required'
              : 'declared participant'}
            <div className="lab-classroom-controls">
              {control(`Leave ${actor}`, 'leave', actor)}
              {control(`Join ${actor}`, 'join', actor)}
              <button
                disabled={!canDirect(actor)}
                onClick={() => {
                  if (!fresh() || !canDirect(actor)) return;
                  reply(
                    rt.submit('walk_to', directive(actor)),
                    `${actor} received an ordinary direction. Join/Resume after completion keeps retained work.`,
                  );
                }}
              >
                Direct {actor} away
              </button>
            </div>
          </div>
        ),
      )}
      <p>
        Pause a learner and keep Play running for safe release, direct them
        away, then explicitly Join and Resume. A peer can finish independently;
        review waits for all three. Missing resources need a remedy or End.
        Reset creates a fresh world.
      </p>
      <div data-testid="computer-workshop-history">
        {state?.history.map((h) => (
          <div key={h.session}>
            {h.stage} · {h.session} · {h.status} · {h.readout.phase}
          </div>
        ))}
      </div>
      {problem && (
        <p role="status" data-testid="computer-workshop-diagnostic">
          {problem.code}: {problem.message}
        </p>
      )}
      {feedback?.runtime === rt && feedback.epoch === epoch && (
        <p role="status">{feedback.text}</p>
      )}
      {state?.mode === 'ended' && (
        <p>
          Ended safely. This workshop cannot Resume; unfinished computer
          receipts remain for an ordinary work task. Reset creates a fresh
          workshop and clears the current world progress.
        </p>
      )}
      {state?.finished && (
        <p>
          Complete: both original tasks and sessions are retained. Departures
          finished; the world clock remains usable.
        </p>
      )}
    </section>
  );
}
