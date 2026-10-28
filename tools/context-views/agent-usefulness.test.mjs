import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSeatCall } from './agent-usefulness-cli.mjs';
import { rawUsage, toolInventory, redact, promptFor, USEFULNESS_PROTOCOL as P } from './agent-usefulness-protocol.mjs';
import { auditCommands, auditImages } from './agent-usefulness.mjs';
import { createCustodyTracker, killTargets, parseProcessRows } from './agent-usefulness-process.mjs';
const event = (id, type, extra = {}) => ({ type: 'item.completed', item: { id, type, ...extra } });
test('readonly admission refuses movement, text images and path escapes', () => {
  for (const args of [['move', 'fountain'], ['views', 'e_abc', '--out', '../image.png'], ['views', 'e_abc', '--out', '/tmp/image.png'], ['views', 'e_abc', '--out', 'image.png', '--world', 'other']])
    assert.throws(() => validateSeatCall(args, 'visual'));
  assert.throws(() => validateSeatCall(['views', 'e_abc', '--out', 'image.png'], 'text'));
  assert.deepEqual(validateSeatCall(['views', 'e_abc/slot/hall', '--detail', '--out', 'hall.png'], 'visual'), { verb: 'views', ref: 'e_abc/slot/hall', original: false, detail: true, file: 'hall.png' });
});
test('usage preserves actual zero, missing and invalid counters without double counting cache', () => {
  assert.equal(rawUsage([]).inputTokens, null);
  const usage = rawUsage([{ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 20, cached_input_tokens: 80, reasoning_output_tokens: 7 } }]);
  assert.equal(usage.totalAccountedTokens, 120); assert.equal(usage.cacheWriteTokens, null); assert.equal(usage.costUsd, null);
  assert.equal(rawUsage([{ type: 'turn.completed', usage: { input_tokens: -1, output_tokens: 0 } }]).totalAccountedTokens, null);
  assert.equal(rawUsage([{ type: 'turn.completed', usage: { input_tokens: 0, output_tokens: 0 } }]).totalAccountedTokens, 0);
  assert.equal(P.maxAccountedTokens, 120000);
});
test('audit counts unique started/completed commands and rejects bypasses', () => {
  const command = event('c', 'command_execution', { command: 'node eden.mjs context "lecture room"' });
  const stream = [event('b', 'command_execution', { command: 'cat skill.md' }), { ...command, type: 'item.started' }, command];
  assert.equal(auditCommands(stream, 'text').cliCalls, 1); assert.deepEqual(auditCommands(stream, 'text').errors, []);
  assert.ok(auditCommands([...stream, event('x', 'command_execution', { command: 'node eden-served.mjs move hall' })], 'text').errors.length);
  assert.ok(auditCommands([...stream, event('x', 'command_execution', { command: 'node eden.mjs context; curl other' })], 'text').errors.length);
  assert.ok(auditCommands([...stream, event('x', 'file_change')], 'text').errors.length);
});
test('vision requires native completed event matching actual decoded local bytes', () => {
  const downloads = [{ file: 'hall.png', decoded: true }], cwd = '/isolated/seat';
  const inventory = toolInventory([event('image', 'image_view', { path: '/isolated/seat/hall.png' })]);
  assert.deepEqual(auditImages({ inventory, downloads, cwd, arm: 'visual' }).errors, []);
  assert.deepEqual(auditImages({ inventory: toolInventory([event('i', 'image_view', { path: '/private/isolated/seat/hall.png' })]), downloads, cwd, canonicalCwd: '/private/isolated/seat', arm: 'visual' }).errors, []);
  assert.ok(auditImages({ inventory: { images: [] }, downloads, cwd, arm: 'visual' }).errors.length);
  assert.ok(auditImages({ inventory, downloads: [{ file: 'hall.png', decoded: false }], cwd, arm: 'visual' }).errors.length);
  assert.ok(auditImages({ inventory, downloads, cwd, arm: 'text' }).errors.length);
  assert.ok(auditImages({ inventory: toolInventory([event('i', 'image_view', { path: '/other/hall.png' })]), downloads, cwd, arm: 'visual' }).errors.length);
});
test('redaction preserves accounting and seat prompt omits fixture answers', () => {
  assert.deepEqual(redact({ token: 'secret', input_tokens: 10, usage: { output_tokens: 3 } }), { token: '[REDACTED]', input_tokens: 10, usage: { output_tokens: 3 } });
  assert.doesNotMatch(promptFor('visual'), /red square|blue circle|cream|e_f883/);
  assert.match(promptFor('visual'), /Images are optional/);
});
test('custody ignores repeated sampler ps/zombies and owns only observed Codex tree identities', () => {
  const binary = '/pinned/codex', start = 'Wed Oct 28 01:46:00 2026';
  const row = (pid, parent, executable, state = 'S', group = pid, stamp = start) => ({ pid, parent, group, state, start: stamp, executable });
  const harness = row(100, 1, 'node'), fixture = row(110, 100, 'node'), existingCodex = row(120, 100, binary);
  const tracker = createCustodyTracker({ rootPid: 100, codexBinary: binary, baselineRows: [harness, fixture, existingCodex] });
  const launcher = row(200, 100, 'node'), codex = row(201, 200, binary, 'S', 200), command = row(202, 201, 'node', 'S', 200);
  const sampled = [harness, fixture, existingCodex, row(111, 110, 'chrome'), launcher, codex, command,
    row(300, 100, '/bin/ps', 'R', 100), row(301, 100, '(ps) <defunct>', 'Z', 100), row(302, 100, 'node')];
  const first = tracker.update(sampled);
  assert.deepEqual(first.added.map(process => process.pid), [200, 201, 202]); assert.equal(first.sawCodex, true);
  assert.deepEqual(killTargets(first.live), [-200]);
  // Each registration launches another measurement ps: it must never feed a
  // new registration, even if its defunct form survives to the following scan.
  for (let i = 0; i < 20; i++) assert.equal(tracker.update([...sampled, row(400 + i, 100, i % 2 ? '/bin/ps' : '(ps)', i % 2 ? 'R' : 'Z')]).added.length, 0);
  const reusedLauncher = row(200, 1, 'unrelated', 'S', 200, 'Wed Oct 28 01:46:01 2026');
  const reparented = tracker.update([harness, fixture, existingCodex, reusedLauncher, { ...codex, parent: 1 }, { ...command, parent: 1 }]);
  assert.deepEqual(reparented.live.map(process => process.pid), [201, 202]); assert.deepEqual(killTargets(reparented.live), [201, 202]);
  assert.equal(tracker.update([harness, fixture, existingCodex, reusedLauncher, { ...codex, parent: 1, state: 'Z', executable: '(codex) <defunct>' }]).live.length, 0);
  const parsed = parseProcessRows(`301 100 100 Z ${start} (ps) <defunct>\n201 200 200 S ${start} ${binary}`);
  assert.equal(parsed[0].state, 'Z'); assert.equal(parsed[1].executable, binary);
});
