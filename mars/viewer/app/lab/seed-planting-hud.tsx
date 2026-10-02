import { useState } from 'react';
import type { LabSim } from './sim.ts';
import type { Runtime } from '../../engine/runtime/runtime.ts';
import {
  seedPlanting,
  readSeedPlanting,
} from '../../engine/activities/seed-planting.ts';
import { readSeedbed } from '../../engine/objects/planting.ts';
import { seedPlantingBinding } from '../../engine/scenarios/seed-planting.ts';
import { rot2 } from '../../engine/core/math.ts';

/** Finite leaf planting actions: Pause and End safely stop, explicit Continue rebinds. */
export function SeedPlantingHud({
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
  if (!['seed-planting', 'seed-planting-rotated'].includes(sim.scenario.name))
    return null;
  const rt = sim.rt,
    epoch = sim.scenarioEpoch,
    angle = sim.scenario.name === 'seed-planting-rotated' ? Math.PI / 2 : 0;
  const records = [...rt.records.values()].filter(
      (r) => r.verb === 'seed_planting',
    ),
    latest = records.at(-1),
    active = records.findLast((r) => rt.isActive(r.id)),
    state = latest ? readSeedPlanting(rt, latest.id) : undefined;
  const fresh = () => sim.rt === rt && sim.scenarioEpoch === epoch;
  const stopping = () =>
    !!active &&
    ['cancelling', 'stopping', 'withdrawing', 'putting', 'returning'].includes(
      rt.records.get(active.id)?.phase ?? '',
    );
  const direction = rot2([-5, 3], angle),
    walkParams = { actor: 'planter', x: direction[0], z: direction[1] },
    walkPlan = rt.registry.get('walk_to')?.plan(rt, walkParams);
  const directionPending = () =>
    [...rt.records.values()].some(
      (r) =>
        r.verb === 'walk_to' &&
        !r.parent &&
        rt.isActive(r.id) &&
        (r.params as { actor?: string }).actor === 'planter',
    );
  const busy = () =>
    [...rt.records.values()].some(
      (r) => r.verb === 'seed_planting' && rt.isActive(r.id),
    ) || directionPending();
  const reply = (
    r: { diagnostic?: { code: string; message: string } },
    text: string,
  ) => {
    setFeedback({
      runtime: rt,
      epoch,
      text: r.diagnostic
        ? `${r.diagnostic.code}: ${r.diagnostic.message}`
        : text,
    });
    refresh();
  };
  const admission = (plant: string, resume: boolean) =>
    rt.registry.has('seed_planting')
      ? seedPlanting.plan(rt, {
          ...seedPlantingBinding(angle, plant),
          ...(resume ? { resume: true } : {}),
        })
      : undefined;
  const start = (plant: string, resume: boolean) => {
    if (!fresh() || busy()) return;
    const bed = readSeedbed(rt, plant);
    if (
      'code' in bed ||
      bed.completed ||
      !!bed.purpose !== resume ||
      !admission(plant, resume)?.ok
    )
      return;
    reply(
      rt.submit(
        'seed_planting',
        {
          ...seedPlantingBinding(angle, plant),
          ...(resume ? { resume: true } : {}),
        },
        { preempt: false },
      ),
      resume
        ? 'Continuing the same retained purpose/source. Play advances remaining physical deposits and bowl return.'
        : 'Planting requested. Play takes the actual finite seed bowl and walks to this planter.',
    );
  };
  const cancel = (kind: 'Pause' | 'End') => {
    if (!fresh() || !active || !rt.isActive(active.id) || stopping()) return;
    reply(
      rt.cancel(active.id),
      `${kind} requests safe physical stop and return of the same bowl. Committed seeds and the unfinished purpose remain; Continue is explicit.`,
    );
  };
  const source = rt.world.entities['seed-bowl'],
    beds = ['planter-a', 'planter-b'].map((plant) => readSeedbed(rt, plant));
  return (
    <section className="lab-hud lab-classroom" data-testid="seed-planting-hud">
      <h3>Seed planting · finite retained material</h3>
      <p>
        Hypothetical seeds, two raised ground planters and one finite bowl. Four
        conserved 1/16 deposits place 1/4 bowl per planter. Visible markers show
        deposit units, not literal seed counts or sprouts. No historical
        species, growth or refill is claimed.
      </p>
      <div data-testid="seed-planting-source">
        seed-bowl · {source?.contents?.food ?? 'missing material'} · remaining
        fraction {source?.contents?.fraction.toFixed(4) ?? 'unavailable'} ·{' '}
        {source?.support?.kind ?? 'missing support'}
        {source?.support?.kind === 'resting-on' &&
          ` · ${source.support.on}#${source.support.slot}`}
      </div>
      <div data-testid="seed-planting-readout">
        {state
          ? `${state.action} · ${state.status} · ${state.phase ?? 'not started'} · ${state.bindings.plant}`
          : 'Not started'}
        {active && (
          <div>Keep Play running for ordinary execution and safe return.</div>
        )}
      </div>
      {beds.map((bed, i) => {
        if ('code' in bed)
          return (
            <p key={i} role="alert">
              {bed.code}: {bed.message}
            </p>
          );
        const startPlan =
            !bed.purpose && !bed.completed && !busy()
              ? admission(bed.plant, false)
              : undefined,
          continuePlan =
            !!bed.purpose && !bed.completed && !busy()
              ? admission(bed.plant, true)
              : undefined,
          problem =
            startPlan && !startPlan.ok
              ? startPlan.diagnostic
              : continuePlan && !continuePlan.ok
                ? continuePlan.diagnostic
                : undefined,
          label = i === 0 ? 'A' : 'B';
        return (
          <div key={bed.plant} data-testid={`seed-planting-${bed.plant}`}>
            <div>
              {bed.plant} ·{' '}
              {bed.completed
                ? 'material placement complete'
                : bed.purpose
                  ? 'retained unfinished purpose'
                  : 'not started'}{' '}
              · {bed.deposits}/4 deposits · {bed.deposited.toFixed(4)}/
              {bed.required.toFixed(4)} seeds
              {bed.purpose &&
                ` · purpose ${bed.purpose} · actor ${bed.actor} · source ${bed.source}`}
            </div>
            <div className="lab-classroom-controls">
              <button
                disabled={busy() || startPlan?.ok !== true}
                onClick={() => start(bed.plant, false)}
              >
                Start plant {label}
              </button>
              <button
                disabled={busy() || continuePlan?.ok !== true}
                onClick={() => start(bed.plant, true)}
              >
                Continue plant {label}
              </button>
            </div>
            {problem && (
              <p
                role="status"
                data-testid={`seed-planting-admission-${bed.plant}`}
              >
                {problem.code}: {problem.message}
              </p>
            )}
          </div>
        );
      })}
      <div className="lab-classroom-controls">
        <button
          disabled={!active || stopping()}
          onClick={() => cancel('Pause')}
        >
          Pause planting
        </button>
        <button disabled={!active || stopping()} onClick={() => cancel('End')}>
          End planting
        </button>
        <button
          disabled={
            !active || stopping() || directionPending() || walkPlan?.ok !== true
          }
          onClick={() => {
            if (
              !fresh() ||
              !active ||
              !rt.isActive(active.id) ||
              stopping() ||
              directionPending() ||
              !rt.registry.get('walk_to')?.plan(rt, walkParams).ok
            )
              return;
            reply(
              rt.submit('walk_to', walkParams),
              'Planter direction requested. Existing planting returns the same bowl safely before the ordinary walk; Continue retains the same partial purpose.',
            );
          }}
        >
          Direct planter away
        </button>
      </div>
      {state?.diagnostic && (
        <p role="alert" data-testid="seed-planting-diagnostic">
          {state.diagnostic.code}: {state.diagnostic.message}
        </p>
      )}
      <p role="status" data-testid="seed-planting-feedback">
        {feedback?.runtime === rt && feedback.epoch === epoch
          ? feedback.text
          : 'Choose a planter, then Play. Finish any retained same-source purpose before starting another plot.'}
      </p>
      <p>
        Pause and End both cancel this physical leaf action safely; they do not
        erase deposited material or keep a hidden paused coordinator. Continue
        submits an explicit same-purpose action with the same finite source and
        return slot. Complete the retained purpose before starting another plot.
        Global Pause freezes time; Reset replaces the hypothetical world. Active
        save/load is unsupported.
      </p>
    </section>
  );
}
