import { useState } from 'react';
import type { LabSim } from './sim.ts';
import type { ActionRecord } from '../../engine/actions/types.ts';
import { heldBy } from '../../engine/items/model.ts';
import { readStow } from '../../engine/activities/stow.ts';

const returns: Record<string, string> = {
  'break-bowl': 'belongings-table#r2c1',
  'break-spoon': 'belongings-table#r2c2',
};
export function BelongingsHud({ sim, actor, refresh }: { sim: LabSim; actor: string; refresh: () => void }) {
  const [feedback, setFeedback] = useState('');
  const held = heldBy(sim.rt.world, actor);
  const busy = sim.rt.holder(`actor:${actor}`).length > 0;
  const stow = [...sim.rt.records.values()].filter((r) => r.verb === 'stow_items' && (r.params as { actor?: string }).actor === actor).at(-1);
  const active = !!stow && sim.rt.isActive(stow.id);
  const preparation = stow && readStow(sim.rt, stow.id);
  const response = (r: ActionRecord, text: string) => {
    setFeedback(r.diagnostic ? `${r.diagnostic.code}: ${r.diagnostic.message}` : text);
    refresh();
  };
  const putAway = () => {
    const unassigned = held.filter(({ item }) => !returns[item.id]);
    if (unassigned.length) {
      setFeedback(`lab.belongings.no-return-slot: choose an approved destination for ${unassigned.map(({ item }) => item.id).join(', ')}`);
      return;
    }
    response(sim.rt.submit('stow_items', { actor, placements: held.map(({ item }) => ({ item: item.id, surfaceSlot: returns[item.id] })) }), `Putting ${actor}'s belongings on the return table`);
  };
  return <div data-testid="belongings-hud">
    <div>Bowl and spoon · {actor} holds {held.length ? held.map(({ item }) => item.id).join(', ') : 'nothing'}</div>
    <div className="lab-classroom-controls">
      <button disabled={busy || sim.rt.world.entities['break-bowl']?.support?.kind === 'in-hand'} onClick={() => response(sim.rt.submit('take_item', { actor, item: 'break-bowl', hand: 'left' }), `${actor} is taking the bowl`)}>Take bowl</button>
      <button disabled={busy || sim.rt.world.entities['break-spoon']?.support?.kind === 'in-hand'} onClick={() => response(sim.rt.submit('take_item', { actor, item: 'break-spoon', hand: 'right' }), `${actor} is taking the spoon`)}>Take spoon</button>
      <button disabled={busy || !held.length} onClick={putAway}>Put belongings away</button>
      <button disabled={!active} onClick={() => { if (stow) response(sim.rt.cancel(stow.id), 'Stopped putting items away; existing placements remain'); }}>Stop putting away</button>
    </div>
    <div data-testid="belongings-progress">{preparation && <>Preparation: {preparation.status} · {preparation.completed.length} returned · {preparation.remaining.length} still held{preparation.waitingReason && ` · ${preparation.waitingReason}`}{preparation.diagnostic && ` · ${preparation.diagnostic.code}: ${preparation.diagnostic.message}`}</>}</div>
    <div role="status">{feedback}</div>
    <small>Explicit table returns prepare free hands for class or work. Placed objects stay where you leave them; this example does not prepare or eat food.</small>
  </div>;
}
