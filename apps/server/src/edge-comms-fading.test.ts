// C9: fading ships flag-off; with the flag on, warnings at 30/50 min, removal at 60, reclaim on action.
// LINK BODY (2026-10-24): the idle beam-up runs only with SIM_BEAM (option `beam`); without it nothing warns or removes.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {commsFixture} from './edge/comms/testing.ts';

const MIN = 60_000;

test('fading is off by default: no status, no events, no table writes', async () => {
  const f = commsFixture(['Alice']);
  try {
    assert.equal(f.runtime.fading.enabled, false);
    f.clock.now += 120 * MIN; f.runtime.sweep();
    assert.equal(f.runtime.fading.status(f.id('Alice')), null);
    assert.equal((await f.drain('Alice')).events.length, 0);
  } finally { f.destroy(); }
});

test('LINK: beam off (the default): no warnings, never gone, status green; touches still reach onTouch listeners', async () => {
  const f = commsFixture(['Alice'], {fading: true});
  const touched: string[] = [];
  f.runtime.fading.onTouch(id => touched.push(id));
  try {
    assert.equal(f.runtime.fading.beam, false);
    f.at('Alice', 0, 0); f.runtime.sweep();
    f.clock.now += 120 * MIN; f.runtime.sweep();
    assert.deepEqual(f.runtime.fading.status(f.id('Alice')), {colour: 'green', idleSeconds: 0});
    assert.equal((await f.drain('Alice')).events.filter((e: any) => e.kind === 'fade').length, 0);
    assert.deepEqual(f.runtime.fading.gone(), []);
    f.ledger.receipt({id: 'r_x', soulId: f.id('Alice'), phase: 'started'});
    assert.deepEqual(touched, [f.id('Alice')]);
  } finally { f.destroy(); }
});

// LINK (Gene 2026-10-24): idle bodies now stay in the world (zombie/asleep); the 30/50 min warnings and the 60 min removal only run with SIM_BEAM on, so this enables it.
test('with the flag on: yellow at 30, red at 50, gone at 60; any accepted action reclaims', async () => {
  const f = commsFixture(['Alice', 'Bob'], {fading: true, beam: true});
  const changes: string[] = [];
  f.runtime.fading.onFade(c => changes.push(`${c.soulId}:${c.change}:${c.colour}`));
  try {
    f.at('Alice', 0, 0); f.at('Bob', 1, 0);
    f.runtime.sweep();                                   // starts both clocks
    f.clock.now += 20 * MIN;
    await f.post('Bob', '/v1/edge/say', {text: 'still here'});   // Bob acts at 20
    f.clock.now += 10 * MIN; f.runtime.sweep();          // 30
    assert.deepEqual(f.runtime.fading.status(f.id('Alice')), {colour: 'yellow', idleSeconds: 30 * 60});
    assert.equal(f.runtime.fading.status(f.id('Bob'))!.colour, 'green');
    f.clock.now += 20 * MIN; f.runtime.sweep();          // 50
    f.clock.now += 10 * MIN; f.runtime.sweep();          // 60 exactly
    assert.equal(f.runtime.fading.status(f.id('Alice'))!.colour, 'gone');
    const fades = (await f.drain('Alice')).events.filter((e: any) => e.kind === 'fade').map((e: any) => [e.colour, e.change]);
    assert.deepEqual(fades, [['yellow', 'warn'], ['red', 'warn'], ['gone', 'removed']]);
    f.ledger.receipt({id: 'r_back', soulId: f.id('Alice'), phase: 'started'});
    assert.equal(f.runtime.fading.status(f.id('Alice'))!.colour, 'green');
    assert.deepEqual(changes.filter(c => c.startsWith('s_alice')), ['s_alice:warn:yellow', 's_alice:warn:red', 's_alice:removed:gone', 's_alice:reclaimed:green']);
    assert.deepEqual(f.runtime.steward.list().map(w => [w.kind, w.body.what]), [['narration', 'faded'], ['narration', 'reclaimed']]);
  } finally { f.destroy(); }
});
