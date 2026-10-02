import { useState } from 'react';
import type { LabSim } from './sim.ts';
import type { Runtime } from '../../engine/runtime/runtime.ts';
import {
  galleryTour,
  galleryTourControl,
  readGalleryTour,
  type GalleryControlParams,
} from '../../engine/activities/gallery-tour.ts';
import { galleryTourBinding } from '../../engine/scenarios/gallery-tour.ts';
import { readDrawing } from '../../engine/objects/drawing.ts';

/** Ordinary registered requests only; no executor, actor or artwork mutation. */
export function GalleryTourHud({
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
  if (!['gallery-tour', 'gallery-tour-short'].includes(sim.scenario.name))
    return null;
  const rt = sim.rt,
    epoch = sim.scenarioEpoch,
    binding = galleryTourBinding();
  if (sim.scenario.name === 'gallery-tour-short')
    binding.stops = binding.stops.slice(0, 2);
  const records = [...rt.records.values()].filter(
      (r) => r.verb === 'gallery_tour',
    ),
    latest = records.at(-1),
    retained = records.findLast((r) => !!readGalleryTour(rt, r.id)),
    state = retained ? readGalleryTour(rt, retained.id) : undefined;
  const live = !!state && rt.isActive(state.tour),
    current = state?.current,
    host = binding.stops[0].sharing.host.actor;
  const pending = () =>
    [...rt.records.values()].some(
      (r) =>
        r.verb === 'gallery_tour_control' &&
        rt.isActive(r.id) &&
        (r.params as GalleryControlParams).tour === state?.tour,
    );
  const fresh = () => sim.rt === rt && sim.scenarioEpoch === epoch;
  const can = (intent: GalleryControlParams['intent']) =>
    live &&
    !pending() &&
    rt.registry.has('gallery_tour_control') &&
    galleryTourControl.plan(rt, { tour: state!.tour, intent }).ok;
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
  const command = (intent: GalleryControlParams['intent']) => {
    if (!fresh() || !state || !can(intent)) return;
    reply(
      rt.submit('gallery_tour_control', { tour: state.tour, intent }),
      `Accepted ${intent.kind}; Play advances ordinary physical actions.`,
    );
  };
  const admission =
    !state && rt.registry.has('gallery_tour')
      ? galleryTour.plan(rt, binding)
      : undefined;
  const walkParams = { actor: host, x: -8, z: -8 },
    walkAdmission = rt.registry.get('walk_to')?.plan(rt, walkParams);
  const directionPending = () =>
    [...rt.records.values()].some(
      (r) =>
        r.verb === 'walk_to' &&
        !r.parent &&
        rt.isActive(r.id) &&
        (r.params as { actor?: string }).actor === host,
    );
  const directReady =
    live &&
    state?.mode === 'sharing' &&
    !pending() &&
    !directionPending() &&
    walkAdmission?.ok === true;
  const pad = state?.pad ?? binding.stops[0].sharing.pad,
    art = readDrawing(rt, pad),
    stop = binding.stops[Math.min(state?.index ?? 0, binding.stops.length - 1)];
  const problem =
    state?.diagnostic ??
    latest?.diagnostic ??
    (admission && !admission.ok ? admission.diagnostic : undefined);
  return (
    <section className="lab-hud lab-classroom" data-testid="gallery-tour-hud">
      <h3>Guided gallery walk · same artworks</h3>
      <p>
        Hypothetical pre-made gallery studies and anonymous people. This preset
        walks among {binding.stops.length} supported marked pads; it does not
        draw new marks or reconstruct a historical exhibition.
      </p>
      <div data-testid="gallery-tour-readout">
        {state
          ? `${state.tour} · ${state.status} · ${state.mode === 'completed' && !state.finished ? 'ended' : state.mode} · ${state.history.length}/${binding.stops.length} completed stops`
          : 'Not started'}
      </div>
      {live &&
        state?.mode === 'sharing' &&
        walkAdmission &&
        !walkAdmission.ok && (
          <p role="status" data-testid="gallery-tour-direction-diagnostic">
            Host direction unavailable: {walkAdmission.diagnostic.code}:{' '}
            {walkAdmission.diagnostic.message}
          </p>
        )}
      <div data-testid="gallery-tour-artifact">
        {state?.mode === 'completed'
          ? 'Tour retained its artwork history.'
          : `Stop ${Math.min((state?.index ?? 0) + 1, binding.stops.length)}: ${pad}`}
        {!('code' in art) &&
          ` · ${art.completedMarks.length}/${art.totalMarks} actual retained marks · ${art.task ?? art.status}`}
        {'code' in art && ` · ${art.code}: ${art.message}`}
        {current?.artifact?.support?.kind === 'resting-on' && (
          <div>
            Supported by {current.artifact.support.on}#
            {current.artifact.support.slot}
          </div>
        )}
      </div>
      <div data-testid="gallery-tour-floor">
        Floor: <b>{current?.floorHolder ?? '—'}</b>
        {current?.floorHolder &&
          ` · ${current.turn.kind} · ${current.turn.elapsed.toFixed(1)}s`}
        {current?.attentionTarget && (
          <div>Shared attention: {current.attentionTarget.entity}</div>
        )}
        {current && (
          <div>
            Discussion {current.elapsed.toFixed(1)}/{current.duration}s ·{' '}
            {current.effects.length} retained contributions
          </div>
        )}
      </div>
      <div className="lab-classroom-controls">
        <button
          disabled={!!latest || admission?.ok !== true}
          onClick={() => {
            if (
              !fresh() ||
              [...rt.records.values()].some((r) => r.verb === 'gallery_tour') ||
              !rt.registry.has('gallery_tour') ||
              !galleryTour.plan(rt, binding).ok
            )
              return;
            reply(
              rt.submit('gallery_tour', binding, { preempt: false }),
              'Tour requested; Play walks to the first actual artwork.',
            );
          }}
        >
          Start gallery tour
        </button>
        <button
          disabled={
            !live ||
            ['paused', 'pausing', 'ending', 'completed'].includes(
              state!.mode,
            ) ||
            !can({ kind: 'pause' })
          }
          onClick={() => command({ kind: 'pause' })}
        >
          Pause tour
        </button>
        <button
          disabled={
            !live ||
            !['paused', 'waiting'].includes(state!.mode) ||
            !can({ kind: 'resume' })
          }
          onClick={() => command({ kind: 'resume' })}
        >
          Resume tour
        </button>
        <button
          disabled={!live || state?.mode === 'ending' || !can({ kind: 'end' })}
          onClick={() => command({ kind: 'end' })}
        >
          End tour
        </button>
        <button
          disabled={!directReady}
          onClick={() => {
            if (
              !fresh() ||
              !state ||
              !rt.isActive(state.tour) ||
              readGalleryTour(rt, state.tour)?.mode !== 'sharing' ||
              directionPending() ||
              pending() ||
              !rt.registry.get('walk_to')?.plan(rt, walkParams).ok
            )
              return;
            reply(
              rt.submit('walk_to', walkParams),
              'Host direction requested. Existing viewing holds release before the ordinary walk; Resume tour is explicit.',
            );
          }}
        >
          Direct host away
        </button>
      </div>
      {(
        state?.members ??
        [
          binding.stops[0].sharing.host,
          ...binding.stops[0].sharing.visitors,
        ].map((m) => ({
          actor: m.actor,
          active: m.join !== false,
          state: m.join === false ? 'invited' : 'participating',
        }))
      ).map((m) => {
        const physical = current?.participants.find((p) => p.actor === m.actor),
          departure = stop.departure.find((d) => d.actor === m.actor)!.to,
          leave: GalleryControlParams['intent'] = {
            kind: 'leave',
            actor: m.actor,
            to: departure,
          };
        return (
          <div key={m.actor} data-testid={`gallery-tour-${m.actor}`}>
            <div>
              {m.actor} · {m.actor === host ? 'host' : 'visitor'} · {m.state}
              {physical ? ` · ${physical.state} · ${physical.slot}` : ''}
              {physical?.physicallyViewing ? ' · viewing actual artwork' : ''}
            </div>
            <div className="lab-classroom-controls">
              <button
                disabled={
                  !physical?.physicallyViewing ||
                  !can({ kind: 'ask', actor: m.actor })
                }
                onClick={() => command({ kind: 'ask', actor: m.actor })}
              >
                Ask {m.actor}
              </button>
              <button
                disabled={
                  !physical?.physicallyViewing ||
                  !can({ kind: 'answer', actor: m.actor })
                }
                onClick={() => command({ kind: 'answer', actor: m.actor })}
              >
                Answer {m.actor}
              </button>
              <button
                disabled={
                  !physical?.physicallyViewing ||
                  !can({ kind: 'floor', actor: m.actor })
                }
                onClick={() => command({ kind: 'floor', actor: m.actor })}
              >
                Floor {m.actor}
              </button>
              {m.actor !== host && (
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
      {!!current?.effects.length && (
        <ol data-testid="gallery-tour-contributions">
          {current.effects.map((e) => (
            <li key={e.index}>
              {e.actor}: {e.kind} · {e.marks} marks on {e.pad}
              {e.replyTo !== undefined
                ? ` · answers contribution ${e.replyTo + 1}`
                : ''}
            </li>
          ))}
        </ol>
      )}
      {!!state?.history.length && (
        <ol data-testid="gallery-tour-history">
          {state.history.map((h) => (
            <li key={h.index}>
              Stop {h.index + 1} · {h.pad} ·{' '}
              {h.sharing.artifact?.marks.length ?? 0} actual marks ·{' '}
              {h.sharing.effects.length} retained contributions ·{' '}
              {h.sharing.finished ? 'complete' : 'unfinished'}
            </li>
          ))}
        </ol>
      )}
      {problem && (
        <p role="alert" data-testid="gallery-tour-diagnostic">
          {problem.code}: {problem.message}
        </p>
      )}
      {state?.mode === 'waiting' && (
        <p data-testid="gallery-tour-wait">
          Binding attempts {state.retry.attempts}/{state.retry.limit} ·{' '}
          {state.retry.automatic
            ? 'bounded automatic retry'
            : 'explicit Resume, eligible Join or End required'}
        </p>
      )}
      <p role="status" data-testid="gallery-tour-feedback">
        {state?.mode === 'completed'
          ? state.finished
            ? 'Tour complete; artwork and per-stop history remain.'
            : 'Tour ended early; physical work released, retained history remains.'
          : feedback?.runtime === rt && feedback.epoch === epoch
            ? feedback.text
            : 'Start, then Play. Global Pause freezes time for inspection.'}
      </p>
      <p>
        Each new stop requires the host and two active viewers. Leave persists
        at later stops; Join admits only a declared person. Pause tour retains
        discussion progress while releasing physical holds. Resume is explicit;
        Reset starts a fresh world.
      </p>
    </section>
  );
}
