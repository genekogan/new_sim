import { TableMoveHud } from './table-move-hud.tsx';
import { RoomSetupHud } from './room-setup-hud.tsx';
import { FixtureMoveHud } from './fixture-move-hud.tsx';
import { BelongingsHud } from './belongings-hud.tsx';
import { useState } from 'react';
import type { LabSim } from './sim.ts';
import { activityExample } from './activity-example.ts';
import { classroomRoomCount } from './room-layout.ts';
import { startClassroom } from './classroom.ts';
import { classroomSessionId } from '../../engine/scenarios/classroom.ts';
import { readClassroom, type ClassroomIntent } from '../../engine/activities/index.ts';
import { displayReadout } from '../../engine/objects/classroom.ts';
import { readWorkstation } from '../../engine/objects/workstation.ts';
import type { ActionRecord } from '../../engine/actions/types.ts';

const departure = (actor: string): [number, number] => actor === 'visitor' ? [-7, 12] : [10, 12];
export function ClassroomHud({ sim, refresh }: { sim: LabSim; refresh: () => void }) {
  const example = activityExample(sim.scenario.name);
  const foodRoom = !!example;
  const [actor, setActor] = useState(example?.roles.worker ?? 'guest1');
  const [feedback, setFeedback] = useState('');
  const movableRoom = classroomRoomCount(sim.scenario.name);
  const count = movableRoom ?? (example ? 4 : undefined);
  if (!count) return null;
  const id = classroomSessionId(sim.rt), state = id ? readClassroom(sim.rt, id) : undefined;
  const running = !!id && sim.rt.isActive(id);
  const setupRunning = [...sim.rt.records.values()].some((r) => r.verb === 'setup_room' && sim.rt.isActive(r.id));
  const screen = displayReadout(sim.rt, example?.session.displayId ?? 'screen');
  const workstation = readWorkstation(sim.rt, example?.workBreak.work.station ?? 'workstation');
  const work = 'code' in workstation ? undefined : workstation;
  const workAction = [...sim.rt.records.values()].find((r) => r.verb === 'work_at' && sim.rt.isActive(r.id));
  const member = state?.participants.find((p) => p.actor === actor);
  const participating = member?.state === 'participating';
  const joining = member?.arrival === 'joining';
  const busy = sim.rt.holder(`actor:${actor}`).length > 0;
  const actors = Object.values(sim.rt.world.entities).filter((e) => e.kind === 'human').map((e) => e.id);
  const response = (r: ActionRecord, accepted: string) => {
    setFeedback(r.diagnostic ? `${r.diagnostic.code}: ${r.diagnostic.message}` : accepted); refresh();
  };
  const command = (intent: ClassroomIntent) => {
    if (!id) return;
    response(sim.rt.submit('classroom_control', { session: id, intent }), `Requested ${intent.kind}${'actor' in intent ? ` for ${intent.actor}` : ''}`);
  };
  const askable = participating && !joining && member.role === 'audience' && ['arriving', 'rotating', 'releasing', 'presenting', 'question'].includes(state?.phase ?? '');
  return <div className="lab-hud lab-classroom" data-testid="classroom-hud">
    {movableRoom && <a href={`/cinematography/review.html?scenario=classroom-${count}`} target="_blank" rel="noopener">Open a separate classroom camera review</a>}
    <div className="lab-hud-head">HYPOTHETICAL · live classroom · {state?.phase ?? 'ready'}</div>
    <div>Floor: <b>{state?.floorHolder ?? '—'}</b> · Shared attention: <b>{state?.attentionTarget?.actor ?? '—'}</b></div>
    <div>{'code' in screen ? screen.message : `Display ${screen.mode} · ${screen.content}`}</div>
    {state?.waitingReason && <div role="status">Waiting: {state.waitingReason}</div>}
    {state?.diagnostic && <div role="alert">{state.diagnostic.code}: {state.diagnostic.message}</div>}
    <div className="lab-classroom-controls">
      <button disabled={running || setupRunning} onClick={() => response(example ? sim.rt.submit('classroom_session', example.session) : startClassroom(sim.rt, count), 'Session started')}>Start session</button>
      <select aria-label="Classroom participant" value={actor} onChange={(e) => setActor(e.target.value)}>
        {actors.map((a) => <option key={a}>{a}</option>)}
      </select>
      <button disabled={!running || participating || busy || !state?.controls.includes('join')} onClick={() => command({ kind: 'join', actor, departure: example && actor === example.roles.worker ? example.departure : departure(actor) })}>Join session</button>
      <button disabled={!running || !askable} onClick={() => command({ kind: 'question', actor })}>Ask question</button>
      <button disabled={!running} onClick={() => command({ kind: 'advance' })}>Next presenter</button>
      <button disabled={!running || !participating} onClick={() => command({ kind: 'depart', actor })}>Leave session</button>
      <button onClick={() => response(sim.rt.submit('walk_to', { actor, x: 12, z: 10 }), `Directed ${actor} to courtyard`)}>Direct to courtyard</button>
      <button disabled={!running} onClick={() => command({ kind: 'cancel' })}>End session</button>
    </div>
    {!foodRoom && <>
    <div data-testid="workstation-readout">Workstation: <b>{work?.status ?? 'unavailable'}</b>{work?.task && <> · {work.task} · {work.user} · {Math.round(work.progress * 100)}% ({work.elapsed.toFixed(1)}/{work.duration}s)</>}{work?.phase && <> · {work.phase === 'arriving' ? 'waiting for chair arrival' : work.phase === 'stopping' ? 'waiting for safe stand-up' : 'seated work'}</>}</div>
    {'code' in workstation && <div role="alert">{workstation.code}: {workstation.message}</div>}
    <div className="lab-classroom-controls">
      <button disabled={busy || !!workAction || work?.status === 'unfinished'} onClick={() => response(sim.rt.submit('work_at', { actor, station: 'workstation', seat: 'work-chair#seat', duration: 30, task: 'Sketch notes' }), `Requested work for ${actor}`)}>Work on Sketch notes</button>
      <button disabled={!workAction} onClick={() => { if (workAction) response(sim.rt.cancel(workAction.id), 'Stopping work safely; unfinished progress will remain'); }}>Interrupt work</button>
      <button disabled={busy || !!workAction || work?.status !== 'unfinished' || work.user !== actor} onClick={() => response(sim.rt.submit('work_at', { actor, station: 'workstation', seat: 'work-chair#seat', duration: 30, task: 'Sketch notes', resume: true }), `Requested resume for ${actor}`)}>Resume Sketch notes</button>
    </div>
    </>}
    {foodRoom && <p>After interrupting notes and waiting for safe stand-up, start the {count}-guest session and join {example!.roles.worker} to the real spare chair. Ask a question, watch both presenters and the smaller conversations, then wait for session departure before starting shared food below. {example!.roles.companion} remains the food companion.</p>}
    {movableRoom && <>
    <BelongingsHud sim={sim} actor={actor} refresh={refresh} />
    <RoomSetupHud key={sim.scenarioEpoch} sim={sim} sessionRunning={running} refresh={refresh} />
    <FixtureMoveHud sim={sim} actor={actor} refresh={refresh} />
    <TableMoveHud sim={sim} actor={actor} refresh={refresh} />
    </>}
    {state?.groups.length ? <div data-testid="conversation-floors">{state.groups.map((g) => <div key={g.action}>{g.members.join(', ')} · {g.status} · Floor: <b>{g.floorHolder ?? '—'}</b></div>)}</div> : null}
    <div role="status" data-testid="classroom-feedback">{feedback}</div>
    {joining && <div role="status">{actor} is joining: wait for actual seating before asking a question.</div>}
    {busy && !participating && workAction && (workAction.params as { actor?: string }).actor === actor && <div role="status">Interrupt work or direct {actor} away before joining.</div>}
    {state && <div className="lab-classroom-people">{state.participants.map((p) => <span key={p.actor} title={p.reason ?? p.seat}>{p.actor}: {p.state === 'excluded' ? `left (${p.reason})` : p.arrival === 'joining' ? 'joining' : p.role}{state.queuedQuestions.includes(p.actor) ? ' · question queued' : ''}</span>)}</div>}
    <small>Join or rejoin an available audience seat while talks are running. Work uses the separate nearby chair; unfinished work resumes only by an explicit same-user request. Ground floor, explicit empty spare-chair setup; typing animation is deferred.</small>
  </div>;
}
