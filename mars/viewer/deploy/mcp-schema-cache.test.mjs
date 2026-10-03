import test from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/server';
import { listedSchema } from '../simulation/engine-tools.ts';
import { controlTools, registerControlTools } from '../simulation/control.ts';

const target = { target: 'draft-2020-12' };

test('every complete tool schema matches uncached conversion in both directions and supported targets', () => {
  for (const tool of controlTools()) {
    const adapter = listedSchema(tool.inputSchema)['~standard'];
    for (const direction of ['input', 'output']) {
      for (const version of ['draft-2020-12', 'draft-07', 'openapi-3.0']) {
        const options = { target: version };
        const expected = tool.inputSchema['~standard'].jsonSchema[direction](options);
        const actual = adapter.jsonSchema[direction](options);
        assert.deepEqual(actual, expected, `${tool.name} ${direction} ${version}`);
        assert.deepEqual(adapter.jsonSchema[direction](options), expected);
        actual.properties = { corrupted: { type: 'null' } };
        assert.deepEqual(listedSchema(tool.inputSchema)['~standard'].jsonSchema[direction](options), expected);
      }
    }
  }
});

test('conversion runs once per schema, direction and target; returned nested trees are detached', () => {
  const calls = [];
  const source = { properties: { nested: { enum: ['safe'] } }, $defs: { child: { type: 'string' } } };
  const schema = { '~standard': { jsonSchema: Object.fromEntries(['input', 'output'].map((direction) => [direction, (options) => {
    calls.push([direction, options.target]);
    return source;
  }])) } };
  const first = listedSchema(schema)['~standard'].jsonSchema.input(target);
  first.properties.nested.enum.push('corrupted');
  first.$defs.child.type = 'null';
  source.properties.nested.enum.push('external-source-change');
  const again = listedSchema(schema)['~standard'].jsonSchema.input(target);
  assert.deepEqual(again.properties.nested.enum, ['safe']);
  assert.equal(again.$defs.child.type, 'string');
  assert.notEqual(first, again);
  const second = listedSchema(schema)['~standard'];
  second.jsonSchema.output(target);
  second.jsonSchema.output(target);
  second.jsonSchema.input({ target: 'draft-07' });
  second.jsonSchema.input({ target: 'draft-07' });
  assert.deepEqual(calls, [['input', 'draft-2020-12'], ['output', 'draft-2020-12'], ['input', 'draft-07']]);
  const other = { '~standard': schema['~standard'] };
  listedSchema(other)['~standard'].jsonSchema.input(target);
  assert.equal(calls.length, 4, 'distinct schema identities do not share conversions');
});

test('vendor conversion options and failed conversions retain uncached semantics', () => {
  let calls = 0;
  const schema = { '~standard': { jsonSchema: { input: (options) => {
    calls++;
    if (options.target === 'unsupported') throw new Error('unsupported target');
    return { title: options.libraryOptions?.title ?? 'default' };
  } } } };
  const input = listedSchema(schema)['~standard'].jsonSchema.input;
  assert.deepEqual(input(target), { title: 'default' });
  assert.deepEqual(input({ ...target, libraryOptions: { title: 'one' } }), { title: 'one' });
  assert.deepEqual(input({ ...target, libraryOptions: { title: 'two' } }), { title: 'two' });
  assert.deepEqual(input(target), { title: 'default' });
  for (let i = 0; i < 2; i++) assert.throws(() => input({ target: 'unsupported' }), /unsupported target/);
  assert.equal(calls, 5);
});

test('real SDK registrations publish complete schemas with separate server-owned results', async () => {
  const servers = [new McpServer({ name: 'schema-one', version: '1' }), new McpServer({ name: 'schema-two', version: '1' })];
  try {
    for (const server of servers) registerControlTools(server, {});
    for (const tool of controlTools()) {
      const expected = tool.inputSchema['~standard'].jsonSchema.input(target);
      const first = servers[0].toolInputSchemaJson(tool.name);
      assert.deepEqual(first, expected);
      first.properties = { corrupted: {} };
      assert.deepEqual(servers[1].toolInputSchemaJson(tool.name), expected);
    }
  } finally {
    for (const server of servers) await server.close();
  }
});

test('reused registry keeps request contexts separate and malformed arguments as named refusals', async () => {
  function register(id) {
    const tools = new Map(), calls = [];
    registerControlTools({ registerTool: (name, descriptor, callback) => tools.set(name, { descriptor, callback }) }, {
      engine: async (op, args) => {
        calls.push([op, args]);
        return args.bad ? { ok: false, code: 'op.invalid-input', message: `${id}: invalid arguments` } : { ok: true, context: id };
      },
      viewerCommand: async () => ({ context: id }), snapshot: async () => ({ context: id }), capabilities: () => ({ context: id }),
    });
    return { tools, calls };
  }
  const one = register('one'), two = register('two');
  const invoke = async (registration, name, args) => {
    const response = await registration.tools.get(name).callback(args);
    return { isError: response.isError === true, value: JSON.parse(response.content[0].text) };
  };
  for (const registration of [one, two]) {
    const malformed = { mode: 'banana' };
    assert.deepEqual(registration.tools.get('set_fire').descriptor.inputSchema['~standard'].validate(malformed), { value: malformed });
    const refused = await invoke(registration, 'set_fire', malformed);
    assert.equal(refused.isError, true);
    assert.equal(refused.value.code, 'legacy.command-failed');
  }
  assert.deepEqual(await invoke(one, 'engine_query_world', {}), { isError: false, value: { ok: true, context: 'one' } });
  assert.deepEqual(await invoke(two, 'engine_query_world', {}), { isError: false, value: { ok: true, context: 'two' } });
  assert.deepEqual(await invoke(one, 'engine_query_world', { bad: true }), { isError: true, value: { ok: false, code: 'op.invalid-input', message: 'one: invalid arguments' } });
  assert.equal(one.calls.length, 2);
  assert.equal(two.calls.length, 1);
  assert.equal((await invoke(one, 'get_state', {})).value.context, 'one');
  assert.equal((await invoke(two, 'get_state', {})).value.context, 'two');
});
