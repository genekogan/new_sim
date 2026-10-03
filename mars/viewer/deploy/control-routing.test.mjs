import test from 'node:test';
import assert from 'node:assert/strict';
import { controlTools, dispatchControl, registerControlTools } from '../simulation/control.ts';
import { engineTools } from '../engine/api/index.ts';
import { LEGACY_TOOLS } from '../simulation/legacy.ts';

function context() {
  const calls = [];
  return { calls, engine: async (op, args) => { calls.push(['engine', op, args]); return { ok: true, engine: true }; },
    viewerCommand: async (name, args, id) => { calls.push(['viewer', name, args, id]); return { state: { fire: 'on' } }; },
    snapshot: async () => ({ state: { live: true } }), capabilities: () => ({ version: 2 }) };
}
test('one transport registry contains exactly all engine and legacy tools, with explicit domains', () => {
  const tools = controlTools();
  assert.equal(new Set(tools.map((t) => t.name)).size, tools.length);
  assert.deepEqual(tools.filter((t) => t.target === 'engine').map((t) => t.name), engineTools().map((t) => t.name));
  assert.deepEqual(tools.filter((t) => t.target === 'viewer').map((t) => t.name).sort(), Object.keys(LEGACY_TOOLS).sort());
  assert.equal(tools.find((t) => t.name === 'get_state').readOnly, true);
  assert.equal(tools.find((t) => t.name === 'set_fire').readOnly, false);
  assert.ok(tools.find((t) => t.name === 'set_fire').description.includes('legacy viewer control'));
});

test('shared routing preserves viewer command ids and engine domain separation', async () => {
  const c = context();
  const legacy = await dispatchControl(c, 'set_fire', { mode: 'on' }, { viewerCommandsOnly: true, commandId: 'receipt' });
  assert.deepEqual(legacy, { isError: false, value: { state: { fire: 'on' } } });
  const engine = await dispatchControl(c, 'engine_query_world', { workspace: 'fork' });
  assert.equal(engine.value.engine, true);
  assert.deepEqual(c.calls, [['viewer', 'set_fire', { mode: 'on' }, 'receipt'], ['engine', 'query_world', { workspace: 'fork' }]]);
  assert.deepEqual((await dispatchControl(c, 'get_state', {})).value, { state: { live: true } });
  assert.deepEqual((await dispatchControl(c, 'get_capabilities', {})).value, { version: 2 });
  for (const name of ['engine_delete_workspace', 'get_state', '__proto__']) {
    const denied = await dispatchControl(c, name, {}, { viewerCommandsOnly: true });
    assert.equal(denied.value.code, 'legacy.command-failed');
  }
  assert.equal(c.calls.length, 2);
});

test('malformed arguments and backend failures share named JSON refusal envelopes', async () => {
  const c = context();
  const bad = await dispatchControl(c, 'set_fire', { mode: 'banana' });
  assert.equal(bad.isError, true);
  assert.equal(bad.value.code, 'legacy.command-failed');
  assert.equal(c.calls.length, 0);
  c.viewerCommand = async () => { throw new Error('route blocked'); };
  assert.match((await dispatchControl(c, 'move_person', { person_id: 'p', x: 1, z: 2 })).value.message, /route blocked/);
  c.snapshot = async () => { throw new Error('storage unavailable'); };
  assert.equal((await dispatchControl(c, 'get_state', {})).value.code, 'legacy.command-failed');
  c.engine = async () => ({ ok: false, code: 'op.invalid-input', message: 'bad schema' });
  assert.equal((await dispatchControl(c, 'engine_query_world', {})).value.code, 'op.invalid-input');
  c.engine = async () => { throw new Error('backend failed'); };
  assert.equal((await dispatchControl(c, 'engine_query_world', {})).value.code, 'engine.error');
});

test('MCP registration consumes the same dispatcher and leaves schema failures to JSON handling', async () => {
  const registrations = new Map();
  const c = context();
  registerControlTools({ registerTool: (name, descriptor, callback) => registrations.set(name, { descriptor, callback }) }, c);
  assert.equal(registrations.size, controlTools().length);
  const fire = registrations.get('set_fire');
  const malformed = { mode: 'banana' };
  assert.deepEqual(fire.descriptor.inputSchema['~standard'].validate(malformed), { value: malformed });
  const output = await fire.callback(malformed);
  assert.equal(output.isError, true);
  assert.equal(JSON.parse(output.content[0].text).code, 'legacy.command-failed');
  const result = await registrations.get('engine_query_world').callback({ workspace: 'fork' });
  assert.equal(JSON.parse(result.content[0].text).engine, true);
  assert.deepEqual(c.calls, [['engine', 'query_world', { workspace: 'fork' }]]);
});
