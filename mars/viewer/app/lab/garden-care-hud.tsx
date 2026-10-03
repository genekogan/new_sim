import { useState } from 'react';
import type { LabSim } from './sim.ts';
import { GARDEN_PLANTS, gardenCareParams } from '../../engine/scenarios/garden-care.ts';
import { readGarden } from '../../engine/objects/garden.ts';

export function GardenCareHud({ sim, refresh }: { sim: LabSim; refresh: () => void }) {
  const [plant, setPlant] = useState<string>('plant-a');
  const [feedback, setFeedback] = useState('Choose a due planter, request care and Play. Water is finite.');
  if (sim.scenario.name !== 'garden-care') return null;
  const rt = sim.rt, water = rt.world.entities['water-bowl'];
  const active = [...rt.records.values()].find(r => r.verb === 'garden_care' && rt.isActive(r.id));
  const begin = () => {
    const r = rt.submit('garden_care', gardenCareParams(plant), { preempt: false });
    setFeedback(r.diagnostic ? `${r.diagnostic.code}: ${r.diagnostic.message}` : 'Approaching the same finite water bowl and planter.'); refresh();
  };
  return <section className="lab-hud lab-classroom" data-testid="garden-care-hud">
    <h3>Garden care · hypothetical</h3>
    <p>Two grounded raised planters, one carer and one finite bowl of water. Each care cycle consumes 0.25 bowl through four deposits and returns the same bowl to its table. Care becomes due again after 30 simulated seconds; there is no automatic refill, growth model or active-session reload restoration.</p>
    <div data-testid="garden-water">Water remaining: {water?.contents?.fraction.toFixed(4) ?? 'unavailable'} · {water?.support?.kind ?? 'missing'}</div>
    <div data-testid="garden-care-readout">
      {GARDEN_PLANTS.map(id => {
        const s = readGarden(rt, id);
        return <div key={id}>{'code' in s ? `${s.code}: ${s.message}` : `${id} · ${s.due ? 'care due' : `${(s.remainingTicks / 20).toFixed(1)}s until due`} · cycles ${s.cycles} · water received ${s.waterReceived.toFixed(4)}${s.pending ? ` · retained ${s.pending.purpose} ${s.pending.delivered.toFixed(4)}/0.25` : ''}`}</div>;
      })}
      {active && <div>{active.phase} · {active.status}{active.diagnostic ? ` · ${active.diagnostic.code}: ${active.diagnostic.message}` : ''}</div>}
    </div>
    <label>Planter <select aria-label="Planter" value={plant} disabled={!!active} onChange={event => setPlant(event.target.value)}>{GARDEN_PLANTS.map(id => <option key={id}>{id}</option>)}</select></label>
    <div className="lab-classroom-controls">
      <button disabled={!!active} onClick={begin}>Care for selected plant</button>
      <button disabled={!active} onClick={() => { if (active) { rt.cancel(active.id); setFeedback('Stopping safely and returning the bowl; committed deposits remain.'); refresh(); } }}>Pause care</button>
      <button disabled={!!active} onClick={begin}>Resume retained care</button>
      <button onClick={() => { const r = rt.submit('walk_to', { actor: 'carer', x: -5, z: 3 }); setFeedback(r.diagnostic ? `${r.diagnostic.code}: ${r.diagnostic.message}` : 'Carer will return the bowl safely before following this direction.'); refresh(); }}>Direct carer away</button>
    </div>
    <div role="status" data-testid="garden-care-feedback">{feedback}</div>
    <small>Pause care requests a physical stop; keep Play running until the bowl is returned. Resume retains the same partial purpose and deposits. A new cycle requires elapsed time and enough actual water. Reset replaces this hypothetical world.</small>
  </section>;
}
