// Kill real CLI subprocesses after a loopback stub accepts each operation; the next CLI must recover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const env = { ...process.env, EDEN_GOD_NO_NPX: '1' }; delete env.NODE_USE_SYSTEM_CA; delete env.EDEN_GOD_CLAIM;
const command = (cwd, args) => {
  const child = spawn(process.execPath, [cli, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  const done = once(child, 'exit').then(([code]) => ({ code, output })); return { child, done };
};
for (const stage of ['verify', 'batch', 'claim', 'done']) test(`kill-anywhere: real CLI mid-${stage}, next command recovers`, { timeout: 10_000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'eden-drill-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  let admitted, first = true, clientRef, n = 0; const barrier = new Promise(resolve => { admitted = resolve; });
  const b = { id: 'church', title: 'Church', status: 'active', site: { at: [0, 0], size: [30, 30] }, plan: { steps: ['shell', 'roof'] }, step: { n: 1, label: 'shell' }, claims: [], massing: [], roots: [], lead: { live: false }, current: null };
  const server = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : {}; n++;
    if (req.method === 'POST' && first) { first = false; clientRef = body.clientRef; if (stage === 'done') b.status = 'done'; if (stage === 'claim') b.claims.push({ id: 'c_12345678', part: 'roof', status: 'held' }); admitted(); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url.includes('/requests/') ? { result: { accepted: true, seq: 1 } } : req.url.includes('/verify-use') ? { ok: true, uses: [], probe: { created: true, removed: true }, ms: 1 } : { ok: true, build: b }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  writeFileSync(join(dir, '.eden-god.json'), JSON.stringify({ world: `http://127.0.0.1:${server.address().port}`, token: 'fake-drill', build: { id: 'church', lease: 'l_12345678', n: 1, label: 'shell', steps: ['shell', 'roof'] } }));
  const args = stage === 'verify' ? ['verify-use', 'church', '--json'] : stage === 'batch' ? ['act', JSON.stringify({ ops: [{ op: 'world', state: { constitution: 'x' } }] }), '--json'] : stage === 'claim' ? ['build', 'claim', 'roof', '--at', '0,0', '--size', '5,5', '--json'] : ['build', 'done', '--json'];
  const killed = command(dir, args); t.after(() => killed.child.kill('SIGKILL'));
  await Promise.race([barrier, killed.done.then(r => { throw Error(`CLI exited before ${stage}: ${r.output}`); })]);
  killed.child.kill('SIGKILL'); await killed.done;
  const start = Date.now();
  const nextArgs = stage === 'verify' ? ['verify-use', 'church', '--json'] : stage === 'batch' ? ['request', clientRef, '--json'] : ['build', 'show', 'church', '--json'];
  const next = command(dir, nextArgs); t.after(() => next.child.kill('SIGKILL'));
  const recovered = await next.done;
  assert.equal(recovered.code, 0, recovered.output); assert.ok(Date.now() - start < 60_000); assert.ok(n >= 2);
  if (stage === 'batch') assert.match(recovered.output, /accepted.*true/s);
  if (stage === 'done') assert.match(recovered.output, /"status": "done"/);
  if (stage === 'claim') assert.match(recovered.output, /c_12345678/);
});
test('kill-anywhere: actual shoot dies after acquiring Chrome, next look reclaims', { timeout: 10_000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'eden-look-drill-')), path = join(dir, 'chrome'); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const lookUrl = new URL('./lib/look.mjs', import.meta.url).href, leaseUrl = new URL('./lib/chrome-lease.mjs', import.meta.url).href;
  const script = `import {shoot} from ${JSON.stringify(lookUrl)}; import {chromeLease} from ${JSON.stringify(leaseUrl)}; await shoot({worldUrl:'http://127.0.0.1:5366',eye:[1,1,1],at:[0,0,0],out:${JSON.stringify(join(dir, 'shot.png'))}}, {lease:()=>chromeLease('drill',{leaseDir:${JSON.stringify(path)}}),pw:{chromium:{launch:()=>{console.log('held');return new Promise(()=>{});}}}});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL')); const exited = once(child, 'exit'); await once(child.stdout, 'data'); child.kill('SIGKILL'); await exited;
  const { chromeLease } = await import('./lib/chrome-lease.mjs'); const start = Date.now(), release = await chromeLease('next look', { leaseDir: path, waitMs: 500 });
  release(); assert.ok(Date.now() - start < 1000);
});
