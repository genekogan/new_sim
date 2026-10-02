import { useState } from 'react';
import type { LabSim } from './sim.ts';
import {
  artSharing,
  artSharingControl,
  readArtSharing,
  type ArtSharingIntent,
} from '../../engine/activities/art-sharing.ts';
import { artSharingBinding } from '../../engine/scenarios/art-sharing.ts';
import { readDrawing } from '../../engine/objects/drawing.ts';
import type { Vec2 } from '../../engine/core/math.ts';

/** Requests ordinary registered controls; the HUD never moves people or changes artwork. */
export function ArtSharingHud({
  sim,
  refresh,
}: {
  sim: LabSim;
  refresh: () => void;
}) {
  const [feedback, setFeedback] = useState(
    'Play advances arrivals and discussion turns.',
  );
  const standalone = sim.scenario.name === 'art-sharing';
  if (!standalone && sim.scenario.name !== 'creative-afternoon') return null;
  const rt = sim.rt;
  const records = [...rt.records.values()].filter(
    (r) => r.verb === 'art_sharing',
  );
  const latest = records.at(-1);
  const retained = records.findLast(
    (record) => !!readArtSharing(rt, record.id),
  );
  const state = retained ? readArtSharing(rt, retained.id) : undefined;
  const live = !!state && rt.isActive(state.session);
  const running =
    live && ['arriving', 'sharing', 'changing'].includes(state.mode);
  const paused = live && ['paused', 'waiting'].includes(state.mode);
  const pad = state?.pad ?? 'sketch-pad';
  const drawing = readDrawing(rt, pad);
  const available = !('code' in drawing);
  const pendingControls = [...rt.records.values()].some(
    (r) =>
      r.verb === 'art_sharing_control' &&
      rt.isActive(r.id) &&
      (r.params as { session?: string }).session === state?.session,
  );
  // The same authoritative admission check covers physical presence, queued
  // questions, valid answers, current session lifecycle, routes and free places.
  const can = (intent: ArtSharingIntent) =>
    live &&
    !pendingControls &&
    artSharingControl.plan(rt, { session: state!.session, intent }).ok;
  const command = (intent: ArtSharingIntent) => {
    if (!state || !rt.isActive(state.session)) return;
    const record = rt.submit('art_sharing_control', {
      session: state.session,
      intent,
    });
    setFeedback(
      record.diagnostic
        ? `${record.diagnostic.code}: ${record.diagnostic.message}`
        : `Accepted ${intent.kind}${'actor' in intent ? ` for ${intent.actor}` : ''}; Play advances ordinary physical actions.`,
    );
    refresh();
  };
  const startBinding = standalone && !state ? artSharingBinding() : undefined;
  const admission =
    startBinding && rt.registry.has('art_sharing')
      ? artSharing.plan(rt, startBinding)
      : undefined;
  const startReady = admission?.ok === true;
  const departure = (actor: string): Vec2 =>
    actor === 'art-visitor1'
      ? [-4, -4]
      : actor === 'art-visitor2'
        ? [4, -4]
        : [4, 4];
  const problem =
    state?.diagnostic ??
    latest?.diagnostic ??
    (admission && !admission.ok ? admission.diagnostic : undefined);
  return (
    <section className="lab-hud lab-classroom" data-testid="art-sharing-hud">
      <h3>Art sharing · retained drawing</h3>
      <p>
        {standalone
          ? 'Hypothetical sharing around a pre-made shelter-study fixture. The marks already exist on this pad; this preset does not draw them.'
          : 'This circle discusses the same pad drawn earlier in the creative afternoon. The afternoon starts sharing after ordinary drawing and pencil return; this panel follows that existing child activity.'}
      </p>
      <div data-testid="art-sharing-artifact">
        {available
          ? `${pad} · ${drawing.completedMarks.length}/${drawing.totalMarks} retained marks · ${(drawing.progress * 100).toFixed(0)}% drawn · ${drawing.status}${drawing.task ? ` · ${drawing.task}` : ''}`
          : `${drawing.code}: ${drawing.message}`}
        {state?.artifact?.support?.kind === 'resting-on' && (
          <div>
            Supported by {state.artifact.support.on} ·{' '}
            {state.artifact.support.slot ?? 'table surface'}
          </div>
        )}
      </div>
      <div data-testid="art-sharing-readout">
        {state
          ? `${state.status} · ${state.mode} · ${state.elapsed.toFixed(1)}/${state.duration}s · ${state.effects.length} retained contributions`
          : standalone
            ? 'Artwork and declared viewing places ready.'
            : 'Sharing awaits the afternoon’s drawn artifact.'}
      </div>
      <div data-testid="art-sharing-floor">
        Floor: <b>{state?.floorHolder ?? '—'}</b>
        {state?.floorHolder && (
          <>
            {' '}
            · {state.turn.kind} · {state.turn.elapsed.toFixed(1)}s
          </>
        )}
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
        {standalone && (
          <button
            disabled={!startReady}
            onClick={() => {
              if (!startBinding) return;
              const record = rt.submit('art_sharing', startBinding);
              setFeedback(
                record.diagnostic
                  ? `${record.diagnostic.code}: ${record.diagnostic.message}`
                  : 'Sharing requested; Play walks the host and visitors to the actual pad.',
              );
              refresh();
            }}
          >
            Start sharing
          </button>
        )}
        <button
          disabled={!running || !can({ kind: 'pause' })}
          onClick={() => command({ kind: 'pause' })}
        >
          Pause sharing
        </button>
        <button
          disabled={!paused || !can({ kind: 'resume' })}
          onClick={() => command({ kind: 'resume' })}
        >
          Resume sharing
        </button>
        <button
          disabled={!live || state?.mode === 'ending' || !can({ kind: 'end' })}
          onClick={() => command({ kind: 'end' })}
        >
          End sharing
        </button>
      </div>
      {state?.participants.map((member) => {
        const leave: ArtSharingIntent = {
          kind: 'leave',
          actor: member.actor,
          to: departure(member.actor),
        };
        return (
          <div key={member.actor} data-testid={`art-sharing-${member.actor}`}>
            <div>
              {member.actor} · {member.role} · {member.state} · {member.slot}
              {member.physicallyViewing ? ' · viewing actual artwork' : ''}
            </div>
            <div className="lab-classroom-controls">
              <button
                disabled={
                  !running ||
                  !member.physicallyViewing ||
                  !can({ kind: 'ask', actor: member.actor })
                }
                onClick={() => command({ kind: 'ask', actor: member.actor })}
              >
                Ask {member.actor}
              </button>
              <button
                disabled={
                  !running ||
                  !member.physicallyViewing ||
                  !can({ kind: 'answer', actor: member.actor })
                }
                onClick={() => command({ kind: 'answer', actor: member.actor })}
              >
                Answer {member.actor}
              </button>
              <button
                disabled={
                  !running ||
                  !member.physicallyViewing ||
                  !can({ kind: 'floor', actor: member.actor })
                }
                onClick={() => command({ kind: 'floor', actor: member.actor })}
              >
                Floor {member.actor}
              </button>
              {member.role === 'visitor' && (
                <>
                  <button
                    disabled={
                      !running ||
                      member.active ||
                      !can({ kind: 'join', actor: member.actor })
                    }
                    onClick={() =>
                      command({ kind: 'join', actor: member.actor })
                    }
                  >
                    Join {member.actor}
                  </button>
                  <button
                    disabled={!running || !member.active || !can(leave)}
                    onClick={() => command(leave)}
                  >
                    Leave {member.actor}
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
      {!!state?.effects.length && (
        <ol data-testid="art-sharing-effects">
          {state.effects.map((effect) => (
            <li key={effect.index}>
              {effect.actor}: {effect.kind} · {effect.seconds.toFixed(1)}s ·{' '}
              {effect.marks} marks on {effect.pad}
              {effect.replyTo !== undefined
                ? ` · answers contribution ${effect.replyTo + 1}`
                : ''}
            </li>
          ))}
        </ol>
      )}
      {problem && (
        <p role="alert" data-testid="art-sharing-diagnostic">
          {problem.code}: {problem.message}
        </p>
      )}
      <p role="status" data-testid="art-sharing-feedback">
        {state?.mode === 'completed'
          ? state.finished
            ? 'Discussion complete; physical viewing holds ended, artwork and contributions remain.'
            : 'Sharing ended early; retained artwork and contributions remain.'
          : feedback}
      </p>
      <p>
        Ask, answer and floor requests wait for actual viewing and the turn
        queue. Join uses a declared place, including late visitor art-visitor3;
        Leave walks away after releasing the viewing hold. Pause sharing
        releases physical holds while retaining discussion progress. Global
        Pause freezes time. Resume is explicit in the same runtime; Reset starts
        a fresh world.
      </p>
    </section>
  );
}
