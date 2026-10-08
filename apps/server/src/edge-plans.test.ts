// Server-side plans (EVENTS-v1 §plans) against a fake actor: for / until / act-ends steps, offline execution, PATCH
// insert / replace / skip / resume / cancel, onRefusal policies, restart persistence without double acts, an own act
// pausing the plan, honest intent refusals, keeping a posture up, determinism, and fade by abandonment.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EdgeError} from './edge/contract.ts';
import {eventsFixture, FakeActor} from './edge/events/testing.ts';
import {parseDuration} from './edge/plans/plans.ts';

const MIN = 60_000;
const flush = () => new Promise(r => setImmediate(r));
const kinds = async (f: ReturnType<typeof eventsFixture>, name: string) => (await f.envelopes(name)).filter(e => e.kind.startsWith('plan.')).map(e => `${e.kind}${e.data?.status ? ':' + e.data.status : ''}`);

test('durations', () => {
  assert.equal(parseDuration('90s', 'x'), 90_000); assert.equal(parseDuration('5m', 'x'), 300_000); assert.equal(parseDuration('1.5 h', 'x'), 5_400_000); assert.equal(parseDuration(30, 'x'), 30_000);
  assert.throws(() => parseDuration('soon', 'for'), /duration/);
});

test('the field scenario: sit near Bill 5 min, swim 3 min, front-row seat until the talk begins — offline, step by step', async () => {
  const f = eventsFixture(['Roger', 'Bill']);
  try {
    f.at('Roger', 0, 0); f.at('Bill', 1, 0);
    const {status, body} = await f.post('Roger', '/v1/edge/plan', {steps: [
      {do: {verb: 'sit', target: {nearest: 'seat', near: 'Bill', free: true}}, for: '5m'},
      {do: 'swim:shore-water', for: '3m'},
      {do: 'sit in the presentation room, front row', until: {event: 'presentation.started'}},
    ]});
    assert.equal(status, 200, JSON.stringify(body)); const id = body.plan.id;
    assert.equal(body.plan.state, 'running'); assert.equal(body.plan.steps[0].status, 'running');
    // step 1 resolved when it started; `for` passes seconds to the act
    assert.deepEqual(f.actor.acts[0]!.input, {verb: 'sit', target: {nearest: 'seat', near: 'Bill', free: true}, params: {seconds: 300}, clientRef: `pl:${id}:0:1`});
    // the client goes away; time passes; the server carries on
    f.clock.now += 5 * MIN; f.plans.tick(); await flush();
    assert.equal(f.actor.acts.at(-1)!.input.capability, 'swim:shore-water');
    f.actor.set(f.actor.acts.at(-1)!.receipt!.id, 'completed');          // the swim ends by itself; the step lasts its 3 min
    f.clock.now += 1 * MIN; f.plans.tick(); await flush();
    assert.equal((await f.get('Roger', `/v1/edge/plan/${id}`)).body.plan.current, 1);
    f.clock.now += 2 * MIN; f.plans.tick(); await flush();
    assert.equal(f.actor.acts.at(-1)!.input.capability, 'sit in the presentation room, front row');
    f.actor.set(f.actor.acts.at(-1)!.receipt!.id, 'completed');          // seated; waits for the talk
    f.clock.now += 30 * MIN; f.plans.tick(); await flush();
    assert.equal((await f.get('Roger', '/v1/edge/plan')).body.plan.current, 2, 'still waiting');
    f.runtime.streams.deliver(f.id('Roger'), 'schedule', 5, {object: 'talk-1', objectKind: 'presentation', text: '"Ponds" has begun.', data: {phase: 'started'}, untrusted: true});
    await flush(); await flush();
    const done = (await f.get('Roger', `/v1/edge/plan/${id}`)).body.plan;
    assert.equal(done.state, 'done'); assert.deepEqual(done.steps.map((s: any) => [s.status, s.ended]), [['done', 'time'], ['done', 'time'], ['done', 'until']]);
    assert.equal((await f.get('Roger', '/v1/edge/plan')).body.plan, null);
    assert.deepEqual(await kinds(f, 'Roger'), ['plan.step.started', 'plan.step.done:done', 'plan.step.started', 'plan.step.done:done', 'plan.step.started', 'plan.step.done:done', 'plan.done:done']);
    const env = (await f.envelopes('Roger')).filter(e => e.kind.startsWith('plan.'));
    assert.deepEqual(env.map(e => e.salience), [1, 2, 1, 2, 1, 2, 3]);
    assert.ok(env.every(e => e.text.length <= 240 && !e.text.includes('\n')));
    // the plan's own receipts are low salience in the stream (the plan reports them)
    assert.ok((await f.envelopes('Roger')).filter(e => e.raw === 'receipt').every(e => e.salience <= 1));
  } finally { f.destroy(); }
});

