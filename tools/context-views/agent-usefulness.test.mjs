import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSeatCall } from './agent-usefulness-cli.mjs';
import { rawUsage, toolInventory, redact, promptFor, USEFULNESS_PROTOCOL as P } from './agent-usefulness-protocol.mjs';
import { auditCommands, auditImages } from './agent-usefulness.mjs';
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
