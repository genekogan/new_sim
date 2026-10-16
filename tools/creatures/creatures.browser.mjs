#!/usr/bin/env node
// Real-Chrome proof of creature bodies (R11a): a fresh dev world with a pond, four residents of one owner and one more
// made through the Soul CLI. Pip becomes a duck with `body set duck` (the real CLI), Rex a dog and Shelly a snail (the
// owner API the CLI calls); Ana stays humanoid. Pip waddles to the pond and swims, Shelly slides off then withdraws
// into her shell, Rex follows Ana on her stroll. Each is framed by clicking its name and zooming with the wheel, at
// dpr 1 and 2, on the real GPU. Fake minds, $0. No live port, no credentials read.
//
//   node tools/creatures/creatures.browser.mjs [--out <dir>] [--port 6051] [--keep]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startWorld } from '../god-skill/dev-world.mjs';
import { chromeLease } from '<team>/ops/chrome-lease.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null)).filter(Boolean));
const out = resolve(args.out ?? '<team>/scratch/creatures/proof');
const port = Number(args.port ?? 6051), slug = 'creatures-proof';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
const report = { startedAt: new Date().toISOString(), steps: [], shots: [], pageErrors: [] };
const step = async (name, fn) => { const value = await fn(); report.steps.push({ name, value }); console.log('PASS ' + name); return value; };

