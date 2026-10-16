// W5 + M2 proof on a fresh local Mars (template, fake minds, ports 5868): apply the field and water patches with the
// guarded tool, a scripted resident (eden-agent CLI) carries water tank → can → bed and lights the field fire bowl, real
// Chrome shoots before/after at dpr 1 and 2, then both patches roll back. No live world is touched.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { boot, addSoul, follow, stop, ROOT } from './lib.mjs';
const { chromium } = createRequire(`${ROOT}/mars/viewer/package.json`)('@playwright/test');
const { chromeLease } = await import('<team>/ops/chrome-lease.mjs');
const shots = '<team>/lanes/t3-mars-shots', S = '<team>/scratch/mars/water'; mkdirSync(shots, { recursive: true }); mkdirSync(S, { recursive: true, mode: 0o700 });
for (const f of ['field.receipt.json', 'water.receipt.json']) rmSync(`${S}/${f}`, { force: true });
const ctx = await boot({ port: 5868, template: `${ROOT}/worlds/templates/mars-two.json`, out: `${S}/world` });
const tokenFile = `${S}/local-god.token`; writeFileSync(tokenFile, ctx.god, { mode: 0o600 });
// daylight for the pictures: a local-only world edit before the patches (paused at 10:00)
await ctx.api('/v1/god/act', { body: { note: 'daylight for proof shots', ops: [{ op: 'world', state: { time: { set: { hour: 10, n: 1 }, paused: true } } }] } });
const log = []; const note = (...a) => { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); log.push(s); console.log(s); };
const tool = (spec, receipt, ...flags) => JSON.parse(execFileSync(process.execPath, [`${ROOT}/tools/mars-rotation/add-patch.mjs`, '--spec', `${ROOT}/worlds/patches/${spec}/spec.json`, '--base', ctx.base, '--receipt', `${S}/${receipt}`, ...flags], { encoding: 'utf8', env: { ...process.env, EDEN_GOD_TOKEN_FILE: tokenFile } }));
const release = await chromeLease('mars', { waitMs: 45 * 60000 }); let browser;
const shoot = async (name, eye, at) => { for (const dpr of [1, 2]) {
  const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr }); await c.addInitScript(() => localStorage.setItem('sim.dev', 'admin'));
  const page = await c.newPage(); const q = new URLSearchParams({ dev: '1', shot: '1', settle: '2500', eye: eye.join(','), at: at.join(','), dust: 'clear' });
  // a cold world downloads ~21 MB of meshes first; the shot hook can fire before the entity layer is up: reload until ready
  for (let i = 0; ; i++) { await page.goto(`${ctx.base}?${q}`, { waitUntil: 'domcontentloaded', timeout: 120000 }); let ready = false; for (let k = 0; k < 60 && !ready; k++) { await page.waitForTimeout(5000); ready = await page.evaluate(() => window.__shotReady === true); } if (ready && (await page.title()) === 'ready') break; assert(i < 4, 'viewer never got its entity world'); await page.waitForTimeout(5000); }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${shots}/w5-${name}-dpr${dpr}.png`, timeout: 60000 }); await c.close(); } note('shot', name); };
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
  const GARDEN = { eye: [95.6, 3.6, -44.2], at: [99.3, 0.5, -40.2] }, FIELD = { eye: [0, 6, -57], at: [-0.5, 0.4, -49.2] };
  note('review', tool('mars-water-20261016', 'water.receipt.json', '--token-file', '/dev/null').mode);
  await shoot('garden-before', GARDEN.eye, GARDEN.at);
  for (const [spec, rc] of [['mars-field-20261016', 'field.receipt.json'], ['mars-water-20261016', 'water.receipt.json']]) { note('preview', spec, tool(spec, rc)); note('apply', spec, tool(spec, rc, '--apply')); }
  const snap = await ctx.api('/v1/world/snapshot', { as: 'public' }), E = (n) => snap.entities.find((e) => e.name === n).id;
  const st = async (n) => (await ctx.query({ describe: E(n) })).describe.state;
  note('levels before', { tank: await st('water-tank'), bed: await st('garden-bed'), can: await st('watering-can') });
  await shoot('garden-patched', GARDEN.eye, GARDEN.at);
  await addSoul(ctx);
  const caps0 = (await ctx.api('/v1/edge/capabilities', { as: 'soul' })).capabilities.filter((c) => /draw-water|:water$|:light$/.test(c.id));
  note('offered far away', caps0.map((c) => `${c.id} ${c.available ? 'available' : 'blocked:' + c.blocked?.code} | ${c.label}`));
  for (const c of ['walk:freeside', 'walk:water-tank', `pick-up:${E('watering-can')}`, `object:${E('water-tank')}:draw-water`, `object:${E('garden-bed')}:water`]) { const r = await follow(ctx, c, { timeout: 400000 }); note(c, r.ok ?? r.accepted, r.code ?? '', r.phase ?? '', r.ms ?? ''); }
  note('levels after', { tank: await st('water-tank'), bed: await st('garden-bed'), can: await st('watering-can') });
  const caps1 = (await ctx.api('/v1/edge/capabilities', { as: 'soul' })).capabilities.filter((c) => /draw-water|:water$/.test(c.id));
  note('now offered', caps1.map((c) => `${c.id} ${c.available ? 'available' : 'blocked:' + c.blocked?.code + ' ' + c.blocked?.reason}`));
  await shoot('garden-watered', GARDEN.eye, GARDEN.at);
  note('rollback while holding the can', (() => { try { return tool('mars-water-20261016', 'water.receipt.json', '--rollback'); } catch (e) { return String(e.stderr || e.message).match(/rollback refused[^\n]*/)?.[0]; } })());
  { const r = await follow(ctx, 'put-down:here', { timeout: 300000 }); note('put the can down by the beds', r.ok ?? r.accepted, r.code ?? '', r.phase ?? ''); }
  note('can after put-down (parent)', (await ctx.api('/v1/world/snapshot', { as: 'public' })).entities.find((e) => e.id === E('watering-can')).in);
  for (const c of ['walk:kitchen', 'walk:chiba/field-fire-bowl', `object:${E('field-fire-bowl')}:light`]) { const r = await follow(ctx, c, { timeout: 400000 }); note(c, r.ok ?? r.accepted, r.code ?? '', r.phase ?? '', r.ms ?? ''); }
  const sit = await follow(ctx, `sit:${E('field-beanbag')}`, { seated: true, params: { seconds: 900 } }); note('sit beanbag', sit.ok ?? sit.accepted, sit.code ?? '');
  note('bowl', await st('field-fire-bowl'));
  await shoot('field-fire', FIELD.eye, FIELD.at);
  for (const [spec, rc] of [['mars-water-20261016', 'water.receipt.json'], ['mars-field-20261016', 'field.receipt.json']]) { try { note('rollback', spec, tool(spec, rc, '--rollback', '--apply')); } catch (e) { note('rollback refused', spec, String(e.stdout || e.stderr || e.message).slice(0, 400)); } }
} finally { writeFileSync(`${S}/proof.log`, log.join('\n') + '\n'); await browser?.close(); release(); await stop(ctx); rmSync(tokenFile, { force: true }); }
