// Longrun 2026-10-16 (friction 1, 6): Cleo's routine "walk to the harbour" and Basil's "take a walk through the park"
// were compiled and kept silently, then refused at every occurrence. A compile now names the steps that resolve to
// nothing in this world (server dry run), keeps the binding, and never flags here-acts or steps the lookup could not check.
import test from 'node:test';
import assert from 'node:assert/strict';
import {unresolvedBindingSteps} from './client-living.mjs';

const world = new Map([['walk:field', {ok: true}], ['take a walk through the Green field', {ok: true}],
  ['walk to the harbour', {ok: false, code: 'capability.unknown', reason: 'Nothing offered matches "walk to the harbour"; read capabilities again.'}],
  ['walk:walk-lighthouse', {ok: false, code: 'site.under-construction', reason: 'walk1 is under construction'}]]);
const resolve = async capability => {if (capability === 'walk:offline') throw new Error('network'); return world.get(capability) ?? {ok: false, code: 'capability.unknown', reason: 'no such thing'};};

test('compile flags routine steps that name nothing in this world, and only those', async () => {
  const seen = [];
  const out = await unresolvedBindingSteps([
    {id: 'routine:stroll', steps: [{act: 'take a walk through the Green field'}, {act: 'sit:here'}, {say: 'lovely'}]},
    {id: 'routine:harbour', steps: [{act: 'walk to the harbour'}, {act: 'rest:here'}]},
    {id: 'routine:site', steps: [{act: 'walk:walk-lighthouse'}]},
    {id: 'routine:offline', steps: [{act: 'walk:offline'}, {act: 'look at the sky'}]},
  ], async c => {seen.push(c); return resolve(c);});
  assert.deepEqual(out.map(u => [u.id, u.act, u.code]), [['routine:harbour', 'walk to the harbour', 'capability.unknown']]);
  assert.ok(!seen.includes('sit:here') && !seen.includes('look at the sky'), 'here-acts and attention steps are not looked up');
  assert.deepEqual(await unresolvedBindingSteps(undefined, resolve), []);
  const many = Array.from({length: 20}, (_, i) => ({id: 'r' + i, steps: [{act: 'walk to the harbour'}]}));
  assert.equal((await unresolvedBindingSteps(many, resolve)).length, 8, 'bounded');
});
