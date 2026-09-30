import { useState } from 'react';
import type { ActionRecord } from '../../engine/actions/types.ts';
import { heldBy } from '../../engine/items/model.ts';
import { occupantOf, slotById } from '../../engine/social/slots.ts';
import { WORK_BREAK_BINDING } from '../../engine/scenarios/work-break.ts';
import { classroomFurniture } from './room-layout.ts';
import type { LabSim } from './sim.ts';

/** Explicit quiet sitting only: no sleep state, timer, voluntary-return policy or next action. */
export function RestHud({ sim, refresh }: { sim: LabSim; refresh: () => void }) {
  const [request, setRequest] = useState<{ epoch: number; sit: string; stand?: string }>();
  const [feedback, setFeedback] = useState('');
  if (sim.scenario.name !== 'work-break-4' && sim.scenario.name !== 'work-break-8') return null;
  const rt = sim.rt, actor = WORK_BREAK_BINDING.work.actor;
  const seat = `${classroomFurniture(sim.scenario.name).chair.id}#seat`;
  const lineage = new Set<string>();
  if (request?.epoch === sim.scenarioEpoch) lineage.add(request.sit);
  // Read Runtime's published return provenance, never its private execution/return queue.
  for (const event of rt.events) {
    if (event.type !== 'mark' || event.name !== 'social.resume-started') continue;
    const data = event.data as { source?: string; action?: string; actor?: string };
    if (data.source && lineage.has(data.source) && data.actor === actor && data.action) lineage.add(data.action);
  }
  const candidates = [...lineage].map(id => rt.records.get(id)).filter((record): record is ActionRecord => {
    const params = record?.params as { actor?: string; slot?: string } | undefined;
    return record?.verb === 'sit' && !record.parent && params?.actor === actor && params.slot === seat;
  });
  // Never adopt another seat action, a classroom child, or an ID from a replaced world.
  const own = candidates.findLast(record => rt.isActive(record.id)) ?? candidates.at(-1);
  const active = !!own && rt.isActive(own.id);
  const ownedActor = active && rt.holder(`actor:${actor}`).includes(own.id);
  const slot = slotById(rt, seat);
  const occupant = 'code' in slot ? undefined : occupantOf(rt.world, slot);
  const items = heldBy(rt.world, actor).map(h => h.item.id);
  const actorBusy = () => rt.holder(`actor:${actor}`).length > 0 || [...rt.records.values()].some(record => {
    const params = record.params as { actor?: string; actors?: string[] };
    // A paused intention owns no physical actor. Real holders/children still
    // block this control; a new ordinary sit can intervene in the intention.
    return record.verb !== 'purposeful_routine' && rt.isActive(record.id) && (params.actor === actor || params.actors?.includes(actor));
  });
  const human = rt.world.entities[actor]?.human;
  const standingUp = active && (own.phase === 'stand-up' || own.phase === 'cancelling' || human?.activity === 'stand-up');
  const resting = active && own.phase === 'occupied' && occupant === actor && ownedActor;
  const respond = (record: ActionRecord, text: string) => {
    setFeedback(record.diagnostic ? `${record.diagnostic.code}: ${record.diagnostic.message}` : text);
    refresh();
  };
  const rest = () => {
    if (sim.rt !== rt || heldBy(rt.world, actor).length || active || actorBusy()) return;
    const record = rt.submit('sit', { actor, slot: seat }, { preempt: false });
    setRequest({ epoch: sim.scenarioEpoch, sit: record.id });
    respond(record, `Requested quiet seated rest for ${actor} at ${seat}`);
  };
  const getUp = () => {
    if (sim.rt !== rt || request?.epoch !== sim.scenarioEpoch || !own || !rt.isActive(own.id) || !rt.holder(`actor:${actor}`).includes(own.id)) return;
    const record = rt.submit('stand', { actor }, { preempt: false });
    setRequest({ epoch: sim.scenarioEpoch, sit: own.id, stand: record.id });
    respond(record, 'Getting up; wait for actual seat release before resuming notes or directing away');
  };
  const stop = () => {
    if (sim.rt !== rt || request?.epoch !== sim.scenarioEpoch || !own || !rt.isActive(own.id)) return;
    respond(rt.cancel(own.id), 'Stopping only this quiet rest; waiting for safe seat release');
  };
  return <section className="lab-hud lab-classroom" data-testid="quiet-rest-hud">
    <div className="lab-hud-head">HYPOTHETICAL · quiet seated rest · not sleep</div>
    <div>{actor} · authored spare chair {seat}</div>
    <div className="lab-classroom-controls">
      <button disabled={active || actorBusy() || items.length > 0} onClick={rest}>Rest quietly</button>
      <button disabled={!ownedActor || standingUp} onClick={getUp}>Get up from rest</button>
      <button disabled={!active} onClick={stop}>Stop quiet rest</button>
    </div>
    {items.length > 0 && <div role="status">Return utensils first: {items.join(', ')}. This quiet-rest control asks for free hands.</div>}
    <div role="status" data-testid="quiet-rest-readout">
      {resting ? 'Resting quietly' : standingUp ? 'Getting up · waiting for safe seat release' : active ? `Approaching rest · ${own.phase}` : own?.diagnostic?.code === 'social.pre-empted' && actorBusy() ? 'Temporarily directed away · existing engine return may follow' : own ? `Quiet rest ${own.status} · ${own.status === 'failed' ? 'no rest admitted' : 'own seat action ended'}` : 'Ready for explicit seated rest'}
      <div>Actual occupant: {occupant ?? 'none'} · Seat claim: {'code' in slot ? slot.message : slot.claimedBy ?? 'none'}</div>
      {own?.diagnostic && <div>{own.diagnostic.code}: {own.diagnostic.message}</div>}
      {request?.epoch === sim.scenarioEpoch && request.stand && rt.isActive(request.stand) && <div>Stand action is waiting for actual release.</div>}
    </div>
    <div role="status" data-testid="quiet-rest-feedback">{feedback}</div>
    <small>Use the spare chair where it was physically placed, after classroom and food cleanup. Get up or Stop ends only the rest owned by this panel. Wait for release, then explicitly resume notes or direct away. An ordinary directive during an occupied standalone sit retains existing engine voluntary return behavior. No sleep, recovery model or automatic next activity.</small>
  </section>;
}
