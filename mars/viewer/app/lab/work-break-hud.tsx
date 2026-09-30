import { useState } from 'react';
import { WORK_BREAK_BINDING as B } from '../../engine/scenarios/work-break.ts';
import { heldBy } from '../../engine/items/model.ts';
import { readWorkstation } from '../../engine/objects/workstation.ts';
import { readSharedFoodBreak } from '../../engine/activities/shared-food-break.ts';
import type { ActionRecord } from '../../engine/actions/types.ts';
import type { LabSim } from './sim.ts';

export function WorkBreakHud({ sim, refresh }: { sim: LabSim; refresh: () => void }) {
  const [actor, setActor] = useState(B.people[0].actor);
  const [feedback, setFeedback] = useState('');
  if (!sim.scenario.name.startsWith('work-break-')) return null;
  const rt = sim.rt, person = B.people.find(p => p.actor === actor)!;
  const records = [...rt.records.values()];
  const active = records.filter(r => rt.isActive(r.id));
  const work = readWorkstation(rt, B.work.station);
  const working = active.find(r => r.verb === 'work_at');
  const workBusy = rt.holder(`actor:${B.work.actor}`).length > 0;
  const shared = active.find(r => r.verb === 'shared_food_break') ?? records.filter(r => r.verb === 'shared_food_break').at(-1);
  const sharedActive = !!shared && rt.isActive(shared.id);
  const sharedState = shared && readSharedFoodBreak(rt, shared.id);
  const group = active.find(r => {
    const members = (r.params as { actors?: string[] }).actors;
    return r.verb === 'converse' && members?.length === B.people.length && B.people.every(p => members.includes(p.actor));
  });
  const foodAction = active.find(r => ['take_item', 'serve', 'eat', 'stow_items', 'walk_to'].includes(r.verb) && (r.params as { actor?: string }).actor === actor);
  const busy = rt.holder(`actor:${actor}`).length > 0;
  const held = heldBy(rt.world, actor);
  const holds = (item: string) => held.some(h => h.item.id === item);
  const bowl = rt.world.entities[person.bowl];
  const response = (record: ActionRecord, text: string) => { setFeedback(record.diagnostic ? `${record.diagnostic.code}: ${record.diagnostic.message}` : text); refresh(); };
  const submit = (verb: string, params: unknown, text: string) => response(rt.submit(verb, params), text);
  return <div className="lab-hud lab-classroom" data-testid="work-break-hud">
    <div className="lab-hud-head">HYPOTHETICAL · work and shared food · one continuing world</div>
    <ol>
      <li>Start notes, then interrupt after some progress. Wait for safe stand-up.</li>
      <li>Use the classroom controls above: start the session, join worker, ask a question, watch both talks and conversations, and wait for departure.</li>
      <li>Start shared food break: both people take utensils, serve, gather, eat and return them.</li>
      <li>Stop anytime. After safe stopping, restart to use retained utensils and partial portions.</li>
      <li>When hands are free, resume the same notes, or use the quiet-rest controls below and get up before resuming. Individual food controls remain available below.</li>
    </ol>
    <div data-testid="break-work-readout">Notes: {'code' in work ? work.message : `${work.status} · ${work.task ?? 'Sketch notes'} · ${work.user ?? 'unassigned'} · ${work.elapsed.toFixed(1)}/${work.duration}s · ${work.phase ?? 'ready'}`}</div>
    <div className="lab-classroom-controls">
      <button disabled={workBusy || !!working || !('code' in work) && work.status === 'unfinished'} onClick={() => submit('work_at', B.work, 'Starting notes')}>Start notes</button>
      <button disabled={!working} onClick={() => working && response(rt.cancel(working.id), 'Stopping work safely; progress remains')}>Interrupt notes</button>
      <button disabled={workBusy || !!working || 'code' in work || work.status !== 'unfinished'} onClick={() => submit('work_at', { ...B.work, resume: true }, 'Returning to the same unfinished notes')}>Resume notes</button>
    </div>
    <div className="lab-classroom-controls">
      <button data-testid="start-shared-food" disabled={sharedActive || B.people.some(p => rt.holder(`actor:${p.actor}`).length > 0)} onClick={() => submit('shared_food_break', { pot: B.pot, participants: B.people, at: B.conversation.at }, 'Both people begin a shared break through ordinary actions')}>Start shared food break</button>
      <button disabled={!sharedActive} onClick={() => shared && response(rt.cancel(shared.id), 'Stopping the break safely; partial food and supported utensils remain')}>Stop shared food break</button>
    </div>
    {working && <div role="status">Interrupt notes and wait for safe stand-up before starting the shared break.</div>}
    <div data-testid="shared-food-readout">
      {sharedState ? <>
        <div>Shared break: {sharedState.status} · {sharedState.phase} · Floor: <b>{sharedState.floorHolder ?? '—'}</b></div>
        {sharedState.participants.map(p => <div key={p.actor}>{p.actor} · holds {p.held.length ? p.held.join(', ') : 'nothing'} · bowl {Math.round(p.food * 100)}% · {p.returned.length}/2 returned</div>)}
        {sharedState.waitingReason && <div role="status">Waiting: {sharedState.waitingReason}</div>}
        {sharedState.diagnostic && <div role="status">{sharedState.diagnostic.code}: {sharedState.diagnostic.message}</div>}
      </> : 'Ready: two free people, their bowls/spoons, a shared pot and approved return slots.'}
      <div>Shared pot: {Math.round((rt.world.entities[B.pot].contents?.fraction ?? 0) * 100)}%</div>
    </div>
    <details>
    <summary>Direct individual food actions</summary>
    <p>Take bowl and spoon for each person, approach and serve, gather together, eat, end conversation, then return utensils. A new direct command can interrupt a coordinated break.</p>
    <label>Food-break participant <select aria-label="Food-break participant" value={actor} onChange={e => setActor(e.target.value)}>{B.people.map(p => <option key={p.actor}>{p.actor}</option>)}</select></label>
    <div data-testid="break-food-readout">{actor} holds {held.length ? held.map(h => h.item.id).join(', ') : 'nothing'} · bowl {Math.round((bowl.contents?.fraction ?? 0) * 100)}% · shared pot {Math.round((rt.world.entities[B.pot].contents?.fraction ?? 0) * 100)}%</div>
    <div className="lab-classroom-controls">
      <button disabled={busy || holds(person.bowl)} onClick={() => submit('take_item', { actor, item: person.bowl, hand: 'left' }, `${actor} takes a bowl`)}>Take break bowl</button>
      <button disabled={busy || holds(person.spoon)} onClick={() => submit('take_item', { actor, item: person.spoon, hand: 'right' }, `${actor} takes a spoon`)}>Take break spoon</button>
      <button disabled={busy} onClick={() => submit('walk_to', { actor, x: person.service[0], z: person.service[1] }, `${actor} approaches the serving pot`)}>Approach serving pot</button>
      <button onClick={() => submit('walk_to', { actor, x: 12, z: 10 }, `Directed ${actor} to courtyard; an active break will stop coherently`)}>Direct participant to courtyard</button>
      <button disabled={busy || !holds(person.bowl)} onClick={() => submit('serve', { actor, bowl: person.bowl, pot: B.pot }, `${actor} serves stew`)}>Serve stew</button>
      <button disabled={!!foodAction || !holds(person.bowl) || !holds(person.spoon)} onClick={() => submit('eat', { actor, bowl: person.bowl, spoon: person.spoon }, `${actor} eats`)}>Eat stew</button>
      <button disabled={!foodAction} onClick={() => foodAction && response(rt.cancel(foodAction.id), 'Stopping the selected food action safely')}>Stop food action</button>
      <button disabled={busy || !held.length} onClick={() => submit('stow_items', { actor, placements: person.returns.filter(p => holds(p.item)) }, `${actor} returns utensils to the serving table`)}>Return break utensils</button>
    </div>
    <div className="lab-classroom-controls">
      <button disabled={!!group || B.people.some(p => rt.holder(`actor:${p.actor}`).length > 0)} onClick={() => submit('converse', B.conversation, 'Both people gather for a shared break')}>Gather for shared break</button>
      <button disabled={!group} onClick={() => group && response(rt.cancel(group.id), 'Ending conversation safely; held utensils remain')}>End break conversation</button>
    </div>
    </details>
    <div data-testid="break-action-readout">{active.filter(r => !r.parent).map(r => <div key={r.id}>{r.verb} · {r.status} · {r.phase}{r.diagnostic && ` · ${r.diagnostic.code}: ${r.diagnostic.message}`}</div>)}</div>
    <div role="status" data-testid="break-feedback">{feedback}</div>
    <small>Standing shared meal, explicit instructions and returns. Missing food, movement, full hands and resource conflicts refuse with named diagnostics. Quiet seated rest uses the spare chair through the controls below; get up or Stop and wait for release before resuming work. Sleep, autonomous scheduling and seated meals are later increments.</small>
  </div>;
}