test('re-planning mid-run: PATCH replace turns around; insert, skip, cancel; one active plan per Soul', async () => {
  const f = eventsFixture(['Roger']);
  try {
    const p = (await f.post('Roger', '/v1/edge/plan', {steps: [{do: 'walk:pond', for: '10m'}, {do: 'walk:eden-classroom-1'}, {do: 'sit down', until: 'presentation.started'}]})).body.plan;
    f.clock.now += 10 * MIN; f.plans.tick(); await flush();
    assert.equal(f.actor.last()!.input.capability, 'walk:eden-classroom-1');
    // "the lecture is cancelled": go back to the pond instead
    const r = await f.patch('Roger', `/v1/edge/plan/${p.id}`, {op: 'replace', steps: [{do: 'walk:pond'}, {do: 'swim:shore-water', for: '2m'}]});
    assert.equal(r.status, 200); assert.equal(r.body.plan.steps[1].status, 'skipped'); assert.equal(f.actor.last()!.input.capability, 'walk:pond');
    // insert after the current step
    const ins = await f.patch('Roger', `/v1/edge/plan/${p.id}`, {op: 'insert', steps: [{say: 'Back to the water!'}]});
    assert.deepEqual(ins.body.plan.steps.map((s: any) => s.label), ['walk:pond', 'walk:eden-classroom-1', 'walk:pond', 'say "Back to the water!"', 'swim:shore-water']);
    assert.equal((await f.patch('Roger', `/v1/edge/plan/${p.id}`, {op: 'insert', at: 0, steps: [{do: 'x'}]})).status, 400);
    // the walk ends → the say step → the swim
    f.actor.set(f.actor.last()!.receipt!.id, 'completed'); await flush(); await flush();
    assert.equal(f.actor.last()!.input.capability, 'swim:shore-water');
    // skip the swim → done
    const sk = await f.patch('Roger', `/v1/edge/plan/${p.id}`, {op: 'skip'});
    assert.equal(sk.body.plan.state, 'done');
    // a new plan replaces the active one
    const a = (await f.post('Roger', '/v1/edge/plan', {steps: [{do: 'rest:here', for: '1h'}]})).body.plan;
    const b = await f.post('Roger', '/v1/edge/plan', {steps: [{do: 'wander:here', for: '5m'}]});
    assert.equal(b.body.replaced, a.id);
    assert.equal((await f.get('Roger', `/v1/edge/plan/${a.id}`)).body.plan.state, 'replaced');
    const del = await f.del('Roger', `/v1/edge/plan/${b.body.plan.id}`);
    assert.equal(del.body.plan.state, 'cancelled');
    assert.equal((await f.patch('Roger', `/v1/edge/plan/${b.body.plan.id}`, {op: 'skip'})).status, 409);
    assert.ok((await kinds(f, 'Roger')).includes('plan.done:replaced'));
    assert.equal((await f.envelopes('Roger')).find(e => e.kind === 'plan.done' && e.data?.status === 'replaced')!.salience, 1);
    // validation
    for (const bad of [{steps: []}, {steps: [{for: 'soon'}]}, {steps: [{do: 'x', say: 'y'}]}, {steps: [{do: 'x', until: {event: 'NOT VALID'}}]}, {steps: [{do: 'x', until: 'walk-done'}]}, {steps: [{do: 'x'}], onRefusal: 'shrug'}, {steps: Array(21).fill({do: 'x'})}])
      assert.equal((await f.post('Roger', '/v1/edge/plan', bad)).status, 400, JSON.stringify(bad));
  } finally { f.destroy(); }
});

