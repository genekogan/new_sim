import { useState } from 'react';
import type { ActionRecord } from '../../engine/actions/types.ts';
import { readPurposefulRoutine, type PurposefulRoutineParams } from '../../engine/activities/purposeful-routine.ts';
import { classroomSessionId } from '../../engine/scenarios/classroom.ts';
import { readClassroom } from '../../engine/activities/classroom.ts';
import { activityExample, mealWalkExample } from './activity-example.ts';
import { readWorkstation } from '../../engine/objects/workstation.ts';
import { preparedDayBindings } from '../../engine/scenarios/prepared-day.ts';
import type { LabSim } from './sim.ts';

/** UI submits intentions only; all progress and cleanup come from Runtime. */
export function PurposefulRoutineHud({ sim, refresh }: { sim: LabSim; refresh: () => void }) {
  const [request, setRequest] = useState<{ epoch: number; action: string }>();
  const [feedback, setFeedback] = useState('');
  const [walkChoice, setWalkChoice] = useState<{ epoch: number; enabled: boolean }>();
  const prepared = preparedDayBindings(sim.scenario.name);
  const walkTogether = walkChoice?.epoch === sim.scenarioEpoch ? walkChoice.enabled : !!prepared;
  const example = activityExample(sim.scenario.name);
  if (!example) return null;
  const B = example.workBreak;
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
      rest: example.rest, departure: example.departure,
      ...(walkTogether ? { trip: mealWalkExample(sim.scenario.name) } : {}),
      ...(prepared ?? {}),
    };
    const result = rt.submit('purposeful_routine', params, { preempt: false });
    setRequest({ epoch: sim.scenarioEpoch, action: result.id });
    respond(result, `Committed: attend this gathering, ${walkTogether ? 'walk to lunch together, ' : ''}${prepared ? 'prepare a cold dish, share food and sleep' : 'share food and rest'}, then finish these same notes`);
  };
  const control = (intent: 'pause' | 'resume' | 'end') => {
    if (sim.rt !== rt || !action || !rt.isActive(action)) return;
    respond(rt.submit('purposeful_routine_control', { routine: action, intent }),
      intent === 'end' ? 'Ending this intention after safe release; unfinished notes remain' : `Requested routine ${intent}; wait for authoritative cleanup/progress`);
  };
  const resumable = active && (state?.mode === 'paused' || state?.mode === 'waiting');
  return <section className="lab-hud lab-classroom" data-testid="purposeful-routine-hud">
    <div className="lab-hud-head">HYPOTHETICAL · a continuing intention</div>
    <p>Attend this gathering, {prepared ? 'prepare a cold dish from two finite ingredients, ' : ''}share food with {example.roles.companion}, {prepared ? 'sleep on the grounded mat' : 'rest briefly'}, then finish the same {task}. You can pause or direct people while it runs.</p>
    {!active && record?.status !== 'completed' && <p>Prepare: Start notes and interrupt after some progress; wait for safe stand-up, then Start session below. Start this routine before manually joining {actor}.</p>}
    {record?.status === 'completed' && <p>Finished this gathering, meal, {prepared ? 'sleep' : 'rest'} and the same notes. Reset the world to try another version.</p>}
    <label><input type="checkbox" checked={walkTogether} disabled={active} onChange={event => setWalkChoice({ epoch: sim.scenarioEpoch, enabled: event.target.checked })} /> Walk to lunch together before sharing food</label>
    {walkTogether && <p>Uses the clear ground aisle with an invited companion. Put down held items first; stairs and crowded routes may refuse or wait with a reason.</p>}
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
        <div>Same {task}: {state.progress.workElapsed.toFixed(1)}/{B.work.duration}s</div>
        {state.trip && <div data-testid="routine-trip-readout">Walk to lunch: {state.trip.mode} · {state.trip.participants.map(p => `${p.actor}: ${p.arrived ? 'arrived' : `${p.progress.toFixed(1)}m`}`).join(' · ')}{state.trip.waitingReason ? ` · ${state.trip.waitingReason}` : ''}</div>}
        <details><summary>Committed gathering</summary>{state.bindings.session}</details>
        <div>Question: {state.progress.questionAsked ? 'asked' : 'pending'}{!prepared && ` · Seated rest: ${state.progress.restSeconds.toFixed(1)}/${example.rest.seconds}s`}</div>
        {prepared && <>
          <div data-testid="routine-preparation-readout">Cold preparation: {state.preparation ? `${state.preparation.complete ? 'mixed and ready' : 'retained recipe in progress'} · ${state.preparation.ingredients.map(i => `${i.food}: ${i.deposited.toFixed(2)}/${i.initial.toFixed(2)} deposited`).join(' · ')} · ${(state.preparation.mixedTicks / 20).toFixed(1)}s mixed` : 'not started'}</div>
          <div data-testid="routine-sleep-readout">Same sleep purpose: {state.sleep ? `${state.sleep.action} · ${state.sleep.mode} · ${state.sleep.elapsed.toFixed(1)}/${state.sleep.bindings.duration}s · ${state.sleep.remaining.toFixed(1)}s remaining` : `not started · ${prepared.sleep.duration}s on ${prepared.sleep.mat}`}</div>
        </>}
        <div>Presenters attended: {state.progress.presenters.length}/{example.session.presenters.length} · Conversation: {state.progress.conversationSeen ? 'joined' : 'pending'}</div>
        {state.progress.meal.map(person => <div key={person.actor}>{person.actor} · {person.served ? 'served' : 'not served'} · {person.consumed ? 'eaten' : 'meal unfinished'} · {person.returned ? 'utensils returned' : 'returns pending'}</div>)}
        {state.waitingReason && <div role="status">Waiting: {state.waitingReason}</div>}
        {state.diagnostic && <div role="status">{state.diagnostic.code}: {state.diagnostic.message}</div>}
      </> : 'No routine committed. Manual classroom, food, work and rest controls remain available.'}
    </div>
    {prepared && <div data-testid="prepared-day-quantities">Finite dish: {prepared.preparation.ingredients.map(id => `${rt.world.entities[id]?.contents?.food ?? id} ${rt.world.entities[id]?.contents?.fraction.toFixed(2) ?? 'unavailable'}`).join(' · ')} · pot {rt.world.entities[prepared.preparation.pot]?.contents?.fraction.toFixed(2) ?? 'unavailable'}. Pause retains actual deposits and the same sleep purpose; completed food is not recreated.</div>}
    <div role="status" data-testid="purposeful-routine-feedback">{feedback}</div>
    <small>Pause keeps this intention while people safely release their places and resources. Resume continues with the same people, gathering, meal and notes. End releases the intention. Direct commands take precedence; finished food and work progress do not restart. Reset clears the live intention. {prepared ? 'One cold two-ingredient recipe and one flat grounded mat; sleep uses the existing rigs. No heat, chopping, arbitrary beds, recovery needs or active reload restoration. Attendee continuations remain independent.' : 'Quiet rest is not sleep or recovery; people do not yet choose their own routines.'}</small>
  </section>;
}
