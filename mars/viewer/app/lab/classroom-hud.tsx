import { useState } from 'react';
import type { LabSim } from './sim.ts';
import { startClassroom } from './classroom.ts';
import { classroomSessionId } from '../../engine/scenarios/classroom.ts';
import { readClassroom, type ClassroomIntent } from '../../engine/activities/index.ts';
import { displayReadout } from '../../engine/objects/classroom.ts';

export function ClassroomHud({ sim, refresh }: { sim: LabSim; refresh: () => void }) {
  const [actor, setActor] = useState('guest1');
  const [feedback, setFeedback] = useState('');
  if (!sim.scenario.name.startsWith('classroom-')) return null;
  const id = classroomSessionId(sim.rt), state = id ? readClassroom(sim.rt, id) : undefined;
  const running = !!id && sim.rt.isActive(id);
  const screen = displayReadout(sim.rt, 'screen');
  const command = (intent: ClassroomIntent) => {
    if (!id) return;
    const r = sim.rt.submit('classroom_control', { session: id, intent });
    setFeedback(r.diagnostic ? `${r.diagnostic.code}: ${r.diagnostic.message}` : `Requested ${intent.kind}${'actor' in intent ? ` for ${intent.actor}` : ''}`);
    refresh();
  };
  return <div className="lab-hud lab-classroom" data-testid="classroom-hud">
    <div className="lab-hud-head">HYPOTHETICAL · live classroom · {state?.phase ?? 'ready'}</div>
    <div>Floor: <b>{state?.floorHolder ?? '—'}</b> · Shared attention: <b>{state?.attentionTarget?.actor ?? '—'}</b></div>
    <div>{'code' in screen ? screen.message : `Display ${screen.mode} · ${screen.content}`}</div>
    {state?.waitingReason && <div role="status">Waiting: {state.waitingReason}</div>}
    {state?.diagnostic && <div role="alert">{state.diagnostic.code}: {state.diagnostic.message}</div>}
    <div className="lab-classroom-controls">
      <button disabled={running} onClick={() => {
        const r = startClassroom(sim.rt, sim.scenario.name === 'classroom-8' ? 8 : 4);
        setFeedback(r.diagnostic ? `${r.diagnostic.code}: ${r.diagnostic.message}` : 'Session started'); refresh();
      }}>Start session</button>
      <select aria-label="Classroom participant" value={actor} onChange={(e) => setActor(e.target.value)}>
        {(state?.participants.map((p) => p.actor) ?? ['host', 'presenter1', 'presenter2', ...Array.from({ length: sim.scenario.name === 'classroom-8' ? 8 : 4 }, (_, i) => `guest${i + 1}`)]).map((a) => <option key={a}>{a}</option>)}
      </select>
      <button disabled={!running} onClick={() => command({ kind: 'question', actor })}>Ask question</button>
      <button disabled={!running} onClick={() => command({ kind: 'advance' })}>Next presenter</button>
      <button disabled={!running} onClick={() => command({ kind: 'depart', actor })}>Leave session</button>
      <button disabled={!running} onClick={() => {
        const r = sim.rt.submit('walk_to', { actor, x: 12, z: 10 });
        setFeedback(r.diagnostic ? `${r.diagnostic.code}: ${r.diagnostic.message}` : `Directed ${actor} to courtyard`); refresh();
      }}>Direct to courtyard</button>
      <button disabled={!running} onClick={() => command({ kind: 'cancel' })}>End session</button>
    </div>
    <div role="status" data-testid="classroom-feedback">{feedback}</div>
    {state && <div className="lab-classroom-people">{state.participants.map((p) => <span key={p.actor} title={p.reason ?? p.seat}>{p.actor}: {p.state === 'excluded' ? `left (${p.reason})` : p.role}{state.queuedQuestions.includes(p.actor) ? ' · question queued' : ''}</span>)}</div>}
    <small>Ground floor, fixed arrangements. Leaving/directing someone releases their participation; rejoining and resuming an interrupted session are not supported yet. Use Reset for a fresh arrangement.</small>
  </div>;
}
