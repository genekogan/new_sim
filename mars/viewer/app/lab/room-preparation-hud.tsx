import { useState } from 'react';
import type { LabSim } from './sim.ts';
import type { Runtime } from '../../engine/runtime/runtime.ts';
import type { Entity } from '../../engine/world/types.ts';
import {
  roomPreparation,
  roomPreparationControl,
  readRoomPreparation,
  type RoomPreparationControlParams,
} from '../../engine/activities/room-preparation.ts';
import { roomPreparationBinding } from '../../engine/scenarios/room-preparation.ts';
import { classroomControl } from '../../engine/activities/classroom.ts';
import type { ClassroomIntent } from '../../engine/activities/types.ts';
const support = (s: Entity['support']) =>
  s?.kind === 'held'
    ? `held by ${s.by.join(', ')}`
    : s?.kind === 'resting-on'
      ? `${s.kind} ${s.on}#${s.slot}`
      : s?.kind === 'in-hand'
        ? `${s.kind} ${s.by}/${s.hand}`
        : (s?.kind ?? 'unavailable');
/** Registered requests only. Existing cleanup/setup/session executors own physics. */
export function RoomPreparationHud({
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
  if (sim.scenario.name !== 'room-preparation') return null;
  const rt = sim.rt,
    epoch = sim.scenarioEpoch,
    binding = roomPreparationBinding();
  const records = [...rt.records.values()].filter(
      (r) => r.verb === 'room_preparation',
    ),
    latest = records.at(-1);
  const state = latest ? readRoomPreparation(rt, latest.id) : undefined;
  const bound = state?.bindings ?? binding;
  const live = !!state && rt.isActive(state.preparation),
    session = state?.session;
  const fresh = () => sim.rt === rt && sim.scenarioEpoch === epoch;
  const pending = () =>
    [...rt.records.values()].some(
      (r) =>
        rt.isActive(r.id) &&
        ((r.verb === 'room_preparation_control' &&
          (r.params as { preparation?: string }).preparation ===
            state?.preparation) ||
          (r.verb === 'classroom_control' &&
            (r.params as { session?: string }).session === session?.session)),
    );
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
  const admission =
    !latest && rt.registry.has('room_preparation')
      ? roomPreparation.plan(rt, binding)
      : undefined;
  const can = (intent: RoomPreparationControlParams['intent']) =>
    live &&
    !pending() &&
    rt.registry.has('room_preparation_control') &&
    roomPreparationControl.plan(rt, { preparation: state!.preparation, intent })
      .ok;
  const command = (intent: RoomPreparationControlParams['intent']) => {
    if (!fresh() || !state || !can(intent)) return;
    reply(
      rt.submit('room_preparation_control', {
        preparation: state.preparation,
        intent,
      }),
      intent === 'resume' && state.stage === 'arranging'
        ? 'Explicitly retrying only remaining fixtures from their actual safe ground placements. Completed storage/table work stays retained.'
        : intent === 'end'
          ? 'End requested. Play drains actual children; supported stored items and partial room placements stay.'
          : intent === 'pause'
            ? 'Pause requested. Play completes ordinary safe item return or fixture set-down before the local pause.'
            : 'Explicitly continuing the retained cleanup/preparation.',
    );
  };
  const intent = (kind: 'join' | 'question' | 'advance'): ClassroomIntent =>
    kind === 'join'
      ? { kind, actor: bound.late.actor, departure: bound.late.departure }
      : kind === 'question'
        ? { kind, actor: bound.late.actor }
        : { kind };
  const canSession = (kind: 'join' | 'question' | 'advance') =>
    live &&
    !!session &&
    rt.isActive(session.session) &&
    !pending() &&
    rt.registry.has('classroom_control') &&
    classroomControl.plan(rt, {
      session: session.session,
      intent: intent(kind),
    }).ok;
  const sessionCommand = (kind: 'join' | 'question' | 'advance') => {
    if (!fresh() || !session || !canSession(kind)) return;
    reply(
      rt.submit('classroom_control', {
        session: session.session,
        intent: intent(kind),
      }),
      `Accepted ordinary classroom ${kind}. Play advances real arrival, floor and movement.`,
    );
  };
  const pausePlan =
    live && rt.registry.has('room_preparation_control')
      ? roomPreparationControl.plan(rt, {
          preparation: state!.preparation,
          intent: 'pause',
        })
      : undefined;
  const problem =
    state?.diagnostic ??
    latest?.diagnostic ??
    (admission && !admission.ok ? admission.diagnostic : undefined);
  const visitor = session?.participants.find(
    (p) => p.actor === bound.late.actor,
  );
  return (
    <section
      className="lab-hud lab-classroom"
      data-testid="room-preparation-hud"
    >
      <h3>Prepare a room, then use it</h3>
      <p>
        Hypothetical classroom and people. The same bowl/spoon start in
        explicitly supported interior slots, are stored physically, then the
        empty table and spare chair are carried into the side layout. No
        historical session or automatic furnishing plan is claimed.
      </p>
      <div data-testid="room-preparation-readout">
        {state
          ? `${state.preparation} · ${state.status} · ${state.stage} · ${state.mode === 'completed' ? (state.finished ? 'completed' : 'ended') : state.mode}`
          : 'Ready: clear, arrange, gather'}
        {session && (
          <div>
            Classroom {session.phase} · floor {session.floorHolder ?? 'none'}
          </div>
        )}
      </div>
      <div className="lab-classroom-controls">
        <button
          disabled={!!latest || admission?.ok !== true}
          onClick={() => {
            if (
              !fresh() ||
              [...rt.records.values()].some(
                (r) => r.verb === 'room_preparation',
              ) ||
              !rt.registry.has('room_preparation')
            )
              return;
            const plan = roomPreparation.plan(rt, binding);
            if (!plan.ok) {
              reply(plan, '');
              return;
            }
            reply(
              rt.submit('room_preparation', binding, { preempt: false }),
              'Preparation requested. Play runs ordinary tidy, carry and classroom actions.',
            );
          }}
        >
          Start room preparation
        </button>
        <button disabled={!can('pause')} onClick={() => command('pause')}>
          Pause preparation
        </button>
        <button disabled={!can('resume')} onClick={() => command('resume')}>
          Resume preparation
        </button>
        <button disabled={!can('end')} onClick={() => command('end')}>
          End preparation
        </button>
      </div>
      {state?.mode === 'pausing' && (
        <p>
          Play must finish safe physical release. Resume is unavailable until
          the current item/fixture is supported.
        </p>
      )}
      {state?.stage === 'arranging' &&
        ['paused', 'waiting'].includes(state.mode) && (
          <p>
            Resume preparation means an explicit new physical setup attempt from
            actual ground poses. Already placed fixtures are skipped; this is
            not active setup graph reload.
          </p>
        )}
      {pausePlan &&
        !pausePlan.ok &&
        pausePlan.diagnostic.code ===
          'room_preparation.session-pause-unsupported' && (
          <p role="status" data-testid="room-preparation-pause-limit">
            {pausePlan.diagnostic.code}: {pausePlan.diagnostic.message}
          </p>
        )}
      <div data-testid="room-preparation-current">
        Bound child: {state?.child ?? 'none'}
        {state?.child &&
          ` · ${rt.records.get(state.child)?.status ?? 'unavailable'}`}
        {state?.tidy && (
          <div>
            Cleanup {state.tidy.task} · {state.tidy.actor} · {state.tidy.mode} ·{' '}
            {state.tidy.completed.length}/2 stored
            {state.stage === 'clearing' &&
              state.tidy.current &&
              ` · ${state.tidy.current.item} ${state.tidy.current.phase} · ${state.tidy.current.held ? 'held' : 'supported'}`}
          </div>
        )}
        {state?.setup && (
          <div>
            Setup {state.setup.action} · {state.setup.phase} ·{' '}
            {state.setup.completed.length}/{state.setup.targets.length} in this
            attempt
            {state.setup.current &&
              ` · ${state.setup.current.fixture} ${state.setup.current.phase} · ${state.setup.current.held ? `held by ${state.setup.current.crew.join(', ')}` : 'ground support'}`}
          </div>
        )}
      </div>
      <div data-testid="room-preparation-items">
        {bound.tidy.transfers.map((t) => {
          const e = rt.world.entities[t.item];
          return (
            <div key={t.item}>
              {t.item} · {e?.def ?? 'missing'} · {support(e?.support)} ·{' '}
              {t.from} → {t.to}
              {e?.contents && ` · ${e.contents.food} ${e.contents.fraction}`}
            </div>
          );
        })}
      </div>
      <div data-testid="room-preparation-layout">
        {bound.setup.moves.map((m) => {
          const e = rt.world.entities[m.fixture],
            p = state?.placements.find((p) => p.fixture === m.fixture);
          return (
            <div key={m.fixture}>
              {m.fixture} · {support(e?.support)} · at [
              {e?.pose.p.join(', ') ?? 'missing'}] · target [{m.to.x}, 0,{' '}
              {m.to.z}] · {p?.atTarget ? 'at target' : 'not yet at target'}
            </div>
          );
        })}
      </div>
      {session && (
        <div data-testid="room-preparation-session">
          Session {session.session} · {session.phase} · floor{' '}
          {session.floorHolder ?? 'none'}
          {session.waitingReason && ` · ${session.waitingReason}`}
          <div>
            Visitor:{' '}
            {visitor
              ? `${visitor.state} · ${visitor.arrival} · ${visitor.seat}`
              : 'not joined'}{' '}
            · declared departure [{bound.late.departure.join(', ')}]
          </div>
          <div className="lab-classroom-controls">
            <button
              disabled={!canSession('join')}
              onClick={() => sessionCommand('join')}
            >
              Join visitor
            </button>
            <button
              disabled={!canSession('question')}
              onClick={() => sessionCommand('question')}
            >
              Ask visitor
            </button>
            <button
              disabled={!canSession('advance')}
              onClick={() => sessionCommand('advance')}
            >
              Advance presenter
            </button>
          </div>
        </div>
      )}
      {problem && (
        <p role="status" data-testid="room-preparation-diagnostic">
          {problem.code}: {problem.message}
        </p>
      )}
      <p role="status" data-testid="room-preparation-feedback">
        {feedback?.runtime === rt && feedback.epoch === epoch
          ? feedback.text
          : 'Start, then Play. Local Pause is available through cleanup/setup; End drains any stage.'}
      </p>
      <small>
        Global Pause freezes the whole world. Local cleanup Resume preserves its
        existing task; setup Resume retries only remaining actual placements.
        Once the session begins, use ordinary classroom controls and global
        Pause; local classroom continuation and active save/load are
        unsupported. Reset creates the initial hypothetical world.
      </small>
    </section>
  );
}
