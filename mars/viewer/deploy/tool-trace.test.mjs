import test from 'node:test';
import assert from 'node:assert/strict';
import { traceClientTools } from './tool-trace.mjs';

test('optional tool tracing preserves results, arguments and receiver without disclosing payloads', async () => {
  const logs = [], request = { name: 'engine_query_world', arguments: { secret: 'do-not-log' } };
  const response = { isError: true, content: [{ text: 'private-response' }] };
  const client = { async callTool(r, option) { assert.equal(this, client); assert.equal(r, request); assert.equal(option, 3); return response; } };
  let clock = 10;
  traceClientTools(client, 'room', { enabled: true, write: (s) => logs.push(s), now: () => clock++ });
  assert.equal(await client.callTool(request, 3), response);
  assert.deepEqual(logs, ['MCP TRACE room #1 engine_query_world START', 'MCP TRACE room #1 engine_query_world END 1ms diagnostic']);
});

test('tool tracing identifies transport failure and preserves original error', async () => {
  const logs = [], error = new Error('private-error');
  const client = { async callTool() { throw error; } };
  traceClientTools(client, 'room', { enabled: true, write: (s) => logs.push(s), now: () => 0 });
  await assert.rejects(client.callTool({ name: 'engine_execute' }), (e) => e === error);
  assert.deepEqual(logs, ['MCP TRACE room #1 engine_execute START', 'MCP TRACE room #1 engine_execute TRANSPORT FAILURE 0ms']);
});

test('disabled tracing leaves client method untouched', () => {
  const client = { callTool: () => {} }, original = client.callTool;
  traceClientTools(client, 'room');
  assert.equal(client.callTool, original);
});
