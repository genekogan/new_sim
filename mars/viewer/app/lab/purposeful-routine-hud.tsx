import { useState } from 'react';
import type { ActionRecord } from '../../engine/actions/types.ts';
import { readPurposefulRoutine, type PurposefulRoutineParams } from '../../engine/activities/purposeful-routine.ts';
import { classroomSessionId } from '../../engine/scenarios/classroom.ts';
import { readClassroom } from '../../engine/activities/classroom.ts';
import { WORK_BREAK_BINDING as B } from '../../engine/scenarios/work-break.ts';
import { readWorkstation } from '../../engine/objects/workstation.ts';
import { classroomFurniture } from './room-layout.ts';
import type { LabSim } from './sim.ts';

/** UI submits intentions only; all progress and cleanup come from Runtime. */
export function PurposefulRoutineHud({ sim, refresh }: { sim: LabSim; refresh: () => void }) {
  const [request, setRequest] = useState<{ epoch: number; action: string }>();
  const [feedback, setFeedback] = useState('');
  if (sim.scenario.name !== 'work-break-4' && sim.scenario.name !== 'work-break-8') return null;
  const rt = sim.rt, actor = B.work.actor, task = B.work.task ?? 'Sketch notes';
  const action = request?.epoch === sim.scenarioEpoch ? request.action : undefined;
  const record = action ? rt.records.get(action) : undefined;
  const state = action ? readPurposefulRoutine(rt, action) : undefined;
  const active = !!record && rt.isActive(record.id);
  const session = classroomSessionId(rt);
  const liveSession = !!session && rt.isActive(session);
  const accepting = liveSession && !!session && ['presenting', 'question'].includes(readClassroom(rt, session)?.phase ?? '');
  const work = readWorkstation(rt, B.work.station);
  const unfinished = !('code' in work) && work.status === 'unfinished' && work.user === actor && work.task === task && work.duration === B.work.duration;
  const busy = rt.holder(`actor:${actor}`).length > 0;
  const startReady = unfinished && accepting && !busy && !active;
  const respond = (result: ActionRecord, accepted: string) => {
    setFeedback(result.diagnostic ? `${result.diagnostic.code}: ${result.diagnostic.message}` : accepted);
    refresh();
  };
  const start = () => {
    if (sim.rt !== rt || !startReady || !session) return;
    const params: PurposefulRoutineParams = {
      actor, session,
      work: { station: B.work.station, seat: B.work.seat, task, duration: B.work.duration },
      food: { pot: B.pot, participants: B.people, at: B.conversation.at },
      rest: { seat: `${classroomFurniture(sim.scenario.name).chair.id}#seat`, seconds: 5 },
      departure: [10, 12],
    };
    const result = rt.submit('purposeful_routine', params, { preempt: false });
    setRequest({ epoch: sim.scenarioEpoch, action: result.id });
    respond(result, 'Committed: attend this gathering, share food, rest, then finish these same notes');
  };
  const control = (intent: 'pause' | 'resume' | 'end') => {
    if (sim.rt !== rt || !action || !rt.isActive(action)) return;
    respond(rt.submit('purposeful_routine_control', { routine: action, intent }),
      intent === 'end' ? 'Ending this intention after safe release; unfinished notes remain' : `Requested routine ${intent}; wait for authoritative cleanup/progress`);
  };
  const resumable = active && (state?.mode === 'paused' || state?.mode === 'waiting');
  return <section className="lab-hud lab-classroom" data-testid="purposeful-routine-hud">
    <div className="lab-hud-head">HYPOTHETICAL · a continuing intention</div>
    <p>Attend this gathering, share food with visitor, rest briefly, then finish the same Sketch notes. You can pause or direct people while it runs.</p>
    {!active && record?.status !== 'completed' && <p>Prepare: Start notes and interrupt after some progress; wait for safe stand-up, then Start session below. Start this routine before manually joining worker.</p>}
    {record?.status === 'completed' && <p>Finished this gathering, meal, rest and the same notes. Reset the world to try another version.</p>}
    <div className="lab-classroom-controls">
      <button disabled={!startReady} onClick={start}>Start purposeful routine</button>
      <button disabled={!active || state?.mode === 'paused' || state?.mode === 'draining' || state?.mode === 'ending'} onClick={() => control('pause')}>Pause routine</button>
      <button disabled={!resumable} onClick={() => control('resume')}>Resume routine</button>
      <button disabled={!active || state?.mode === 'ending'} onClick={() => control('end')}>End routine</button>
    </div>
    {!active && !startReady && record?.status !== 'completed' && <div role="status">{!unfinished ? 'This worker needs the same unfinished notes first.' : !liveSession ? 'Start a classroom session to bind this gathering.' : !accepting ? 'Wait for talks to begin; joining is supported during presentations and questions.' : busy ? 'Wait for the worker’s physical release.' : 'Ready for a new intention.'}</div>}
    <div data-testid="purposeful-routine-readout">
      {state ? <>
        <div>{actor} · {state.status === 'cancelled' ? 'ended; remaining activities were not completed' : state.mode} · {state.obligation} · {state.status === 'completed' ? 'finished' : state.phase}</div>
        <div>Same Sketch notes: {state.progress.workElapsed.toFixed(1)}/{B.work.duration}s</div>
        <details><summary>Committed gathering</summary>{state.bindings.session}</details>
        <div>Question: {state.progress.questionAsked ? 'asked' : 'pending'} · Seated rest: {state.progress.restSeconds.toFixed(1)}/5s</div>
        <div>Presenters attended: {state.progress.presenters.length}/2 · Conversation: {state.progress.conversationSeen ? 'joined' : 'pending'}</div>
        {state.progress.meal.map(person => <div key={person.actor}>{person.actor} · {person.served ? 'served' : 'not served'} · {person.consumed ? 'eaten' : 'meal unfinished'} · {person.returned ? 'utensils returned' : 'returns pending'}</div>)}
        {state.waitingReason && <div role="status">Waiting: {state.waitingReason}</div>}
        {state.diagnostic && <div role="status">{state.diagnostic.code}: {state.diagnostic.message}</div>}
      </> : 'No routine committed. Manual classroom, food, work and rest controls remain available.'}
    </div>
    <div role="status" data-testid="purposeful-routine-feedback">{feedback}</div>
    <small>Pause keeps this intention while people safely release their places and resources. Resume continues with the same people, gathering, meal and notes. End releases the intention. Direct commands take precedence; finished food and work progress do not restart. Reset clears the live intention. Quiet rest is not sleep or recovery; people do not yet choose their own routines.</small>
  </section>;
}
