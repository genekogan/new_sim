import test from 'node:test';
import assert from 'node:assert/strict';
import { signOutAndReturn } from './clerk-sign-out.ts';

test('same-world sign-out waits for Clerk cleanup then reloads even with a hash', async () => {
  const href = 'https://sim.eden.art/worlds/w/eden-2026/#watch';
  const events: string[] = [];
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const clerk = { async signOut(callback: () => void) { events.push('sign-out'); callback(); await pending; events.push('cleaned'); } };
  const result = signOutAndReturn(clerk, undefined, { location: { href, reload() { events.push('reload'); }, assign() { assert.fail('same URL must reload'); } }, history: { state: null, replaceState() { assert.fail('same URL does not need changing'); } } });
  assert.deepEqual(events, ['sign-out']);
  finish(); await result;
  assert.deepEqual(events, ['sign-out', 'cleaned', 'reload']);
});

test('explicit same URL reloads; a different return URL preserves its query and fragment', async () => {
  const href = 'https://sim.eden.art/worlds/w/eden-2026/#watch';
  const events: string[] = [];
  const here = { location: { href, reload() { events.push('reload'); }, assign(target: string) { events.push(target); } }, history: { state: null, replaceState() { assert.fail('different document does not use history'); } } };
  const clerk = { async signOut(callback: () => void) { callback(); } };
  await signOutAndReturn(clerk, href, here);
  await signOutAndReturn(clerk, '/worlds/?view=public#watch', here);
  assert.deepEqual(events, ['reload', 'https://sim.eden.art/worlds/?view=public#watch']);
});

test('a hash-only return updates the intended fragment and still reloads the document', async () => {
  const events: string[] = [], state = { publicView: true };
  const browser = {
    location: { href: 'https://sim.eden.art/worlds/w/eden-2026/#account', reload() { events.push('reload'); }, assign() { assert.fail('hash assignment would retain the document'); } },
    history: { state, replaceState(nextState: unknown, _unused: string, target?: string | URL | null) { assert.equal(nextState, state); events.push(String(target)); } },
  };
  await signOutAndReturn({ async signOut(callback: () => void) { callback(); } }, '#watch', browser);
  assert.deepEqual(events, ['https://sim.eden.art/worlds/w/eden-2026/#watch', 'reload']);
});

test('the return destination is captured before Clerk can change the current fragment', async () => {
  const href = 'https://sim.eden.art/worlds/w/eden-2026/#watch';
  const events: string[] = [];
  const browser = {
    location: { href, reload() { events.push('reload'); }, assign() { assert.fail('same document'); } },
    history: { state: null, replaceState(_state: unknown, _unused: string, target?: string | URL | null) { events.push(String(target)); } },
  };
  const clerk = { async signOut(callback: () => void) { callback(); browser.location.href = href.replace('#watch', '#account'); } };
  await signOutAndReturn(clerk, undefined, browser);
  assert.deepEqual(events, [href, 'reload']);
});

test('failed sign-out does not reload or navigate', async () => {
  const failure = new Error('sign-out failed');
  const clerk = { async signOut() { throw failure; } };
  const here = { location: { href: 'https://sim.eden.art/worlds/', reload() { assert.fail('still signed in'); }, assign() { assert.fail('still signed in'); } }, history: { state: null, replaceState() { assert.fail('still signed in'); } } };
  await assert.rejects(signOutAndReturn(clerk, undefined, here), failure);
});