test('refusals: pause-and-notify (with alternatives) then resume / skip; per-step skip; cancel', async () => {
  const f = eventsFixture(['Roger']);
  try {
    f.actor.refuse = i => i.capability === 'sit:bench-1' ? {code: 'slot.none-free', reason: 'Someone is sitting there.', did_you_mean: [{id: 'sit:bench-2', label: 'Bench 2'}]} : null;
    const p = (await f.post('Roger', '/v1/edge/plan', {steps: [{do: 'sit:bench-1', for: '5m'}, {do: 'wander:here'}]})).body.plan;
    assert.equal(p.state, 'paused'); assert.equal(p.steps[0].status, 'failed'); assert.equal(p.steps[0].code, 'slot.none-free');
    const failed = (await f.envelopes('Roger')).find(e => e.kind === 'plan.step.failed')!;
    assert.equal(failed.salience, 3); assert.match(failed.text, /slot\.none-free.*try sit:bench-2.*plan paused/);
    assert.deepEqual((failed.data!.alternatives as any[]).map(a => a.id), ['sit:bench-2']);
    assert.equal((await f.envelopes('Roger')).filter(e => e.kind === 'plan.paused').length, 1);
    // resume retries the same step (seat now free)
    f.actor.refuse = () => null;
    const res = await f.patch('Roger', `/v1/edge/plan/${p.id}`, {op: 'resume'});
    assert.equal(res.body.plan.state, 'running'); assert.equal(res.body.plan.steps[0].status, 'running');
    assert.equal(f.actor.last()!.input.clientRef, `pl:${p.id}:0:2`, 'a new attempt');
    // per-step skip and plan-level cancel
    f.actor.refuse = i => i.capability === 'nope' ? {code: 'capability.unknown', reason: 'Not here.'} : null;
    const q = (await f.post('Roger', '/v1/edge/plan', {steps: [{do: 'nope', onRefusal: 'skip'}, {do: 'rest:here'}]})).body.plan;
    assert.equal(q.state, 'running'); assert.equal(q.current, 1); assert.deepEqual(q.steps.map((s: any) => s.status), ['failed', 'running']);
    const c = (await f.post('Roger', '/v1/edge/plan', {steps: [{do: 'nope'}, {do: 'rest:here'}], onRefusal: 'cancel'})).body.plan;
    assert.equal(c.state, 'cancelled');
    // a failure after the act started (route blocked mid-walk) follows the same policy
    const w = (await f.post('Roger', '/v1/edge/plan', {steps: [{do: 'walk:far'}, {do: 'rest:here'}]})).body.plan;
    f.actor.set(f.actor.last()!.receipt!.id, 'failed', 'route.blocked', 'The way is blocked.'); await flush();
    assert.equal((await f.get('Roger', `/v1/edge/plan/${w.id}`)).body.plan.state, 'paused');
  } finally { f.destroy(); }
});

