#!/usr/bin/env node
// Scripted listening agent (no LLM): the downloaded god and Soul CLIs each keep ONE
// `listen --follow` running, and a tiny loop acks every JSON line it prints, the way
// a Claude Code background Monitor would. The owner sends several notes per box;
// each must reach `acknowledged` within 10 s with no listener restart.
//   node tools/test-harness/inbox-follow-walk.mjs [outDir] [port 5960-5968]
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {startWorld} from '../god-skill/dev-world.mjs';

const root = resolve(new URL('../..', import.meta.url).pathname);
const out = resolve(process.argv[2] ?? '<team>/scratch/inbox/follow');
const port = Number(process.argv[3] ?? 5962);
if (!Number.isInteger(port) || port < 5960 || port > 5968) throw Error('This lane owns ports 5960–5969 only');
mkdirSync(out, {recursive: true});
process.env.EDGE_CLI_FILE = resolve(root, 'tools/world-launcher/soul/eden-agent.mjs');
process.env.EDGE_SKILL_FILE = resolve(root, 'tools/world-launcher/soul/skill.md');
const owned = new Set();
const stop = async child => { if (!child || child.exitCode !== null || child.signalCode) return; const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; owned.delete(child); };
process.on('exit', () => { for (const child of owned) child.kill('SIGTERM'); });
const report = {startedAt: new Date().toISOString(), status: 'running', boxes: {}};
const world = await startWorld({slug: 'inbox-follow', port, data: resolve(out, 'data'), fresh: true, log: resolve(out, 'server.log')});
owned.add(world.child);
try {
  const {base} = world;
  const api = async (path, token = 'dev:admin', body) => {
    const r = await fetch(base + path, {method: body === undefined ? 'GET' : 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${token}`}, ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(10000)});
    const data = await r.json(); assert.equal(r.status, 200, `${path}: ${r.status} ${JSON.stringify(data).slice(0, 200)}`); return data;
  };
  await api('/v1/god/claim', 'dev:admin', {});
  const god = (await api('/v1/god/mint', 'dev:admin', {label: 'inbox follow listener'})).token;
  const soul = (await api('/v1/souls', 'dev:admin', {name: 'Ana', description: 'A thoughtful resident of this small world.'})).soul;
  const pair = await api(`/v1/souls/${soul.id}/pair`, 'dev:admin', {});
  const soulToken = (await (await fetch(base + '/v1/agent/pair', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({code: pair.code, agent: 'inbox follow listener'})})).json()).token;
  assert.ok(god && soulToken);
  // Fresh local fixture credentials, written for the child CLIs only and removed after.
  const godDir = resolve(out, 'god-cli'), soulDir = resolve(out, 'soul-cli');
  for (const d of [godDir, soulDir]) { rmSync(d, {recursive: true, force: true}); mkdirSync(d); }
  writeFileSync(resolve(godDir, '.eden-god.json'), JSON.stringify({world: base, token: god}), {mode: 0o600});
  writeFileSync(resolve(soulDir, '.eden-agent.json'), JSON.stringify({world: base, token: soulToken, soul: soul.id, mode: 'edge'}), {mode: 0o600});
  for (const [dir, name, route] of [[godDir, 'eden-god.mjs', '/god/eden-god.mjs'], [soulDir, 'eden-agent.mjs', '/eden-agent.mjs']]) {
    const download = await fetch(base + route); assert.equal(download.status, 200);
    const text = await download.text(); assert.match(text, /--follow/, `${route} must ship listen --follow`);
    writeFileSync(resolve(dir, name), text);
  }
  for (const [kind, dir, cli, ownerPath] of [['god', godDir, 'eden-god.mjs', '/v1/god/inbox'], ['soul', soulDir, 'eden-agent.mjs', `/v1/edge/owner/${soul.id}/inbox`]]) {
    const box = report.boxes[kind] = {acks: [], listenerStarts: 1, lines: 0};
    const listener = spawn(process.execPath, [cli, 'listen', '--follow'], {cwd: dir, stdio: ['ignore', 'pipe', 'pipe']});
    owned.add(listener); let stderr = ''; listener.stderr.on('data', d => stderr += d);
    // The "agent": every JSON line is one owner note; read it, ack with a short reply.
    createInterface({input: listener.stdout}).on('line', line => {
      box.lines++; const m = JSON.parse(line);
      const ack = spawn(process.execPath, [cli, 'ack', m.id, `On it: ${m.text.slice(0, 40)}`], {cwd: dir, stdio: 'ignore'}); owned.add(ack); ack.on('exit', () => owned.delete(ack));
    });
    // Presence is honest: the listener's own long-poll is what marks the agent connected.
    const started = Date.now(); let connected = false;
    while (!connected && Date.now() - started < 5000 && listener.exitCode === null) { connected = (await api(ownerPath)).inbox.connected; if (!connected) await new Promise(r => setTimeout(r, 100)); }
    assert.ok(connected, `${kind}: a running listener counts as connected (exit ${listener.exitCode}): ${stderr.slice(0, 400)}`);
    box.connectedMs = Date.now() - started;
    for (let i = 1; i <= 3; i++) {
      const at = Date.now(); const text = `Note ${i} for the ${kind} agent.`;
      await api(ownerPath, 'dev:admin', {text});
      let state;
      while (Date.now() - at < 10000) { const m = (await api(ownerPath)).inbox.latest; state = m.state; if (state === 'acknowledged') { assert.equal(m.text, text); assert.match(m.reply, /^On it: Note/); break; } await new Promise(r => setTimeout(r, 50)); }
      assert.equal(state, 'acknowledged', `${kind} note ${i} not acknowledged within 10 s: ${stderr.slice(0, 300)}`);
      box.acks.push(Date.now() - at);
      assert.equal(listener.exitCode, null, `${kind} listener exited`);
    }
    assert.equal(box.lines, 3, `${kind}: exactly one line per note`);
    await stop(listener);
    console.log(JSON.stringify({kind, ackMs: box.acks, lines: box.lines}));
  }
  report.status = 'pass';
} catch (e) { report.status = 'fail'; report.error = e.stack; throw e; }
finally {
  for (const child of owned) await stop(child).catch(() => {});
  rmSync(resolve(out, 'data'), {recursive: true, force: true}); rmSync(resolve(out, 'god-cli'), {recursive: true, force: true}); rmSync(resolve(out, 'soul-cli'), {recursive: true, force: true});
  report.endedAt = new Date().toISOString(); writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
}
