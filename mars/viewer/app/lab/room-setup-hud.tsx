import { useState } from 'react';
import type { LabSim } from './sim.ts';
import { readRoomSetup } from '../../engine/activities/room-setup.ts';
import { classroomSetup, type RoomLayout } from './room-layout.ts';

export function RoomSetupHud({ sim, sessionRunning, refresh }: { sim: LabSim; sessionRunning: boolean; refresh: () => void }) {
  const [chair, setChair] = useState('guest3');
  const [table, setTable] = useState('guest1');
  const [helper, setHelper] = useState('guest2');
  const [feedback, setFeedback] = useState('');
  const actors = Object.values(sim.rt.world.entities).filter((e) => e.kind === 'human').map((e) => e.id);
  const setups = [...sim.rt.records.values()].filter((r) => r.verb === 'setup_room');
  const last = setups.findLast((r) => sim.rt.isActive(r.id)) ?? setups.at(-1);
  const active = !!last && sim.rt.isActive(last.id);
  const state = last && readRoomSetup(sim.rt, last.id);
  const prepare = (layout: RoomLayout) => {
    const record = sim.rt.submit('setup_room', classroomSetup(sim.scenario.name, layout, { chair, table, helper }));
    setFeedback(record.diagnostic ? `${record.diagnostic.code}: ${record.diagnostic.message}` : `Requested ${layout} layout through physical table and chair moves`);
    refresh();
  };
  const role = (label: string, value: string, change: (value: string) => void) => <label>{label} <select aria-label={label} value={value} disabled={active} onChange={(e) => change(e.target.value)}>{actors.map((a) => <option key={a}>{a}</option>)}</select></label>;
  return <section data-testid="room-setup-hud">
    <b>Prepare a usable layout</b>
    <details><summary>Choose setup crew</summary>
      {role('Room chair carrier', chair, setChair)}
      {role('Room table carrier', table, setTable)}
      {role('Room table helper', helper, setHelper)}
    </details>
    <div className="lab-classroom-controls">
      <button disabled={active || sessionRunning} onClick={() => prepare('side')}>Prepare side layout</button>
      <button disabled={active || sessionRunning} onClick={() => prepare('default')}>Restore default layout</button>
      <button disabled={!active} onClick={() => { if (last) { const rec = sim.rt.cancel(last.id); setFeedback(rec.diagnostic?.message ?? 'Stopping setup; waiting for safe set-down'); refresh(); } }}>Stop room setup</button>
    </div>
    {state && <div role="status" data-testid="room-setup-progress">
      {state.layout} layout · {state.status} · {state.phase} · {state.completed.length}/{state.targets.length} moves completed
      {state.ready && ' · ready for a session'}{state.partial && ' · partial layout retained'}
      {state.current && <div>{state.current.fixture}: {state.current.phase} · {state.current.held ? 'held by crew' : 'ground support'}</div>}
      {state.waitingReason && <div>{state.waitingReason}</div>}
      {state.diagnostic && <div>{state.diagnostic.code}: {state.diagnostic.message}</div>}
    </div>}
    <div role="status" data-testid="room-setup-feedback">{feedback}</div>
    <small>Before a session, select worker and explicitly take the bowl and spoon. Free crew then moves the empty table and spare chair in order. Start the session after setup; worker can return objects to the relocated table. A stopped setup keeps its actual partial layout. Only these two authored ground layouts are supported.</small>
  </section>;
}
