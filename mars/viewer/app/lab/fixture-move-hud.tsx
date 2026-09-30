import { useState } from 'react';
import type { LabSim } from './sim.ts';
import type { ActionRecord } from '../../engine/actions/types.ts';
import { readFixtureMove } from '../../engine/carry/fixture.ts';

/** First physical setup scope: the authored spare chair, an explicit side position and its original row. */
export function FixtureMoveHud({ sim, actor, refresh }: { sim: LabSim; actor: string; refresh: () => void }) {
  const [feedback, setFeedback] = useState('');
  const eight = sim.scenario.name === 'classroom-8';
  const fixture = eight ? 'seat12' : 'seat8';
  const last = [...sim.rt.records.values()].filter((r) => r.verb === 'move_fixture' && (r.params as { fixture?: string }).fixture === fixture).at(-1);
  const active = !!last && sim.rt.isActive(last.id);
  const state = last && readFixtureMove(sim.rt, last.id);
  const response = (r: ActionRecord, text: string) => {
    setFeedback(r.diagnostic ? `${r.diagnostic.code}: ${r.diagnostic.message}` : text);
    refresh();
  };
  const move = (side: boolean) => response(sim.rt.submit('move_fixture', { actor, fixture, to: { x: side ? 7.5 : 4.5, z: side && eight ? 4.5 : eight ? 6 : 3, yaw: -Math.PI } }), `${actor} is preparing to carry ${fixture} ${side ? 'to the side' : 'back to its row'}`);
  return <div data-testid="fixture-move-hud">
    <div>Room setup · spare chair <b>{fixture}</b> · carrier {actor}</div>
    <div className="lab-classroom-controls">
      <button disabled={active} onClick={() => move(true)}>Move spare chair to side</button>
      <button disabled={active} onClick={() => move(false)}>Return chair to row</button>
      <button disabled={!active} onClick={() => { if (last) response(sim.rt.cancel(last.id), 'Stopping with safe physical set-down'); }}>Stop moving chair</button>
    </div>
    <div role="status" data-testid="fixture-move-progress">{state && <>Chair: {state.status} · {state.phase} · {state.held ? 'held by carrier' : 'supported on ground'}{state.stopping && ' · stopping safely'}{state.waitingReason && ` · ${state.waitingReason}`}{state.diagnostic && ` · ${state.diagnostic.code}`}</>}</div>
    <div role="status" data-testid="fixture-move-feedback">{feedback}</div>
    <small>Choose a free standing carrier. Empty, unreserved chair only; occupied chairs and held belongings refuse. After set-down, direct the carrier to the courtyard to clear later gathering positions. A new arrival uses the chair where it was placed. Tables and active reserved-seat rearrangement follow later.</small>
  </div>;
}
