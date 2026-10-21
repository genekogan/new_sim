#!/usr/bin/env node
// Lane MSG (Gene 2026-10-20: "the soul should simply begin monitoring its inbox no matter what and always do that ...
// and it should always work through its backlog"). The downloaded Soul CLI (1.9.5) against a fresh fake dev world, driven
// the way a Claude Code agent drives it: `listen` runs as a background process that exits when the owner writes; the
// "agent" acks, posts a result, and starts listen again. No model calls. Every fetch the CLI makes is counted.
//   node tools/test-harness/soul-listen-walk.mjs [outDir] [port 6750-6759] [--idle-minutes N]
// --idle-minutes N (default 0): also leave one listen waiting N real minutes, sampling presence each minute, and count
// its requests and memory (the idle cost of the pattern).
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {mkdirSync, rmSync, writeFileSync, readFileSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {startWorld} from '../god-skill/dev-world.mjs';

const root = resolve(new URL('../..', import.meta.url).pathname);
const args = process.argv.slice(2), flag = k => { const i = args.indexOf(`--${k}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const idleMinutes = Number(flag('idle-minutes') ?? 0);
const out = resolve(args[0] ?? '<team>/scratch/t4/msg/walk');
const port = Number(args[1] ?? 6750);
if (!Number.isInteger(port) || port < 6750 || port > 6759) throw Error('lane MSG owns ports 6750–6759 only');
mkdirSync(out, {recursive: true});
process.env.EDGE_CLI_FILE = resolve(root, 'tools/world-launcher/soul/eden-agent.mjs');
process.env.EDGE_SKILL_FILE = resolve(root, 'tools/world-launcher/soul/skill.md');
const owned = new Set(), sleep = ms => new Promise(r => setTimeout(r, ms));
process.on('exit', () => { for (const child of owned) child.kill('SIGTERM'); });
const report = {startedAt: new Date().toISOString(), status: 'running', idleMinutes, scenarios: {}};
const save = () => writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const world = await startWorld({slug: 'soul-listen', port, data: resolve(out, 'data'), fresh: true, log: resolve(out, 'server.log')});
owned.add(world.child);
try {
  const {base} = world;
  const api = async (path, body, token = 'dev:admin') => {
    const r = await fetch(base + path, {method: body === undefined ? 'GET' : 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${token}`}, ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(30_000)});
    const data = await r.json(); assert.equal(r.status, 200, `${path}: ${r.status} ${JSON.stringify(data).slice(0, 200)}`); return data;
  };
  const soul = (await api('/v1/souls', {name: 'Ana', description: 'A thoughtful resident of this small world.'})).soul;
  const pair = await api(`/v1/souls/${soul.id}/pair`, {});
  const token = (await (await fetch(base + '/v1/agent/pair', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({code: pair.code, agent: 'soul listen walk'})})).json()).token;
  assert.ok(token);
  // Fresh local fixture credential for the child CLI only; removed at the end.
  const dir = resolve(out, 'soul-cli'); rmSync(dir, {recursive: true, force: true}); mkdirSync(dir);
  writeFileSync(resolve(dir, '.eden-agent.json'), JSON.stringify({world: base, token, soul: soul.id, mode: 'edge'}), {mode: 0o600});
  const download = await fetch(base + '/eden-agent.mjs'); assert.equal(download.status, 200);
  const cliText = await download.text(); writeFileSync(resolve(dir, 'eden-agent.mjs'), cliText);
  const fetchLog = resolve(out, 'fetches.jsonl'); rmSync(fetchLog, {force: true});
  // Count every request the CLI makes (path and time only).
  writeFileSync(resolve(dir, 'count-fetch.mjs'), `import {appendFileSync} from 'node:fs';const f=globalThis.fetch;globalThis.fetch=(u,o)=>{appendFileSync(${JSON.stringify(fetchLog)},JSON.stringify({t:Date.now(),pid:process.pid,path:String(u).replace(/^https?:\\/\\/[^/]+\\/w\\/[^/]+/,'')})+'\\n');const t=Date.now(),p=f(u,o);p.then(r=>appendFileSync(${JSON.stringify(fetchLog + '.status')},JSON.stringify({t,ms:Date.now()-t,pid:process.pid,status:r.status})+'\\n'),e=>appendFileSync(${JSON.stringify(fetchLog + '.status')},JSON.stringify({t,ms:Date.now()-t,pid:process.pid,error:String(e?.cause?.code??e)})+'\\n'));return p;};\n`);
  const env = {...process.env, NODE_OPTIONS: `--import=${resolve(dir, 'count-fetch.mjs')}`};
  const run = (cliArgs) => new Promise((ok, fail) => {
    const child = spawn(process.execPath, ['eden-agent.mjs', ...cliArgs], {cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe']}); owned.add(child);
    let stdout = '', stderr = ''; child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
    child.on('error', fail); child.on('exit', code => { owned.delete(child); ok({code, stdout, stderr, exitAt: Date.now(), pid: child.pid}); });
  });
  const version = JSON.parse((await run(['version'])).stdout); assert.equal(version.skillVersion, '1.9.5');
  const box = async () => (await api(`/v1/edge/owner/${soul.id}/inbox`)).inbox;
  const send = async text => { const at = Date.now(), r = await api(`/v1/edge/owner/${soul.id}/inbox`, {text}); return {id: r.inbox.latest.id, at}; };
  const untilListening = async () => { const t0 = Date.now(); for (let i = 0; i < 200; i++) { if ((await box()).presence === 'listening') return Date.now() - t0; await sleep(50); } throw Error('listen never showed as listening'); };
  /** The agent's turn: ack at once, then the result, exactly as the skill says. */
  const handle = async messages => { for (const m of messages) { assert.equal((await run(['ack', m.id, `Got it: ${m.text.slice(0, 40)}`])).code, 0); assert.equal((await run(['result', m.id, 'done', `Done: ${m.text.slice(0, 40)}`])).code, 0); } };
  const secretFree = text => { assert.doesNotMatch(text, new RegExp(token.slice(4, 20))); assert.doesNotMatch(text, /"token"|secret|authorization/i); };

  // S1: one web message while listen waits reaches the agent in < 5 s; the card shows listening, then reply and result.
  {
    const listening = run(['listen']); const toListening = await untilListening();
    const sent = await send('go find the horses'); const r = await listening;
    assert.equal(r.code, 0, r.stderr); secretFree(r.stdout); const got = JSON.parse(r.stdout);
    assert.deepEqual(got.messages.map(m => m.text), ['go find the horses']); assert.match(got.next, /listen again/);
    const ms = r.exitAt - sent.at; assert.ok(ms < 5000, `delivery ${ms} ms`);
    await handle(got.messages);
    const b = await box(); assert.equal(b.latest.reply, 'Got it: go find the horses'); assert.equal(b.latest.result, 'Done: go find the horses'); assert.equal(b.queued, 0);
    report.scenarios.S1 = {toListeningMs: toListening, deliveryMs: ms, emittedAt: got.messages[0].emittedAt, stdoutBytes: r.stdout.length}; save();
  }
  // S2: three in a row, each answered and re-armed at once (the Claude Code loop).
  {
    const rows = [];
    for (const text of ['hello?', 'run!', 'sit down on the grass']) {
      const listening = run(['listen']); await untilListening();
      const sent = await send(text), r = await listening, got = JSON.parse(r.stdout);
      assert.deepEqual(got.messages.map(m => m.text), [text]);
      await handle(got.messages); const acked = Date.now();
      rows.push({text, deliveryMs: r.exitAt - sent.at, answeredMs: acked - sent.at});
    }
    assert.ok(rows.every(x => x.deliveryMs < 5000)); report.scenarios.S2 = rows; save();
  }
  // S3: the agent is away; five messages wait (none overwritten); the card says so; the next listen prints all, oldest first.
  {
    const texts = ['go find the house', 'go to it', 'run there', 'the house!!!!', 'NOT THE TELESCOPE'];
    for (const t of texts) { await send(t); await sleep(30); }
    const waiting = await box(); assert.equal(waiting.queued, 5); assert.equal(waiting.latest.text, 'NOT THE TELESCOPE'); assert.equal(waiting.latest.state, 'sent'); assert.notEqual(waiting.presence, 'listening');
    const t0 = Date.now(), r = await run(['listen']), got = JSON.parse(r.stdout);
    assert.deepEqual(got.messages.map(m => m.text), texts, 'the whole backlog, oldest first'); assert.equal(got.waiting, 5);
    const picked = await box(); assert.equal(picked.latest.state, 'delivered'); assert.equal(picked.queued, 5);
    await handle(got.messages); assert.equal((await box()).queued, 0);
    report.scenarios.S3 = {backlog: 5, listenReturnedMs: r.exitAt - t0, cardWhileAway: {queued: waiting.queued, presence: waiting.presence}}; save();
  }
  // S4: a long wait (simulated clock): 1 s long-polls for 75 s = more than 60 empty polls, the count a 50 s poll makes
  // in 50 minutes, so past any 30-minute monitor limit; it is still waiting, then delivers in < 5 s.
  {
    const before = existsSync(fetchLog) ? readFileSync(fetchLog, 'utf8').trim().split('\n').length : 0;
    const listening = run(['listen', '--timeout', '1']); let exited = false; listening.then(() => { exited = true; });
    await sleep(75_000); assert.equal(exited, false, 'listen does not give up'); assert.equal((await box()).presence, 'listening');
    const sent = await send('still there?'), r = await listening, got = JSON.parse(r.stdout);
    assert.deepEqual(got.messages.map(m => m.text), ['still there?']); await handle(got.messages);
    const polls = readFileSync(fetchLog, 'utf8').trim().split('\n').slice(before).map(l => JSON.parse(l)).filter(x => x.path.startsWith('/v1/edge/inbox/listen')).length;
    assert.ok(polls >= 60, `${polls} polls`); report.scenarios.S4 = {emptyPolls: polls - 1, deliveryMs: r.exitAt - sent.at}; save();
  }
  // S5: one consumer. Other authenticated commands running beside a waiting listen do not take its message.
  {
    const listening = run(['listen']); await untilListening();
    const busy = [run(['here']), run(['observe'])];
    const sent = await send('can you ride the horse?'); await Promise.all(busy);
    const r = await listening, got = JSON.parse(r.stdout); assert.deepEqual(got.messages.map(m => m.text), ['can you ride the horse?']);
    report.scenarios.S5 = {deliveryMs: r.exitAt - sent.at, otherCommandsSawNotice: (await Promise.all(busy)).some(x => /OWNER MESSAGE/.test(x.stderr))};
    await handle(got.messages); save();
  }
  // S6 (opt-in): real idle. One listen waits N real minutes; presence sampled each minute; requests and memory counted.
  if (idleMinutes > 0) {
    const before = readFileSync(fetchLog, 'utf8').trim().split('\n').length, t0 = Date.now();
    const listening = run(['listen']); let early = null; listening.then(r => { early = r; }); await untilListening(); const samples = [];
    const pid = () => { const out = execFileSync('pgrep', ['-f', `eden-agent.mjs listen$`], {encoding: 'utf8'}).trim().split('\n')[0]; return Number(out); };
    for (let m = 1; m <= idleMinutes; m++) {
      await sleep(60_000); const b = await box(); let rssKb = null; try { rssKb = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid())], {encoding: 'utf8'}).trim()); } catch {}
      samples.push({minute: m, presence: b.presence, rssKb}); report.scenarios.S6 = {samples}; save();
      if (early) { report.scenarios.S6 = {samples, listenExitedEarly: {minute: m, code: early.code, stdout: early.stdout.slice(0, 500), stderr: early.stderr.slice(-1500), exitAt: new Date(early.exitAt).toISOString()}}; save(); throw Error(`listen exited during the idle wait (code ${early.code}): ${early.stderr.slice(-300)}`); }
    }
    const sent = await send('are you still listening after all this time?'), r = await listening, got = JSON.parse(r.stdout);
    assert.deepEqual(got.messages.map(m => m.text), ['are you still listening after all this time?']); await handle(got.messages);
    const lines = readFileSync(fetchLog, 'utf8').trim().split('\n').slice(before).map(l => JSON.parse(l)).filter(x => x.t <= r.exitAt && x.path.startsWith('/v1/edge/inbox/listen'));
    const hours = (r.exitAt - t0) / 3_600_000;
    assert.ok(samples.every(s => s.presence === 'listening'), 'listening the whole time');
    report.scenarios.S6 = {samples, minutes: (r.exitAt - t0) / 60_000, listenRequests: lines.length, requestsPerHour: Math.round(lines.length / hours), deliveryMs: r.exitAt - sent.at, modelTokensWhileIdle: 0, maxRssKb: Math.max(...samples.map(s => s.rssKb ?? 0))};
    save();
  }
  report.status = 'pass';
} catch (e) { report.status = 'fail'; report.error = String(e?.stack ?? e); throw e; }
finally {
  report.finishedAt = new Date().toISOString(); save();
  rmSync(resolve(out, 'soul-cli', '.eden-agent.json'), {force: true});
  for (const child of owned) child.kill('SIGTERM');
  console.log(JSON.stringify({status: report.status, report: resolve(out, 'report.json')}));
}
