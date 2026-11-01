// 2.5.1 (L3 paged listings): a plain `caps` shows the world's page and says how many offers it left out
// (notListed/note); `caps --search`, `--verb` and `--all` read the whole menu with ?all=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const CLI = fileURLToPath(new URL('./soul/eden.mjs', import.meta.url));
const near = {id: 'sit:bench', verb: 'sit', label: 'Sit on the bench', available: true};
const far = {id: 'walk:far-pier', verb: 'walk', label: 'Walk to the far pier', available: true};

test('plain caps lists the page with notListed; search, verb and all read the whole menu', async (t) => {
  const seen = [], dir = mkdtempSync(join(tmpdir(), 'capspage-'));
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); seen.push(u.pathname + u.search);
    res.writeHead(200, {'content-type': 'application/json'});
    if (u.pathname !== '/v1/edge/capabilities') return res.end('{}');
    res.end(JSON.stringify(u.searchParams.get('all') === '1' ? {tick: 1, capabilities: [near, far]}
      : {tick: 1, capabilities: [near], omitted: {count: 1, byVerb: {walk: 1}, note: 'farther offers still work by id or in words'}}));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => {server.closeAllConnections(); await new Promise(r => server.close(r)); rmSync(dir, {recursive: true, force: true});});
  writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({world: 'http://127.0.0.1:' + server.address().port, soul: 's_pip', token: 'sim_fixture'}));
  const run = (args) => new Promise((resolve, reject) => execFile(process.execPath, [CLI, ...args], {cwd: dir}, (err, out, e) => err ? reject(new Error(e)) : resolve(JSON.parse(out))));

  const page = await run(['caps']);
  assert.equal(seen.at(-1), '/v1/edge/capabilities');
  assert.deepEqual(page.offers.map(o => o.id), ['sit:bench']);
  assert.equal(page.notListed, 1); assert.match(page.note, /farther/);

  const found = await run(['caps', '--search', 'far pier']);
  assert.equal(seen.at(-1), '/v1/edge/capabilities?all=1');
  assert.equal(found.offers[0].id, 'walk:far-pier'); assert.equal(found.notListed, undefined, 'the whole menu leaves nothing out');

  await run(['caps', '--verb', 'walk']); assert.equal(seen.at(-1), '/v1/edge/capabilities?all=1');
  await run(['caps', '--all']); assert.equal(seen.at(-1), '/v1/edge/capabilities?all=1');
});