test('the Soul\'s own direct act pauses the plan; say does not; holding a posture: a 90-min lie keeps lying', async () => {
  const f = eventsFixture(['Roger']);
  try {
    const p = (await f.post('Roger', '/v1/edge/plan', {steps: [{do: 'walk:pond', for: '10m'}]})).body.plan;
    await f.post('Roger', '/v1/edge/say', {text: 'on my way'});
    assert.equal((await f.get('Roger', '/v1/edge/plan')).body.plan.state, 'running');
    await f.actor.act({soulId: f.id('Roger'), entityId: 'h', name: 'Roger', owner: 'o'}, {capability: 'face:s_bill'});   // a direct act replaces the plan's
    await flush();
    const now = (await f.get('Roger', `/v1/edge/plan/${p.id}`)).body.plan;
    assert.equal(now.state, 'paused'); assert.match(now.reason, /own act/);
    // keep-up: lie for 90 min; the lie ends after 30 (the body's own max) and the body stands → lie again with the time left
    const l = (await f.post('Roger', '/v1/edge/plan', {steps: [{do: 'lie', for: '90m'}]})).body.plan;
    assert.equal(f.actor.last()!.input.params && (f.actor.last()!.input.params as any).seconds, 1800, 'clamped to the activity max');
    f.clock.now += 30 * MIN; f.actor.set(f.actor.last()!.receipt!.id, 'completed'); await flush();
    f.plans.tick(); await flush();
    const again = f.actor.last()!;
    assert.equal(again.input.capability, 'lie:here', 'acts again with the chosen capability, not the words');
    assert.equal((again.input.params as any).seconds, 1800); assert.equal(again.input.clientRef, `pl:${l.id}:0:2`);
    // while the body still holds the posture, no re-issue
    f.ledger.holds.set(f.id('Roger'), 'lying'); f.clock.now += 31 * MIN; f.actor.set(again.receipt!.id, 'completed'); f.plans.tick(); await flush();
    assert.equal(f.actor.last(), again);
    f.clock.now += 30 * MIN; f.plans.tick(); await flush();
    assert.equal((await f.get('Roger', `/v1/edge/plan/${l.id}`)).body.plan.state, 'done');
  } finally { f.destroy(); }
});

test('invalid intents refuse honestly without a plain-word substitute; seconds the capability refuses are dropped', async () => {
  const f = eventsFixture(['Roger']);
  try {
    f.actor.throwFor = i => i.verb ? new EdgeError(400, 'invalid', 'body must be {capability, params?, clientRef?}') : null;
    f.actor.refuse = i => i.capability === 'swim:shore-water' && (i.params as any)?.seconds !== undefined ? {code: 'capability.params', reason: 'seconds must be an integer 1..600 for this capability.'} : null;
    const p = (await f.post('Roger', '/v1/edge/plan', {steps: [{do: {verb: 'sit', target: {nearest: 'seat', near: 'Bill', free: true}}}, {do: 'swim:shore-water', for: '20m'}]})).body.plan;
    assert.equal(p.state, 'paused');
    assert.equal(p.steps[0].code, 'invalid');
    assert.equal(f.actor.acts.length, 1, 'structured intent is attempted exactly once');
    assert.deepEqual(f.actor.acts[0]!.input.target, {nearest: 'seat', near: 'Bill', free: true});
    await f.patch('Roger', `/v1/edge/plan/${p.id}`, {op: 'skip'}); await flush();
    const swims = f.actor.acts.filter(a => a.input.capability === 'swim:shore-water').map(a => (a.input.params as any)?.seconds);
    assert.deepEqual(swims, [1200, 600, undefined], 'tries the time, then the max, then without');
    assert.equal((await f.get('Roger', `/v1/edge/plan/${p.id}`)).body.plan.steps[1].status, 'running');
  } finally { f.destroy(); }
});

