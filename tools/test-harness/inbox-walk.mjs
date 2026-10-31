#!/usr/bin/env node
// Fresh, fake dev worlds only. Real Chrome/input, both owner boxes at DPR 1/2,
// and a scripted background CLI listener/ack loop (no model calls).
// node tools/test-harness/inbox-walk.mjs <absolute-output-dir> [port=5960]
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {startWorld} from '../god-skill/dev-world.mjs';
import {chromeLease} from '../god-skill/lib/chrome-lease.mjs';
import { scratchDir } from '../lib/paths.mjs';

const root = resolve(new URL('../..', import.meta.url).pathname);
const out = resolve(process.argv[2] ?? scratchDir('inbox/browser'));
const port = Number(process.argv[3] ?? 5960);
if (!Number.isInteger(port) || port < 5960 || port > 5968) throw Error('This lane owns ports 5960–5969 only');
mkdirSync(out, {recursive: true});
const {chromium} = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test');
process.env.EDGE_CLI_FILE = resolve(root, 'tools/world-launcher/soul/eden-agent.mjs');
process.env.EDGE_SKILL_FILE = resolve(root, 'tools/world-launcher/soul/skill.md');
const report = {startedAt: new Date().toISOString(), status: 'running', runs: []};
const running = new Set();
let browser;
const stop = async child => {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit'); child.kill('SIGTERM');
  await Promise.race([exited, new Promise((_, reject) => {const t = setTimeout(() => reject(Error('Owned process did not close')), 15000); t.unref();})]);
  running.delete(child);
};
process.on('exit', () => {for (const child of running) child.kill('SIGTERM');});
const release = await chromeLease('inbox');
try {
  browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist']});
  for (const dpr of [1, 2]) {
    const runDir = resolve(out, `dpr${dpr}`); mkdirSync(runDir, {recursive: true});
    const slug = `inbox-proof-${dpr}`;
    const world = await startWorld({slug, port: port + dpr - 1, data: resolve(runDir, 'data'), fresh: true, log: resolve(runDir, 'server.log')});
    running.add(world.child);
    const {base} = world;
    const api = async (path, token = 'dev:admin', body) => {
      const r = await fetch(base + path, {method: body === undefined ? 'GET' : 'POST', headers: {'content-type': 'application/json', ...(token ? {authorization: `Bearer ${token}`} : {})}, ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(10000)});
      const data = await r.json(); assert.equal(r.status, 200, `${path}: ${r.status} ${data.message ?? data.error?.message ?? ''}`); return data;
    };
    const context = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: dpr, permissions: ['clipboard-read', 'clipboard-write']});
    await context.addInitScript(() => {localStorage.setItem('sim.dev', 'admin'); localStorage.setItem('sim.godPanel.open', '0');});
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const run = {dpr, base, screenshots: [], states: [], listenerMs: {}, errors}; report.runs.push(run);
    try {
      await api('/v1/god/claim', 'dev:admin', {});
      const god = (await api('/v1/god/mint', 'dev:admin', {label: 'inbox scripted listener'})).token;
      const soul = (await api('/v1/souls', 'dev:admin', {name: 'Ana', description: 'A thoughtful resident of this small world.'})).soul;
      assert.ok(soul?.id);
      const pair = await api(`/v1/souls/${soul.id}/pair`, 'dev:admin', {});
      const soulToken = (await api('/v1/agent/pair', null, {code: pair.code, agent: 'inbox scripted listener'})).token;
      assert.ok(god && soulToken);
      // Test credentials are minted in this fresh local fixture, used only by
      // child CLIs at runtime, and removed without ever being printed/read back.
      const godDir = resolve(runDir, 'god-cli'), soulDir = resolve(runDir, 'soul-cli');
      mkdirSync(godDir); mkdirSync(soulDir);
      writeFileSync(resolve(godDir, '.eden-god.json'), JSON.stringify({world: base, token: god}), {mode: 0o600});
      writeFileSync(resolve(soulDir, '.eden-agent.json'), JSON.stringify({world: base, token: soulToken, soul: soul.id, mode: 'edge'}), {mode: 0o600});
      for (const [dir, name, route] of [[godDir, 'eden-god.mjs', '/god/eden-god.mjs'], [soulDir, 'eden-agent.mjs', '/eden-agent.mjs']]) {
        const download = await fetch(base + route); assert.equal(download.status, 200);
        writeFileSync(resolve(dir, name), await download.text());
      }
      const entrySkill = await (await fetch(base + '/SKILL.md')).text();
      assert.match(entrySkill, /eden-god\.mjs listen/); assert.match(entrySkill, /eden-agent\.mjs listen/);
      await page.goto(`${base}?dev=1#soul/${soul.id}`, {waitUntil: 'domcontentloaded'});
      await page.locator('[data-agent-message="soul"]').waitFor({state: 'visible', timeout: 90000});
      run.renderer = await page.evaluate(() => {
        const canvas = document.querySelector('canvas[aria-label="Live 3D view of the world"]');
        const gl = canvas?.getContext('webgl2'), ext = gl?.getExtension('WEBGL_debug_renderer_info');
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
      });
      assert.match(run.renderer ?? '', /Metal/); assert.doesNotMatch(run.renderer, /SwiftShader/i);
      const godButton = page.getByRole('button', {name: 'God controls', exact: true});
      await godButton.waitFor({state: 'visible', timeout: 90000}); await godButton.click();
      const box = kind => page.locator(`[data-agent-message="${kind}"]`).filter({visible: true});
      const both = async (state, label) => {
        for (const kind of ['god', 'soul']) await box(kind).locator(`[data-message-state="${state}"]`).waitFor();
        const file = `${label}-dpr${dpr}.png`;
        await page.screenshot({path: resolve(out, file)}); run.screenshots.push(file);
        run.states.push({label, ...(await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-agent-message]')].filter(el => el.getBoundingClientRect().height > 0).map(el => [el.getAttribute('data-agent-message'), {presence: el.querySelector('.agent-message-presence')?.textContent, receipt: el.querySelector('.agent-message-receipt')?.textContent}]))))});
      };
      for (const kind of ['god', 'soul']) await box(kind).getByText('Not running — this will wait', {exact: true}).waitFor();
      await box('god').getByRole('button', {name: 'Copy start prompt'}).click();
      assert.match(await page.evaluate(() => navigator.clipboard.readText()), /God mode.*listen/);
      // Real input on each overlay; clicking the Soul box closes the God popover,
      // so open it again before typing into the God box.
      const send = async (kind, words) => {
        if (kind === 'god' && !(await box('god').isVisible())) await godButton.click();
        await box(kind).getByRole('textbox', {name: 'Message your agent'}).click();
        await page.keyboard.type(words);
        await box(kind).getByRole('button', {name: 'Send', exact: true}).click();
        await box(kind).locator('[data-message-state="sent"]').waitFor();
      };
      await send('soul', 'Meet me by the water.');
      await send('god', 'A quiet garden by the water.');
      await both('sent', 'waiting');
      const godMessage = (await api('/v1/god/query', god, {})).inbox.latest;
      const soulMessage = (await api('/v1/edge/here', soulToken)).inbox.latest;
      assert.equal(godMessage.state, 'delivered'); assert.equal(soulMessage.state, 'delivered');
      await both('delivered', 'delivered');
      for (const kind of ['god', 'soul']) await box(kind).getByText('Your agent is connected', {exact: true}).waitFor();
      await api(`/v1/god/inbox/${godMessage.id}/ack`, god, {reply: 'I will plan a small garden.'});
      await api(`/v1/edge/inbox/${soulMessage.id}/ack`, soulToken, {reply: 'I will come to the water.'});
      await both('acknowledged', 'acknowledged');
      for (const [kind, dir, cli, ownerPath, previous] of [
        ['god', godDir, resolve(godDir, 'eden-god.mjs'), '/v1/god/inbox', godMessage],
        ['soul', soulDir, resolve(soulDir, 'eden-agent.mjs'), `/v1/edge/owner/${soul.id}/inbox`, soulMessage],
      ]) {
        const child = spawn(process.execPath, [resolve(root, cli), 'listen', '--after', previous.id], {cwd: dir, env: process.env, stdio: ['ignore', 'pipe', 'pipe']});
        running.add(child);
        let stdout = '', stderr = ''; child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
        const finish = once(child, 'exit');
        // Let the background command enter its long-poll before the owner types.
        await new Promise(r => setTimeout(r, 300));
        const at = Date.now();
        if (kind === 'soul' && await box('god').isVisible()) await godButton.click();
        await send(kind, `Please confirm you are listening, ${kind}.`);
        await Promise.race([finish, new Promise((_, reject) => {const t = setTimeout(() => reject(Error(`${kind} listener exceeded 10 seconds`)), 10000); t.unref();})]);
        running.delete(child); assert.equal(child.exitCode, 0, `${kind} CLI failed: ${stderr.slice(0, 400)}`);
        const response = JSON.parse(stdout); assert.equal(response.inbox.latest.state, 'delivered');
        const ack = spawn(process.execPath, [resolve(root, cli), 'ack', response.inbox.latest.id, 'Listening.'], {cwd: dir, env: process.env, stdio: ['ignore', 'pipe', 'pipe']});
        running.add(ack); let ackError = ''; ack.stderr.on('data', d => ackError += d); ack.stdout.resume();
        const [code] = await once(ack, 'exit'); running.delete(ack); assert.equal(code, 0, ackError.slice(0, 400));
        run.listenerMs[kind] = Date.now() - at; assert.ok(run.listenerMs[kind] < 10000);
        assert.equal((await api(ownerPath)).inbox.latest.state, 'acknowledged');
        await box(kind).locator('[data-message-state="acknowledged"]').waitFor();
      }
      if (!(await box('god').isVisible())) await godButton.click();
      // Reload preserves the latest durable note and reply, without a chat log.
      await page.reload({waitUntil: 'domcontentloaded'});
      await godButton.waitFor({state: 'visible', timeout: 90000}); await godButton.click();
      for (const kind of ['god', 'soul']) {await box(kind).locator('[data-message-state="acknowledged"]').waitFor(); assert.equal(await box(kind).locator('.agent-message-receipt').count(), 1);}
      await page.getByLabel('Account menu', {exact: true}).click();
      await page.getByRole('button', {name: 'Sign out', exact: true}).click();
      await page.waitForFunction(() => ![...document.querySelectorAll('[data-agent-message]')].some(el => el.getBoundingClientRect().height > 0));
      assert.equal(await page.getByText('Please confirm you are listening, soul.', {exact: false}).count(), 0);
      run.signoutCleared = true;
      assert.deepEqual(errors, []);
      rmSync(godDir, {recursive: true}); rmSync(soulDir, {recursive: true});
      console.log(JSON.stringify({dpr, states: run.states.length, listenerMs: run.listenerMs, errors: errors.length}));
    } finally {await context.close(); await stop(world.child); rmSync(resolve(runDir, 'data'), {recursive: true, force: true}); rmSync(resolve(runDir, 'god-cli'), {recursive: true, force: true}); rmSync(resolve(runDir, 'soul-cli'), {recursive: true, force: true});}
  }
  report.status = 'pass';
} catch (e) {report.status = 'fail'; report.error = e.stack; throw e;}
finally {
  if (browser) await browser.close(); release();
  for (const child of running) await stop(child).catch(() => {});
  report.endedAt = new Date().toISOString(); writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Inbox proof</title><style>body{font:15px system-ui;margin:24px;max-width:1400px}img{width:100%;border:1px solid #ccc}figure{margin:24px 0}</style><h1>Inbox: ${report.status}</h1><p>Real Chrome, DPR 1 and 2; fresh dev worlds, fake minds. <a href="report.json">Machine receipt</a></p>${report.runs.flatMap(r => r.screenshots.map(s => `<figure><figcaption>${s}</figcaption><img src="${s}"></figure>`)).join('')}`);
}
