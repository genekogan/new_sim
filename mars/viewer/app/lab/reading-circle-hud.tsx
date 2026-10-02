import { useState } from 'react';
import type { LabSim } from './sim.ts';
import type { Runtime } from '../../engine/runtime/runtime.ts';
import {
  readingCircle,
  readingCircleControl,
  readReadingCircle,
  type ReadingCircleIntent,
} from '../../engine/activities/reading-circle.ts';
import { readingCircleBinding } from '../../engine/scenarios/reading-circle.ts';
import { readBook } from '../../engine/objects/reading.ts';
import { rot2 } from '../../engine/core/math.ts';

/** Actual registered circle controls; no private executor or book/actor mutation. */
export function ReadingCircleHud({
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
  if (!['reading-circle', 'reading-circle-rotated'].includes(sim.scenario.name))
    return null;
  const rt = sim.rt,
    epoch = sim.scenarioEpoch,
    binding = readingCircleBinding(),
    yaw = sim.scenario.name === 'reading-circle-rotated' ? Math.PI / 2 : 0;
  const records = [...rt.records.values()].filter(
      (r) => r.verb === 'reading_circle',
    ),
    latest = records.at(-1),
    retained = records.findLast((r) => !!readReadingCircle(rt, r.id)),
    state = retained ? readReadingCircle(rt, retained.id) : undefined;
  const book = readBook(rt, binding.book),
    live = !!state && rt.isActive(state.session),
    fresh = () => sim.rt === rt && sim.scenarioEpoch === epoch;
  const pending = () =>
    [...rt.records.values()].some(
      (r) =>
        r.verb === 'reading_circle_control' &&
        rt.isActive(r.id) &&
        (r.params as { session: string }).session === state?.session,
    );
  const can = (intent: ReadingCircleIntent) =>
    live &&
    !pending() &&
    rt.registry.has('reading_circle_control') &&
    readingCircleControl.plan(rt, { session: state!.session, intent }).ok;
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
  const command = (intent: ReadingCircleIntent) => {
    if (!fresh() || !state || !can(intent)) return;
    reply(
      rt.submit('reading_circle_control', { session: state.session, intent }),
      `Accepted ${intent.kind}; Play advances ordinary physical execution.`,
    );
  };
  const idle = !latest && !('code' in book) && book.status === 'idle',
    unfinished =
      !!state &&
      !live &&
      state.mode === 'completed' &&
      !('code' in book) &&
      book.status === 'unfinished';
  const admission = (resume: boolean) =>
    rt.registry.has('reading_circle')
      ? readingCircle.plan(rt, {
          ...binding,
          ...(resume ? { resume: true } : {}),
        })
      : undefined;
  const startAdmission = idle ? admission(false) : undefined,
    restartAdmission = unfinished ? admission(true) : undefined;
  const start = (resume: boolean) => {
    if (
      !fresh() ||
      [...rt.records.values()].some(
        (r) => r.verb === 'reading_circle' && rt.isActive(r.id),
      )
    )
      return;
    const b = readBook(rt, binding.book);
    if (
      'code' in b ||
      b.status !== (resume ? 'unfinished' : 'idle') ||
      !admission(resume)?.ok
    )
      return;
    reply(
      rt.submit(
        'reading_circle',
        { ...binding, ...(resume ? { resume: true } : {}) },
        { preempt: false },
      ),
      resume
        ? 'New circle explicitly resumes this same reader, task and retained book bookmark; prior-circle contributions remain.'
        : 'Circle requested; Play forms actual listeners before reading.',
    );
  };
  const direction = rot2([-0.15, -5], yaw),
    walkParams = { actor: binding.reader, x: direction[0], z: direction[1] },
    walkAdmission = rt.registry.get('walk_to')?.plan(rt, walkParams);
  const directionPending = () =>
    [...rt.records.values()].some(
      (r) =>
        r.verb === 'walk_to' &&
        !r.parent &&
        rt.isActive(r.id) &&
        (r.params as { actor?: string }).actor === binding.reader,
    );
  const running =
      live &&
      ['reading', 'discussion', 'read-release', 'turn-release'].includes(
        state!.mode,
      ),
    paused = live && ['paused', 'waiting'].includes(state!.mode);
  const directReady =
    running && !pending() && !directionPending() && walkAdmission?.ok === true;
  const problem =
    state?.diagnostic ??
    latest?.diagnostic ??
    ('code' in book ? book : undefined) ??
    (restartAdmission && !restartAdmission.ok
      ? restartAdmission.diagnostic
      : startAdmission && !startAdmission.ok
        ? startAdmission.diagnostic
        : undefined);
  const members = [
    {
      actor: binding.reader,
      role: 'reader',
      active: true,
      state: state?.reader.state ?? 'invited',
      slot: binding.seat,
    },
    ...(state?.participants ??
      binding.listeners.map((m) => ({
        ...m,
        active: m.join !== false,
        role: 'listener',
        state: m.join === false ? 'invited' : 'participating',
      }))),
  ];
  return (
    <section className="lab-hud lab-classroom" data-testid="reading-circle-hud">
      <h3>Shared reading circle · same book</h3>
      <p>
        Hypothetical supported tabletop readaloud with anonymous people and a
        generic book. Reading intervals advance its actual bookmark; discussion
        uses ordinary seated and standing holds. No historical book, dialogue or
        event is reconstructed.
      </p>
      <div data-testid="reading-circle-readout">
        {state
          ? `${state.session} · ${state.status} · ${state.mode === 'completed' && !state.finished ? 'ended' : state.mode} · ${state.effects.length} retained contributions`
          : 'Not started'}
      </div>
      <div data-testid="reading-circle-book">
        {'code' in book
          ? `${book.code}: ${book.message}`
          : `${book.id} · ${book.status} · ${book.elapsed.toFixed(2)}/${book.duration || binding.duration}s · page ${book.page}/${book.pages} · ${book.task ?? binding.task} · reader ${book.user ?? binding.reader}`}
        {state?.artifact?.support?.kind === 'resting-on' && (
          <div>
            Supported by {state.artifact.support.on}#
            {state.artifact.support.slot}
          </div>
        )}
      </div>
      <div data-testid="reading-circle-floor">
        Floor: <b>{state?.floorHolder ?? '—'}</b>
        {state?.mode === 'discussion' &&
          ` · ${state.turn.kind} · ${state.turn.elapsed.toFixed(2)}s`}
        {state?.attentionTarget && (
          <div>Shared attention: {state.attentionTarget.entity}</div>
        )}
        {state?.pendingQuestion !== undefined && (
          <div>
            Question {state.pendingQuestion + 1} awaits an eligible answer.
          </div>
        )}
      </div>
      <div className="lab-classroom-controls">
        <button
          disabled={!idle || startAdmission?.ok !== true}
          onClick={() => start(false)}
        >
          Start shared reading
        </button>
        <button
          disabled={!unfinished || restartAdmission?.ok !== true}
          onClick={() => start(true)}
        >
          Resume unfinished book
        </button>
        <button
          disabled={!running || !can({ kind: 'pause' })}
          onClick={() => command({ kind: 'pause' })}
        >
          Pause circle
        </button>
        <button
          disabled={!paused || !can({ kind: 'resume' })}
          onClick={() => command({ kind: 'resume' })}
        >
          Resume circle
        </button>
        <button
          disabled={!live || state?.mode === 'ending' || !can({ kind: 'end' })}
          onClick={() => command({ kind: 'end' })}
        >
          End circle
        </button>
        <button
          disabled={!directReady}
          onClick={() => {
            if (
              !fresh() ||
              !state ||
              !rt.isActive(state.session) ||
              ![
                'reading',
                'discussion',
                'read-release',
                'turn-release',
              ].includes(readReadingCircle(rt, state.session)!.mode) ||
              pending() ||
              directionPending() ||
              !rt.registry.get('walk_to')?.plan(rt, walkParams).ok
            )
              return;
            reply(
              rt.submit('walk_to', walkParams),
              'Reader direction requested. Existing actions safely release before walking; Resume circle is explicit.',
            );
          }}
        >
          Direct reader away
        </button>
      </div>
      {members.map((m) => {
        const leave: ReadingCircleIntent = {
          kind: 'leave',
          actor: m.actor,
          to: rot2(
            m.actor === 'listener-1'
              ? [-4, -4]
              : m.actor === 'listener-2'
                ? [4, -4]
                : [4, 4],
            yaw,
          ),
        };
        return (
          <div key={m.actor} data-testid={`reading-circle-${m.actor}`}>
            <div>
              {m.actor} · {m.role} · {m.state} · {m.slot}
            </div>
            <div className="lab-classroom-controls">
              <button
                disabled={!can({ kind: 'ask', actor: m.actor })}
                onClick={() => command({ kind: 'ask', actor: m.actor })}
              >
                Ask {m.actor}
              </button>
              <button
                disabled={!can({ kind: 'answer', actor: m.actor })}
                onClick={() => command({ kind: 'answer', actor: m.actor })}
              >
                Answer {m.actor}
              </button>
              <button
                disabled={!can({ kind: 'floor', actor: m.actor })}
                onClick={() => command({ kind: 'floor', actor: m.actor })}
              >
                Floor {m.actor}
              </button>
              {m.role === 'listener' && (
                <>
                  <button
                    disabled={
                      m.active || !can({ kind: 'join', actor: m.actor })
                    }
                    onClick={() => command({ kind: 'join', actor: m.actor })}
                  >
                    Join {m.actor}
                  </button>
                  <button
                    disabled={!m.active || !can(leave)}
                    onClick={() => command(leave)}
                  >
                    Leave {m.actor}
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
      {!!state?.effects.length && (
        <ol data-testid="reading-circle-effects">
          {state.effects.map((e, i) => (
            <li key={i}>
              {e.actor}: {e.kind} · {e.book} page {e.page} · bookmark{' '}
              {e.readSeconds.toFixed(2)}s · turn {e.seconds.toFixed(2)}s
              {e.replyTo !== undefined
                ? ` · answers contribution ${e.replyTo + 1}`
                : ''}
            </li>
          ))}
        </ol>
      )}
      {records
        .filter((r) => r.id !== state?.session)
        .map((r) => {
          const previous = readReadingCircle(rt, r.id);
          return (
            previous && (
              <p key={r.id} data-testid="reading-circle-prior">
                Prior circle {r.id} ·{' '}
                {previous.finished ? 'completed' : 'ended'} ·{' '}
                {previous.effects.length} retained contributions · bookmark{' '}
                {previous.elapsed.toFixed(2)}s
              </p>
            )
          );
        })}
      {problem && (
        <p role="alert" data-testid="reading-circle-diagnostic">
          {problem.code}: {problem.message}
        </p>
      )}
      <p role="status" data-testid="reading-circle-feedback">
        {state?.mode === 'completed'
          ? state.finished
            ? 'Reading and final discussion complete; same book and contributions remain.'
            : !('code' in book) && book.status === 'completed'
              ? 'Circle ended before final discussion completed; the book is complete and contributions remain.'
              : 'Circle ended early; actual unfinished bookmark and contributions remain. Use Resume unfinished book to start a new circle explicitly.'
          : feedback?.runtime === rt && feedback.epoch === epoch
            ? feedback.text
            : 'Start, then Play. Global Pause freezes time.'}
      </p>
      <p>
        Pause releases physical work while preserving this circle’s bookmark and
        discussion. End releases the circle; an unfinished book can continue
        only with the same reader/task. Join admits declared listeners; Leave
        walks away independently. Reset replaces this world. Active save/load
        and reader handoff remain unsupported.
      </p>
    </section>
  );
}