test('restart: plans persist and resume; an in-flight step is retried with the same clientRef (no double act); deterministic events', async () => {
  const runs: string[][] = [];
  for (const round of [0, 1]) {
    const f = eventsFixture(['Roger']);
    let g: ReturnType<typeof eventsFixture> | null = null;
    try {
      const p = (await f.post('Roger', '/v1/edge/plan', {steps: [{do: 'rest:here', for: '10m'}, {do: 'walk:pond'}, {do: 'sit down', for: '5m'}]})).body.plan;
      f.clock.now += 10 * MIN;
      // simulate a crash between "step 2 starting" and the act: mark it starting in the DB the way issue() leaves it
      f.close();
      const row = f.db.db.prepare('SELECT body FROM edge_plans_v1 WHERE plan_id = ?').get(p.id) as {body: string};
      const plan = JSON.parse(row.body); plan.current = 1; plan.steps[0].state.status = 'done'; plan.steps[1].state = {status: 'starting', attempt: 1, reissues: 0, transient: 0, startedAt: f.clock.now};
      f.db.db.prepare('UPDATE edge_plans_v1 SET body = ? WHERE plan_id = ?').run(JSON.stringify(plan), p.id);
      // the act did reach the world before the crash: the actor already holds a receipt for that clientRef
      const actor = f.actor;
      await actor.act({soulId: f.id('Roger'), entityId: 'h', name: 'Roger', owner: 'o'}, {capability: 'walk:pond', clientRef: `pl:${p.id}:1:1`});
      const before = actor.acts.length;
      g = eventsFixture(['Roger'], {existing: {dir: f.dir, db: f.db, clock: f.clock}, actor});
      const g2 = g; actor.emit = r => { for (const l of g2.ledger.receiptListeners) l(r); };
      assert.equal((await g.get('Roger', '/v1/edge/plan')).body.plan.id, p.id, 'reloaded');
      g.plans.tick(); await flush();
      assert.equal(actor.acts.length, before, 'no second walk: the clientRef returned the first receipt');
      const v = (await g.get('Roger', '/v1/edge/plan')).body.plan;
      assert.equal(v.steps[1].status, 'running'); assert.equal(v.steps[1].receipt, actor.acts[before - 1]!.receipt!.id);
      actor.set(v.steps[1].receipt, 'completed'); await flush(); await flush();
      assert.equal(actor.last()!.input.capability, 'sit down');
      g.clock.now += 5 * MIN; g.plans.tick(); await flush();
      assert.equal((await g.get('Roger', `/v1/edge/plan/${p.id}`)).body.plan.state, 'done');
      runs.push((await g.envelopes('Roger')).filter(e => e.kind.startsWith('plan.')).map(e => `${e.kind} ${e.text.replace(/pl_[A-Za-z0-9_-]+/g, 'pl')}`));
    } finally { g?.destroy(); if (!g) f.destroy(); }
  }
  assert.deepEqual(runs[0], runs[1], 'the same plan and world answers give the same events');
});

test('fade by abandonment: an executing plan step or a chosen posture holds green; a truly abandoned Soul still fades at 60', async () => {
  const f = eventsFixture(['Roger', 'Bill', 'Carol']);
  try {
    f.runtime.sweep();
    // Roger: "lie down" through a 90-minute plan
    await f.post('Roger', '/v1/edge/plan', {steps: [{do: 'lie down', for: '90m'}]});
    // Bill: lay down by himself (no plan) and stays lying
    f.ledger.receipt({id: 'r_bill', soulId: f.id('Bill'), capability: 'lie:here', phase: 'started'});
    f.ledger.holds.set(f.id('Bill'), 'lying');
    for (let m = 0; m < 90; m += 10) {
      f.clock.now += 10 * MIN; f.runtime.sweep(); f.plans.tick(); await flush();
      assert.equal(f.runtime.fading.status(f.id('Roger'))!.colour, 'green', `Roger green at ${m + 10} min`);
      assert.equal(f.runtime.fading.status(f.id('Bill'))!.colour, 'green', `Bill green at ${m + 10} min`);
      if (m === 40) { assert.match(f.runtime.fading.status(f.id('Roger'))!.held ?? '', /^plan pl_/); assert.equal(f.runtime.fading.status(f.id('Bill'))!.held, 'lying'); }
    }
    assert.equal(f.runtime.fading.status(f.id('Carol'))!.colour, 'gone', 'Carol, abandoned, faded at 60');
    // the hold ends (Bill stands up): the 60 minutes count from then
    f.ledger.holds.delete(f.id('Bill'));
    f.clock.now += 31 * MIN; f.runtime.sweep();
    assert.equal(f.runtime.fading.status(f.id('Bill'))!.colour, 'yellow');
    f.clock.now += 30 * MIN; f.runtime.sweep();
    assert.equal(f.runtime.fading.status(f.id('Bill'))!.colour, 'gone');
    // a hold stops counting 12 h after the last accepted action
    f.ledger.holds.set(f.id('Roger'), 'seated');
    f.clock.now += 13 * 60 * MIN; f.runtime.sweep();
    assert.equal(f.runtime.fading.status(f.id('Roger'))!.colour, 'gone');
  } finally { f.destroy(); }
});
