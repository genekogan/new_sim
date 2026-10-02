import { useState } from 'react';
import type { LabSim } from './sim.ts';
import {
  communalSupper,
  communalSupperControl,
  readCommunalSupper,
  type CommunalSupperControlParams,
} from '../../engine/activities/communal-supper.ts';
import { communalSupperBinding } from '../../engine/scenarios/communal-supper.ts';
/** Same registered leaves own food, movement and supported storage. */
export function CommunalSupperHud({
  sim,
  refresh,
}: {
  sim: LabSim;
  refresh: () => void;
}) {
  const [feedback, setFeedback] = useState<{ epoch: number; text: string }>();
  if (sim.scenario.name !== 'communal-supper') return null;
  const rt = sim.rt,
    epoch = sim.scenarioEpoch,
    binding = communalSupperBinding(),
    latest = [...rt.records.values()].findLast(
      (r) => r.verb === 'communal_supper',
    ),
    state = latest ? readCommunalSupper(rt, latest.id) : undefined;
  const fresh = () => sim.rt === rt && sim.scenarioEpoch === epoch;
  const pending = () =>
    [...rt.records.values()].some(
      (r) =>
        r.verb === 'communal_supper_control' &&
        rt.isActive(r.id) &&
        (r.params as CommunalSupperControlParams).supper === state?.action,
    );
  const can = (intent: CommunalSupperControlParams['intent']) =>
    state && !pending() && rt.registry.has('communal_supper_control')
      ? communalSupperControl.plan(rt, { supper: state.action, intent })
      : undefined;
  const initial =
    !latest && rt.registry.has('communal_supper')
      ? communalSupper.plan(rt, binding)
      : undefined;
  const reply = (
    r: { diagnostic?: { code: string; message: string } },
    text: string,
  ) => {
    setFeedback({
      epoch,
      text: r.diagnostic
        ? `${r.diagnostic.code}: ${r.diagnostic.message}`
        : text,
    });
    refresh();
  };
  const control = (intent: CommunalSupperControlParams['intent']) => {
    if (
      !fresh() ||
      !state ||
      [...rt.records.values()].findLast((r) => r.verb === 'communal_supper')
        ?.id !== state.action ||
      can(intent)?.ok !== true
    )
      return;
    reply(
      rt.submit(
        'communal_supper_control',
        { supper: state.action, intent },
        { preempt: false },
      ),
      `${intent} accepted. Play advances safe physical draining; Resume is explicit.`,
    );
  };
  const walkParams = { actor: binding.preparation.actor, x: -4, z: -3 };
  const walking = () =>
    [...rt.records.values()].some(
      (r) =>
        r.verb === 'walk_to' &&
        !r.parent &&
        rt.isActive(r.id) &&
        (r.params as { actor?: string }).actor === walkParams.actor,
    );
  const direct = () =>
    state?.mode === 'paused' &&
    !pending() &&
    !walking() &&
    rt.registry.has('walk_to');
  const directionRecord = [...rt.records.values()].findLast(
    (r) =>
      r.verb === 'walk_to' &&
      !r.parent &&
      (r.params as { actor?: string }).actor === walkParams.actor,
  );
  const directionIssue =
    directionRecord &&
    !['completed', 'cancelled'].includes(directionRecord.status)
      ? directionRecord.diagnostic
      : undefined;
  const child = state?.current ? rt.records.get(state.current) : undefined;
  const refusal =
      state?.diagnostic ??
      (!latest && initial && !initial.ok
        ? initial.diagnostic
        : latest?.diagnostic),
    resume = can('resume');
  return (
    <section
      className="lab-hud lab-classroom"
      data-testid="communal-supper-hud"
    >
      <h3>Communal supper · finite food and same vessels</h3>
      <p>
        Hypothetical anonymous cook and guest. Cold preparation transfers two
        finite ingredients into the same pot; both people share that material
        with their own bowls and spoons, then physically store all seven
        original vessels on declared tables.
      </p>
      <div data-testid="communal-supper-state">
        {state
          ? `${state.action} · ${state.status} · ${state.mode === 'completed' && !state.finished ? 'ended' : state.mode} · ${state.stage} · ${state.current ?? 'no current child'} · ${child?.verb ?? 'none'} ${child?.phase ?? child?.status ?? ''}`
          : 'Not started'}
      </div>
      <div className="lab-classroom-controls">
        <button
          disabled={!!latest || initial?.ok !== true}
          onClick={() => {
            if (
              !fresh() ||
              [...rt.records.values()].some(
                (r) => r.verb === 'communal_supper',
              ) ||
              !rt.registry.has('communal_supper') ||
              !communalSupper.plan(rt, binding).ok
            )
              return;
            reply(
              rt.submit('communal_supper', binding, { preempt: false }),
              'Supper accepted. Play performs ordinary preparation, sharing and storage.',
            );
          }}
        >
          Start supper
        </button>
        {(['pause', 'resume', 'end'] as const).map((intent) => (
          <button
            key={intent}
            disabled={can(intent)?.ok !== true}
            onClick={() => control(intent)}
          >
            {intent[0].toUpperCase() + intent.slice(1)} supper
          </button>
        ))}
        <button
          disabled={!direct()}
          onClick={() => {
            if (
              !fresh() ||
              !state ||
              readCommunalSupper(rt, state.action)?.mode !== 'paused' ||
              !direct()
            )
              return;
            reply(
              rt.submit('walk_to', walkParams),
              'Cook directed away through an ordinary walk after safe local Pause. Resume waits for the independent walk; retained food stays unchanged.',
            );
          }}
        >
          Direct cook away
        </button>
      </div>
      {state && (
        <>
          <p data-testid="communal-supper-preparation">
            Prepared: {String(state.prepared)} ·{' '}
            {state.preparation?.mixedTicks ?? 0} actual mixing ticks ·{' '}
            {state.preparation?.ingredients
              .map((q) => `${q.item}: ${q.deposited}/${q.initial}`)
              .join(' · ') ?? 'no deposits yet'}
          </p>
          <p data-testid="communal-supper-meal">
            Meal complete: {String(state.mealComplete)} ·{' '}
            {state.meal?.action ?? 'not started'} ·{' '}
            {state.meal?.phase ?? 'waiting for preparation'} · floor{' '}
            {state.meal?.floorHolder ?? 'none'} · original purpose{' '}
            {state.meal?.purpose ?? 'none'} · continuation{' '}
            {state.meal?.resumeFrom ?? 'none'}
          </p>
          <div data-testid="communal-supper-receipts">
            {state.meal?.receipts?.map((r) => (
              <p key={r.actor}>
                {r.actor} · {r.bowl}/{r.spoon} · served {String(r.served)} ·
                remaining {r.remaining} · consumed {r.consumed}/{r.portion} ·
                consumption complete {String(r.consumptionCompleted)}
              </p>
            ))}
          </div>
          <div data-testid="communal-supper-storage">
            {binding.cleanup.flatMap((batch) =>
              batch.transfers.map((t) => (
                <p key={t.item}>
                  {t.item} · {t.from} → {t.to} ·{' '}
                  {state.cleanup.some((c) =>
                    c?.completed.some((q) => q.item === t.item),
                  )
                    ? 'actual transfer retained'
                    : 'remaining'}
                </p>
              )),
            )}
          </div>
          <div data-testid="communal-supper-items">
            {state.items.map((e) => (
              <p key={e?.id ?? 'missing'}>
                {e
                  ? `${e.id} · ${e.def} · ${e.contents ? `${e.contents.food}: ${e.contents.fraction}` : 'utensil'} · ${JSON.stringify(e.support)}`
                  : 'missing original vessel'}
              </p>
            ))}
          </div>
          <p>
            Actually held:{' '}
            {state.held
              .map((h) => `${h.actor}: ${h.items.join(', ') || 'none'}`)
              .join(' · ')}
          </p>
        </>
      )}
      {refusal && (
        <p role="alert" data-testid="communal-supper-diagnostic">
          {refusal.code}: {refusal.message}
        </p>
      )}
      {state &&
        ['paused', 'waiting'].includes(state.mode) &&
        resume &&
        !resume.ok && (
          <p role="alert">
            Resume refused · {resume.diagnostic.code}:{' '}
            {resume.diagnostic.message}
          </p>
        )}
      {directionIssue && (
        <p role="alert" data-testid="communal-supper-direction-diagnostic">
          {directionIssue.code}: {directionIssue.message}
        </p>
      )}
      {!rt.registry.has('communal_supper') && (
        <p role="alert">
          action.unregistered: communal_supper must be registered before this
          preset starts.
        </p>
      )}
      <p role="status">
        {feedback?.epoch === epoch
          ? feedback.text
          : 'Start, then Play. Global Pause freezes time; local Pause waits for the current physical leaf to stop safely.'}
      </p>
      <p>
        Preparation Pause retains ingredient deposits and mixing. Meal Pause
        retains actual serving/consumption receipts and real held utensils;
        explicit Resume continues that same meal without re-serving consumed
        empty bowls. Cleanup Pause safely supports the held transfer and keeps
        completed placements. End drains and returns held utensils to declared
        supports, preserving food and finished effects; keep Play running until
        truly released. Reset stages a fresh hypothetical world. No heat,
        washing, deletion, refill, replacement vessels or active reload
        restoration.
      </p>
    </section>
  );
}
