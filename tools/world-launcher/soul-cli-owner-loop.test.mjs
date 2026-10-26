// D3 (playtest 2026-10-25): eden.mjs 2.1 links an act to the owner message it serves (--for; by default the newest one
// acked in this folder), prints one top-level `now`/`done` sentence (<= 600 chars; --json prints everything), and drops
// a default link the world no longer knows. D3b (2.2.1, cloud fix-r3 trio tam-003): the default serves only the first
// act the world accepts after the ack, within 120 s of it; an unfinished receipt prints `done: false` beside `now`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {mkdtempSync, writeFileSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {brief} from './soul/eden.mjs';

const CLI = fileURLToPath(new URL('./soul/eden.mjs', import.meta.url));

test('brief: done when the receipt ended, now while it runs; at most 600 characters', () => {
  const run = brief({accepted: true, receipt: {id: 'r_1', capability: 'sit:here', phase: 'started', now: 'walking to the bench, 18 m left; not sitting yet'}, resolved: {from: 'sit down', to: 'sit:here', note: 'x'.repeat(900)}});
  assert.equal(run.now, 'walking to the bench, 18 m left; not sitting yet'); assert.equal(run.done, false, 'an unfinished receipt says done: false'); assert.equal(run.resolved, 'sit:here');
  const end = brief({waited: '3s', receipt: {id: 'r_1', capability: 'sit:here', phase: 'completed', outcome: {summary: 'sit completed at commons.'}}, events: [{kind: 'receipt'}]});
  assert.equal(end.done, 'sit completed at commons.'); assert.equal(end.now, undefined);
  const long = brief({receipt: {id: 'r_2', capability: 'walk:x', phase: 'failed', reason: 'r'.repeat(2000)}, events: Array.from({length: 9}, () => ({text: 'e'.repeat(200)}))});
  assert.ok(JSON.stringify(long).length <= 601, String(JSON.stringify(long).length)); assert.match(long.done, /^walk:x failed: r+…$/);
});

test('act --for: by default the first accepted act within 120 s of an ack serves it; an explicit id, none, and a stale default dropped', async t => {
  const seen = [];
  const server = createServer((req, res) => {
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      const body = b ? JSON.parse(b) : null; seen.push({path: req.url, body});
      const reply = (status, data) => {res.writeHead(status, {'content-type': 'application/json'}); res.end(JSON.stringify(data));};
      if (req.url.includes('/ack')) return reply(200, {inbox: {}});
      if (req.url === '/v1/edge/act') {
        if (body.for === 'm_gone') return reply(400, {error: {code: 'invalid', message: 'no owner message m_gone for this Soul (it may be too old)'}});
        if (body.capability === 'fly') return reply(200, {accepted: false, code: 'capability.unknown', reason: 'no fly here'});
        return reply(200, {accepted: true, channel: 'body', receipt: {id: 'r_9', capability: 'wave:here', phase: 'started', now: 'waving'}, ...(body.for ? {for: body.for} : {})});
      }
      reply(404, {error: {code: 'not-found', message: req.url}});
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const dir = mkdtempSync(join(tmpdir(), 'eden-cli-for-'));
  writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({world: `http://127.0.0.1:${server.address().port}`, token: 'tok'}));
  const cli = (...args) => new Promise((res, rej) => execFile(process.execPath, [CLI, ...args], {cwd: dir}, (e, out, err) => e ? rej(new Error(err || e.message)) : res(JSON.parse(out))));
  const acts = () => seen.filter(x => x.path === '/v1/edge/act').map(x => x.body.for ?? null);
  const state = () => JSON.parse(readFileSync(join(dir, '.eden-agent.json'), 'utf8'));
  const setState = patch => writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({...state(), ...patch}));
  assert.equal((await cli('act', 'wave')).for, undefined, 'nothing acked yet: no link');
  await cli('ack', 'm_1', 'Will try a wave');
  assert.equal((await cli('act', 'fly')).accepted, false, 'a refused act links nothing');
  const linked = await cli('act', 'wave');
  assert.equal(linked.for, 'm_1', 'the first accepted act after the ack serves it'); assert.equal(linked.now, 'waving'); assert.equal(linked.done, false); assert.equal(linked.receipt.phase, 'started');
  assert.equal((await cli('act', 'wave')).for, undefined, 'a second act does not serve the acked message by default');
  assert.equal((await cli('act', 'wave', '--for', 'm_1')).for, 'm_1', 'explicit --for still links it');
  assert.equal((await cli('act', 'wave', '--for', 'm_7')).for, 'm_7');
  await cli('ack', 'm_2');
  assert.equal((await cli('act', 'wave', '--for', 'none')).for, undefined, '--for none links nothing');
  assert.equal((await cli('act', 'wave')).for, undefined, '--for none was the first act after the ack');
  await cli('ack', 'm_3');
  const full = await cli('act', 'wave', '--json'); assert.equal(full.channel, 'body', '--json prints everything'); assert.equal(full.for, 'm_3');
  await cli('ack', 'm_4'); setState({lastAckedAt: new Date(Date.now() - 121_000).toISOString()});
  assert.equal((await cli('act', 'wave')).for, undefined, 'more than 120 s after the ack: no default link');
  assert.deepEqual(acts(), [null, 'm_1', 'm_1', null, 'm_1', 'm_7', null, null, 'm_3', null]);
  await cli('ack', 'm_5'); setState({lastAcked: 'm_gone'});
  const retried = await cli('act', 'wave'); assert.equal(retried.accepted, true); assert.equal(retried.for, undefined, 'a default the world no longer knows is dropped and the act sent plainly');
  assert.equal(state().lastAcked, undefined);
});
