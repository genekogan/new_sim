import { useState } from 'react';
import type { LabSim } from './sim.ts';
import {
  gardenCircuit,
  gardenCircuitControl,
  readGardenCircuit,
} from '../../engine/activities/garden-circuit.ts';
import { gardenCircuitBinding } from '../../engine/scenarios/garden-circuit.ts';
/** Same finite pot/bowl; registered children own all material and physical changes. */
export function GardenCircuitHud({
  sim,
  refresh,
}: {
  sim: LabSim;
  refresh: () => void;
}) {
  const [feedback, setFeedback] = useState<{ epoch: number; text: string }>();
  if (sim.scenario.name !== 'garden-circuit') return null;
  const rt = sim.rt,
    epoch = sim.scenarioEpoch,
    binding = gardenCircuitBinding(),
    latest = [...rt.records.values()].findLast(
      (r) => r.verb === 'garden_circuit',
    ),
    s = latest ? readGardenCircuit(rt, latest.id) : undefined;
  const fresh = () => sim.rt === rt && sim.scenarioEpoch === epoch;
  const pending = () =>
    [...rt.records.values()].some(
      (r) =>
        r.verb === 'garden_circuit_control' &&
        rt.isActive(r.id) &&
        (r.params as { circuit?: string }).circuit === s?.circuit,
    );
  const can = (intent: 'pause' | 'resume' | 'end') =>
    s && !pending() && rt.registry.has('garden_circuit_control')
      ? gardenCircuitControl.plan(rt, { circuit: s.circuit, intent })
      : undefined;
  const initial =
    !latest && rt.registry.has('garden_circuit')
      ? gardenCircuit.plan(rt, binding)
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
  const control = (intent: 'pause' | 'resume' | 'end') => {
    if (
      !fresh() ||
      !s ||
      (intent === 'pause' &&
        ['paused', 'ending', 'ended', 'completed'].includes(
          readGardenCircuit(rt, s.circuit)?.mode ?? '',
        )) ||
      [...rt.records.values()].findLast((r) => r.verb === 'garden_circuit')
        ?.id !== s.circuit ||
      can(intent)?.ok !== true
    )
      return;
    reply(
      rt.submit(
        'garden_circuit_control',
        { circuit: s.circuit, intent },
        { preempt: false },
      ),
      `${intent} accepted. Keep Play running for ordinary safe support; Resume is explicit.`,
    );
  };
  const direction = { actor: binding.actor, x: -5, z: 3 },
    walking = () =>
      [...rt.records.values()].some(
        (r) =>
          r.verb === 'walk_to' &&
          !r.parent &&
          rt.isActive(r.id) &&
          (r.params as { actor?: string }).actor === direction.actor,
      ),
    direct = () =>
      s?.mode === 'paused' &&
      !pending() &&
      !walking() &&
      rt.registry.has('walk_to');
  const walk = [...rt.records.values()].findLast(
      (r) =>
        r.verb === 'walk_to' &&
        !r.parent &&
        (r.params as { actor?: string }).actor === direction.actor,
    ),
    walkIssue =
      walk && !['completed', 'cancelled'].includes(walk.status)
        ? walk.diagnostic
        : undefined;
  const next = s?.plants.find((p) => !('code' in p) && p.plant === s.nextPlant),
    due =
      s &&
      !s.current &&
      s.index % 2 === 1 &&
      next &&
      !('code' in next) &&
      !next.due
        ? next
        : undefined;
  const diagnostic =
      s?.diagnostic ??
      latest?.diagnostic ??
      (initial && !initial.ok ? initial.diagnostic : undefined),
    resume = can('resume');
  return (
    <section className="lab-hud lab-classroom" data-testid="garden-circuit-hud">
      <h3>Finite garden circuit · same water</h3>
      <p>
        Hypothetical ground planters and one carer. The same supported water pot
        supplies the same bowl twice; ordinary care follows A → A → B → B → C →
        C. No growth or unlimited refill is claimed.
      </p>
      <div data-testid="garden-circuit-state">
        {s
          ? `${s.circuit} · ${s.status} · ${s.mode} · ${s.index}/6 actual care cycles · next ${s.nextPlant ?? 'none'} · ${s.current ? `${s.current.verb} ${s.current.phase ?? s.current.status}` : 'no physical child'}`
          : 'Not started'}
      </div>
      <div className="lab-classroom-controls">
        <button
          disabled={!!latest || initial?.ok !== true}
          onClick={() => {
            if (
              !fresh() ||
              [...rt.records.values()].some(
                (r) => r.verb === 'garden_circuit',
              ) ||
              !rt.registry.has('garden_circuit') ||
              !gardenCircuit.plan(rt, binding).ok
            )
              return;
            reply(
              rt.submit('garden_circuit', binding, { preempt: false }),
              'Circuit accepted. Play advances real resupply, care and due waiting.',
            );
          }}
        >
          Start circuit
        </button>
        {(['pause', 'resume', 'end'] as const).map((intent) => (
          <button
            key={intent}
            disabled={
              can(intent)?.ok !== true ||
              (intent === 'pause' &&
                (s?.mode === 'paused' || s?.mode === 'ending'))
            }
            onClick={() => control(intent)}
          >
            {intent[0].toUpperCase() + intent.slice(1)} circuit
          </button>
        ))}
        <button
          disabled={!direct()}
          onClick={() => {
            if (
              !fresh() ||
              !s ||
              readGardenCircuit(rt, s.circuit)?.mode !== 'paused' ||
              !direct()
            )
              return;
            reply(
              rt.submit('walk_to', direction),
              'Carer directed through an ordinary walk after safe local Pause. Resume waits for that independent walk and retains material/purpose.',
            );
          }}
        >
          Direct carer away
        </button>
      </div>
      <p>
        .25 pot supplies 1 bowl unit. Initial .5 pot = 2 bowl units; six .25
        care cycles deliver 1.5 and leave .5 in the same bowl. Quantities use
        the existing vessel capacities.
      </p>
      {s && (
        <>
          <div data-testid="garden-circuit-materials">
            <p>
              {s.source?.id} · {s.source?.contents?.food}:{' '}
              {s.source?.contents?.fraction} pot ·{' '}
              {JSON.stringify(s.source?.support)}
            </p>
            <p>
              {s.water?.id} · {s.water?.contents?.food}:{' '}
              {s.water?.contents?.fraction} bowl ·{' '}
              {JSON.stringify(s.water?.support)}
            </p>
            <p>
              Actually held:{' '}
              {s.held.map((h) => `${h.item} · ${h.hand}`).join(', ') || 'none'}
            </p>
          </div>
          <div data-testid="garden-circuit-care">
            {s.plants.map((p, i) => (
              <p key={s.bindings.plants[i]}>
                {'code' in p
                  ? `${p.code}: ${p.message}`
                  : `${p.plant} · ${p.cycles} cycles · ${p.waterReceived} received · pending ${p.pending?.purpose ?? 'none'} / ${p.pending?.delivered ?? 0} · last actual care tick ${p.lastCareTick ?? 'none'}`}
              </p>
            ))}
          </div>
          <p data-testid="garden-circuit-due">
            {due
              ? `${due.plant} genuinely waits ${due.remainingTicks} ordinary ticks from its last deposit; interval ${due.intervalTicks}. Keep Play running; global Pause freezes this clock.`
              : 'No outstanding due wait at the next planter.'}
          </p>
          <div data-testid="garden-circuit-history">
            {s.history.map(
              (r) =>
                r && (
                  <p key={r.id}>
                    {r.id} · {r.verb} · {r.status} · {r.phase ?? 'no phase'}
                  </p>
                ),
            )}
          </div>
        </>
      )}
      {diagnostic && (
        <p role="alert" data-testid="garden-circuit-diagnostic">
          {diagnostic.code}: {diagnostic.message}
        </p>
      )}
      {s && ['paused', 'waiting'].includes(s.mode) && resume && !resume.ok && (
        <p role="alert">
          Resume refused · {resume.diagnostic.code}: {resume.diagnostic.message}
        </p>
      )}
      {walkIssue && (
        <p role="alert">
          {walkIssue.code}: {walkIssue.message}
        </p>
      )}
      {!rt.registry.has('garden_circuit') && (
        <p role="alert">
          action.unregistered: garden_circuit must be registered before this
          preset starts.
        </p>
      )}
      <p role="status">
        {s?.mode === 'ended'
          ? 'Ended early; real deposits and remaining source/bowl material retained.'
          : s?.finished
            ? 'Six actual care cycles complete; bowl supported and all physical claims released.'
            : feedback?.epoch === epoch
              ? feedback.text
              : 'Start, then Play. Due waiting advances only through ordinary running time.'}
      </p>
      <p>
        Local Pause drains the current leaf and physically returns the bowl to
        its declared table slot. Resume continues the same Runtime, actor,
        source, bowl and retained partial care. End safely drains and preserves
        effects; it is distinct from completion. A stopped return needs explicit
        End or Pause retry after the named support/route is restored; no false
        release. Reset stages a fresh hypothetical world. No growth, spawn,
        replacement source, washing, unlimited water or active reload
        restoration.
      </p>
    </section>
  );
}
