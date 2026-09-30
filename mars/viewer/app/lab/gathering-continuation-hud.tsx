import { useState } from 'react';
import { readGatheringContinuation, type GatheringContinuationParams } from '../../engine/activities/gathering-continuation.ts';
import { readPurposefulRoutine } from '../../engine/activities/purposeful-routine.ts';
import { classroomSessionId } from '../../engine/scenarios/classroom.ts';
import { WORK_BREAK_BINDING as B } from '../../engine/scenarios/work-break.ts';
import type { LabSim } from './sim.ts';

type Requests = { epoch: number; work: string; discussion: string };
/** Independent intentions share the authoritative classroom, not each other's cancellation. */
export function GatheringContinuationHud({ sim, refresh }: { sim: LabSim; refresh: () => void }) {
  const [requests, setRequests] = useState<Requests>();
  const [feedback, setFeedback] = useState('');
  if (sim.scenario.name !== 'work-break-4' && sim.scenario.name !== 'work-break-8') return null;
  const rt = sim.rt, session = classroomSessionId(rt), task = B.work.task ?? 'Sketch notes';
  const prior = [...rt.records.values()].findLast(record => {
    if (record.verb !== 'purposeful_routine') return false;
    const state = readPurposefulRoutine(rt, record.id);
    return state?.bindings.session === session && state.bindings.actor === B.work.actor &&
      state.bindings.work.station === B.work.station && state.bindings.work.task === task && state.bindings.work.duration === B.work.duration;
  });
  const current = requests?.epoch === sim.scenarioEpoch ? requests : undefined;
  const start = () => {
    if (sim.rt !== rt || !session || !prior || current) return;
    const work: GatheringContinuationParams = {
      session, binding: { kind: 'work', actor: 'presenter1',
        work: { station: B.work.station, seat: B.work.seat, task: 'Record talk follow-up', duration: 12 },
        prerequisite: { routine: prior.id, actor: B.work.actor, station: B.work.station, task, duration: B.work.duration } },
    };
    const discussion: GatheringContinuationParams = {
      session, binding: { kind: 'discussion', actors: ['guest1', 'guest2'], at: [-7, 6], duration: 20 },
    };
    const workRecord = rt.submit('gathering_continuation', work, { preempt: false });
    const discussionRecord = rt.submit('gathering_continuation', discussion, { preempt: false });
    setRequests({ epoch: sim.scenarioEpoch, work: workRecord.id, discussion: discussionRecord.id });
    const issues = [workRecord, discussionRecord].flatMap(record => record.diagnostic ? [`${record.diagnostic.code}: ${record.diagnostic.message}`] : []);
    setFeedback(issues.length ? issues.join(' · ') : 'Two independent commitments made. They wait for physical departure; presenter1 also waits for these exact notes.');
    refresh();
  };
  const control = (id: string, intent: 'pause' | 'resume' | 'end') => {
    if (sim.rt !== rt || !rt.isActive(id)) return;
    const result = rt.submit('gathering_continuation_control', { continuation: id, intent });
    setFeedback(result.diagnostic ? `${result.diagnostic.code}: ${result.diagnostic.message}` : `Requested ${intent} for this commitment only.`);
    refresh();
  };
  return <section className="lab-hud lab-classroom" data-testid="gathering-continuation-hud">
    <div className="lab-hud-head">HYPOTHETICAL · after the gathering</div>
    <p>Give other people continuing purposes: guest1 and guest2 discuss the talks after leaving. Presenter1 waits for worker’s notes, then uses the same computer for follow-up work.</p>
    <button disabled={!session || !prior || !!current} onClick={start}>Commit attendee continuations</button>
    {!current && <small>Start the purposeful routine first. These commitments use that exact gathering and unfinished-task intention.</small>}
    {current && (['work', 'discussion'] as const).map(kind => {
      const id = current[kind], state = readGatheringContinuation(rt, id), record = rt.records.get(id), active = rt.isActive(id);
      const resumable = state?.mode === 'paused' || state?.mode === 'waiting';
      return <div key={kind} data-testid={`continuation-${kind}`}>
        <b>{kind === 'work' ? 'Presenter1 · follow-up work' : 'Guest1 + guest2 · continuing discussion'}</b>
        <div>{record?.status === 'cancelled' ? 'Ended; remaining commitment was not fulfilled' : record?.status === 'failed' ? 'Declined' : state?.status === 'completed' ? 'Finished' : state?.mode ?? record?.status}</div>
        {state && <>
          <div>{state.phase} · {state.elapsed.toFixed(1)}/{state.duration}s · {state.remaining.toFixed(1)}s remaining</div>
          {state.floorHolder && <div>Speaking: {state.floorHolder}</div>}
          {state.waitingReason && <div role="status">{state.waitingReason}</div>}
          {state.diagnostic && <div role="status">{state.diagnostic.code}: {state.diagnostic.message}</div>}
        </>}
        {!state && record?.diagnostic && <div role="status">{record.diagnostic.code}: {record.diagnostic.message}</div>}
        <div className="lab-classroom-controls">
          <button disabled={!active || resumable || state?.mode === 'draining' || state?.mode === 'ending'} onClick={() => control(id, 'pause')}>Pause {kind}</button>
          <button disabled={!active || !resumable} onClick={() => control(id, 'resume')}>Resume {kind}</button>
          <button disabled={!active || state?.mode === 'ending'} onClick={() => control(id, 'end')}>End {kind}</button>
        </div>
      </div>;
    })}
    <div role="status">{feedback}</div>
    <small>Direct commands take precedence. Pause retains actual work or conversation time; Resume retries the same binding after a remedy. End affects only that commitment. Reset clears both. Authored follow-ups are not autonomous choices.</small>
  </section>;
}