const server = await startWorld({ slug, port, fresh: true, log: resolve(out, 'server.log') });
const base = server.base;
async function http(path, { as, token, body, method } = {}) {
  const r = await fetch(base + path, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { ...(as ? { authorization: `Bearer dev:${as}` } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await r.json().catch(() => null);
  return { status: r.status, value };
}
const ok = async (p, o) => { const r = await http(p, o); assert.equal(r.status, 200, `${p}: ${JSON.stringify(r.value)}`); return r.value; };
const cli = (dir, tool, ...argv) => {
  const r = spawnSync(process.execPath, [resolve(root, tool), ...argv], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 24 });
  assert.equal(r.status, 0, `${tool} ${argv.join(' ')}: ${r.stdout}${r.stderr}`); return r.stdout.trim();
};
let browser, release;
try {
  const godDir = resolve(out, 'god'); mkdirSync(godDir, { recursive: true });
  await step('the world creator places a pond and a few trees (god CLI)', () => {
    const god = (...a) => cli(godDir, 'tools/god-skill/eden-god.mjs', ...a);
    god('register', base, 'dev:admin'); god('mint');
    return [god('place', 'lake', '--circle', '14,0,9', '--name', 'pond'), god('place', 'tree', '--near', 'pond', '--count', '5', '--dist', '5')].map((s) => s.split('\n')[0]);
  });
  const invite = (await ok('/v1/admin', { as: 'admin', body: { action: 'invite', uses: 10 } })).code;
  const residents = {};
  await step('one owner makes Ana, Rex and Shelly and pairs them', async () => {
    await ok('/v1/invite', { as: 'keeper', body: { code: invite } });
    for (const name of ['Ana', 'Rex', 'Shelly']) {
      const made = await ok('/v1/souls', { as: 'keeper', body: { name, description: 'creature proof resident' } });
      const id = made.soul?.id ?? made.lifecycle?.soulId;
      for (let i = 0; i < 100 && !(await http('/v1/me', { as: 'keeper' })).value.souls.find((s) => s.id === id)?.entityId; i++) await wait(100);
      const { code } = await ok(`/v1/souls/${id}/pair`, { as: 'keeper', body: {} });
      const { token } = await ok('/v1/agent/pair', { body: { code, agent: 'creature-proof' } });
      residents[name] = { id, token };
    }
    return Object.keys(residents);
  });
  const pipDir = resolve(out, 'pip'); mkdirSync(pipDir, { recursive: true });
  const agent = (...a) => cli(pipDir, 'tools/edge-skill/eden-agent.mjs', ...a);
  await step('Pip is made through the Soul CLI and becomes a duck with `body set duck`', async () => {
    agent('register', base, invite); agent('create-soul', 'Pip', 'a duck who lives by the pond');
    const presets = JSON.parse(agent('body', 'presets')).map((p) => p.id);
    assert.ok(['duck', 'snail', 'dog'].every((id) => presets.includes(id)), presets.join(','));
    const set = JSON.parse(agent('body', 'set', 'duck'));
    assert.equal(set.body?.type, 'creature'); assert.equal(set.body?.model, 'duck');
    return { presets: presets.slice(-3), body: set.body };
  });
  await step('Rex becomes a dog and Shelly a snail (the owner body API)', async () => {
    for (const [name, preset] of [['Rex', 'dog'], ['Shelly', 'snail']]) {
      const r = await ok('/v1/edge/body', { token: residents[name].token, body: { preset }, method: 'PUT' });
      assert.equal(r.body.model, preset);
    }
    return 'ok';
  });
  const caps = async (name) => (await ok('/v1/edge/capabilities', { token: residents[name].token })).capabilities ?? [];
  const act = (name, body) => http('/v1/edge/act', { token: residents[name].token, body });
  await step('a snail cannot hug: refused with its own reason', async () => {
    const r = await act('Shelly', { capability: `hug:${residents.Ana.id}` });
    assert.equal(r.value?.accepted, false); assert.match(r.value.reason, /snail has no arms to hug/);
    return r.value.reason;
  });
  await step('Rex follows Ana; Ana strolls; Shelly slides toward the trees; Pip swims in the pond', async () => {
    const rexCaps = await caps('Rex'), follow = rexCaps.find((c) => c.id === `follow:${residents.Ana.id}`);
    assert.ok(follow, rexCaps.map((c) => c.id).join(','));
    assert.ok((await act('Rex', { capability: follow.id, params: { seconds: 600 } })).value?.accepted);
    const anaWalk = (await caps('Ana')).find((c) => c.verb === 'wander' || c.verb === 'stroll');
    assert.ok((await act('Ana', { capability: anaWalk.id, params: { seconds: 300 } })).value?.accepted, 'Ana strolls');
    const swim = JSON.parse(agent('act', 'swim')); // plain words through the real CLI
    const snail = (await caps('Shelly')).find((c) => c.verb === 'wander') ?? (await caps('Shelly')).find((c) => c.verb === 'walk');
    assert.match(snail.label, /^Slide/);
    assert.ok((await act('Shelly', { capability: snail.id, params: { seconds: 120 } })).value?.accepted);
    return { follow: follow.label, swim: swim.receipt?.label ?? swim, snail: snail.label };
  });
  const { chromium } = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test');
  release = await chromeLease('creatures');
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
  async function frame(page, name, wheel = 3) {
    // select the resident through its visible name, then zoom on it with real wheel input
    const label = page.locator('b').filter({ hasText: new RegExp('^' + name + '$') }).first();
    await label.waitFor({ state: 'visible', timeout: 120000 });
    await label.click(); await wait(800);
    for (let k = 0; k < wheel; k++) { const box = await label.boundingBox(); if (!box) break; await page.mouse.move(box.x + box.width / 2, box.y + box.height + 40); await page.mouse.wheel(0, -320); await wait(500); }
    await wait(1500);
  }
  async function shoot(stage, name, dpr, wheel) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 720 }, deviceScaleFactor: dpr });
    page.on('pageerror', (e) => report.pageErrors.push(`${stage}: ${e.message}`));
    await page.goto(base + '?dev=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('canvas', { timeout: 120000 }); await wait(6000);
    const renderer = await page.evaluate(() => { const gl = document.querySelector('canvas')?.getContext('webgl2'), ext = gl?.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null; });
    assert.match(renderer ?? '', /Apple|Metal/, 'real GPU required');
    if (name) await frame(page, name, wheel);
    const path = resolve(out, `${stage}-dpr${dpr}.png`); await page.screenshot({ path, timeout: 120000 });
    report.shots.push({ stage, dpr, name, path, renderer }); await page.close();
  }
  for (const dpr of [1, 2]) {
    await shoot('rex-follows-ana', 'Rex', dpr, 3);
    await shoot('pip-swims', 'Pip', dpr, 4);
    await shoot('shelly-slides', 'Shelly', dpr, 5);
  }
  await step('Shelly settles: the snail withdraws into her shell', async () => {
    const r = await act('Shelly', { capability: 'settle:here', params: { seconds: 300 } });
    assert.ok(r.value?.accepted, JSON.stringify(r.value)); await wait(4000); return 'settled';
  });
  for (const dpr of [1, 2]) await shoot('shelly-settled', 'Shelly', dpr, 5);
  report.finishedAt = new Date().toISOString();
  assert.deepEqual(report.pageErrors, [], 'no page errors');
} finally {
  await browser?.close(); release?.();
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  if (!args.keep) server.child.kill();
  else console.log(`kept ${base}?dev=1 (pid ${server.child.pid})`);
}
