import test from 'node:test'; import assert from 'node:assert/strict';
import { waitForPrograms } from './texture-budget.ts';
// production 2026-10-11: three's compileAsync threw "Cannot read properties of undefined (reading 'isReady')" in its own
// timer when LiveWorld re-mounted mid-compile (old renderer disposed: its material properties have no currentProgram)
test('a material without a program (disposed renderer) resolves, never throws', async () => {
  const r = { properties: { get: () => ({}) } };
  await waitForPrograms(r, new Set([{}, {}]), () => true, 1000);
});
test('waits for programs to be ready, then resolves', async () => {
  let ready = false; const r = { properties: { get: () => ({ currentProgram: { isReady: () => ready } }) } };
  let done = false; const p = waitForPrograms(r, new Set([{}]), () => true, 5000).then(() => { done = true; });
  await new Promise((res) => setTimeout(res, 50)); assert.equal(done, false);
  ready = true; await p; assert.equal(done, true);
});
test('stops when the renderer is replaced, when it throws, or at the timeout', async () => {
  let current = true; const never = { properties: { get: () => ({ currentProgram: { isReady: () => false } }) } };
  const a = waitForPrograms(never, new Set([{}]), () => current, 10_000); current = false; await a;
  await waitForPrograms({ properties: { get: () => { throw new Error('disposed'); } } }, new Set([{}]), () => true, 10_000);
  const t0 = Date.now(); await waitForPrograms(never, new Set([{}]), () => true, 100); assert.ok(Date.now() - t0 < 1000);
});
