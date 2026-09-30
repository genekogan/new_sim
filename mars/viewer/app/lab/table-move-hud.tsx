import { useState } from 'react';
import type { LabSim } from './sim.ts';
import type { ActionRecord } from '../../engine/actions/types.ts';
import { readFixtureMove } from '../../engine/carry/fixture.ts';

export function TableMoveHud({ sim, actor, refresh }: { sim: LabSim; actor: string; refresh: () => void }) {
  const [helper, setHelper] = useState('guest2');
  const [feedback, setFeedback] = useState('');
  const fixture = 'belongings-table';
  const actors = Object.values(sim.rt.world.entities).filter((e) => e.kind === 'human').map((e) => e.id);
  const last = [...sim.rt.records.values()].filter((r) => r.verb === 'move_fixture' && (r.params as { fixture?: string }).fixture === fixture).at(-1);
  const active = !!last && sim.rt.isActive(last.id);
  const state = last && readFixtureMove(sim.rt, last.id);
  const contents = Object.values(sim.rt.world.entities).filter((e) => e.support?.kind === 'resting-on' && e.support.on === fixture);
  const response = (r: ActionRecord, text: string) => {
    setFeedback(r.diagnostic ? `${r.diagnostic.code}: ${r.diagnostic.message}` : text);
    refresh();
  };
  const move = (side: boolean) => response(sim.rt.submit('move_fixture', { actor, helpers: [helper], fixture, to: { x: side ? 12 : 10, z: side ? -2 : -5, yaw: 0 } }), `Requested ${actor} and ${helper} to move the empty table`);
  return <div data-testid="table-move-hud">
    <div>Table setup · {actor} with helper</div>
    <select aria-label="Table helper" value={helper} onChange={(e) => setHelper(e.target.value)} disabled={active}>
      {actors.map((a) => <option key={a}>{a}</option>)}
    </select>
    <div>{contents.length ? `Remove supported items first: ${contents.map((e) => e.id).join(', ')}` : 'Table is empty'}</div>
    <div className="lab-classroom-controls">
      <button disabled={active} onClick={() => move(true)}>Move empty table to side</button>
      <button disabled={active} onClick={() => move(false)}>Return empty table</button>
      <button disabled={!active} onClick={() => { if (last) response(sim.rt.cancel(last.id), 'Stopping table with safe lowering'); }}>Stop moving table</button>
    </div>
    <div role="status" data-testid="table-move-progress">{state && <>Table: {state.status} · {state.phase} · {state.held ? 'held by crew' : 'supported on ground'}{state.stopping && ' · stopping safely'}{state.waitingReason && ` · ${state.waitingReason}`}{state.diagnostic && ` · ${state.diagnostic.code}`}</>}</div>
    <div role="status" data-testid="table-move-feedback">{feedback}</div>
    <small>Two distinct free people with empty hands. Another person can take the bowl and spoon, then return them after placement. Objects stay with their holder; the table carries no contents.</small>
  </div>;
}
