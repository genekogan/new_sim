// Release-3 dress rehearsal of the four Mars world patches, in the order lane A applies them live:
// fidelity -> rotation (82) -> field -> water, each through its own guarded tool exactly as the READMEs say (review,
// preview, --apply), on a fresh local Mars built from worlds/templates/mars-two.json (same 167 named entities as the
// live world; checked against a public snapshot when --live-snapshot is given). Fake minds, lane ports, no live write.
//   node r3-proof.mjs --port 6340 --out <dir> [--live-snapshot <json>] [--shots <dir>] [--no-resident] [--no-shots]
// With a resident: a scripted CLI Soul walks into Mimos, sits on the red sofa, fetches water to a bed, lights the field
// fire and sits on the beanbag. Real Chrome shoots the same cameras before and after (after-cameras turned with the
// campus). Then every patch is rolled back in reverse order through the same tools.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { boot, addSoul, follow, stop, ROOT } from './lib.mjs';
import { turn } from '../patch.mjs';
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const port = Number(flag('port', 6340)), S = flag('out'), shots = flag('shots', `${S}/shots`), liveSnap = flag('live-snapshot', null);
const resident = !args.includes('--no-resident'), doShots = !args.includes('--no-shots');
assert(S, '--out <dir>'); mkdirSync(S, { recursive: true, mode: 0o700 }); mkdirSync(shots, { recursive: true });
for (const f of ['fidelity', 'rotation', 'field', 'water']) rmSync(`${S}/${f}.receipt.json`, { force: true });
const log = []; const note = (...a) => { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); log.push(new Date().toISOString().slice(11, 19) + ' ' + s); console.log(s); };
const ctx = await boot({ slug: 'mars-r3', port, template: `${ROOT}/worlds/templates/mars-two.json`, out: `${S}/world` });
const tokenFile = `${S}/local-god.token`; writeFileSync(tokenFile, ctx.god, { mode: 0o600 });
const N = process.execPath, env = { ...process.env, EDEN_GOD_TOKEN_FILE: tokenFile };
const run = (argv, withToken = true) => { try { return JSON.parse(execFileSync(N, argv, { encoding: 'utf8', maxBuffer: 1e8, env: withToken ? env : { ...process.env, EDEN_GOD_TOKEN_FILE: '' } })); } catch (e) { const m = String(e.stderr || e.stdout || e.message).split('\n').filter((l) => /Error|refused|assert|expected/i.test(l)).slice(0, 3).join(' | '); return { failed: true, error: m.slice(0, 600) }; } };
const T = {
  fidelity: (...f) => [`${ROOT}/tools/mars-fidelity/patch.mjs`, '--base', ctx.base, '--receipt', `${S}/fidelity.receipt.json`, ...f],
  rotation: (...f) => [`${ROOT}/tools/mars-rotation/patch.mjs`, '--base', ctx.base, '--receipt', `${S}/rotation.receipt.json`, '--bearing', '82', ...f],
  field: (...f) => [`${ROOT}/tools/mars-rotation/add-patch.mjs`, '--spec', `${ROOT}/worlds/patches/mars-field-20261016/spec.json`, '--base', ctx.base, '--receipt', `${S}/field.receipt.json`, ...f],
  water: (...f) => [`${ROOT}/tools/mars-rotation/add-patch.mjs`, '--spec', `${ROOT}/worlds/patches/mars-water-20261016/spec.json`, '--base', ctx.base, '--receipt', `${S}/water.receipt.json`, ...f],
};
const short = (r) => (r && typeof r === 'object' ? Object.fromEntries(Object.entries(r).filter(([k]) => !['batch', 'ops', 'items', 'before', 'parents', 'descendants'].includes(k))) : r);
// Cameras at bearing 90; after the rotation they are turned with the campus so frames match.
const VIEWS = {
  'campus-top': { eye: [10, 95, 10], at: [10, 0, -35] },
  'mimos-inside': { eye: [3, 7, -24], at: [3, 0, -31], hideRoofs: 1 },
  garden: { eye: [95.6, 3.6, -44.2], at: [99.3, 0.5, -40.2] },
  field: { eye: [0, 6, -57], at: [-0.5, 0.4, -49.2] },
};
const turned = (v, bearing) => { if (bearing === 90) return v; const t = (p) => { const q = turn([p[0], p[1], p[2]], 0, bearing).p; return [q[0], p[1], q[2]]; }; return { ...v, eye: t(v.eye), at: t(v.at) }; };
let browser, release;
async function shoot(tag, bearing) {
  if (!doShots) return;
  if (!browser) {
    const { chromium } = createRequire(`${ROOT}/mars/viewer/package.json`)('@playwright/test');
    const { chromeLease } = await import('<team>/ops/chrome-lease.mjs');
    release = await chromeLease('r3c-mars', { waitMs: 45 * 60000 });
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
  }
  for (const dpr of [1, 2]) {
    const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
    await c.addInitScript(() => localStorage.setItem('sim.dev', 'admin'));
    const page = await c.newPage();
    for (const [name, v0] of Object.entries(VIEWS)) {
      const v = turned(v0, bearing);
      const q = new URLSearchParams({ dev: '1', shot: '1', settle: '2500', eye: v.eye.join(','), at: v.at.join(','), dust: 'clear', ...(v.hideRoofs ? { hideRoofs: '1' } : {}) });
      for (let i = 0; ; i++) {
        await page.goto(`${ctx.base}?${q}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
        let ready = false; for (let k = 0; k < 60 && !ready; k++) { await page.waitForTimeout(4000); ready = await page.evaluate(() => window.__shotReady === true); }
        if (ready) break; assert(i < 3, 'viewer never got its entity world'); await page.waitForTimeout(4000);
      }
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${shots}/${tag}-${name}-dpr${dpr}.png`, timeout: 60000 });
    }
    await c.close();
  }
  note('shots', tag);
}
const result = { port, base: ctx.base };
try {
  const snap0 = await ctx.api('/v1/world/snapshot', { as: 'public' });
  result.entities = snap0.entities.length;
  if (liveSnap) {
    const live = JSON.parse(readFileSync(liveSnap, 'utf8')), names = (s) => new Set(s.entities.map((e) => e.name));
    const a = names(snap0), b = names(live);
    result.vsLive = { liveSeq: live.seq, liveEntities: live.entities.length, onlyLocal: [...a].filter((n) => !b.has(n)), onlyLive: [...b].filter((n) => !a.has(n)), liveBodies: live.entities.filter((e) => /body|soul/i.test(e.def ?? '')).length };
    note('dev copy vs live', result.vsLive);
  }
  // daylight for the pictures: a local-only edit before the patches (paused at 10:00); not part of the live steps
  await ctx.api('/v1/god/act', { body: { note: 'daylight for proof shots', ops: [{ op: 'world', state: { time: { set: { hour: 10, n: 1 }, paused: true } } }] } });
  await shoot('before', 90);
  result.apply = {};
  for (const k of ['fidelity', 'rotation', 'field', 'water']) {
    const review = run(T[k](), false), preview = run(T[k]()), apply = preview.failed ? { skipped: 'preview failed' } : run(T[k]('--apply'));
    result.apply[k] = { review: review.failed ? review : (review.mode ?? 'ok'), preview: short(preview), apply: short(apply) };
    note('patch', k, result.apply[k]);
  }
  const snap = await ctx.api('/v1/world/snapshot', { as: 'public' }), E = (n) => snap.entities.find((e) => e.name === n)?.id;
  result.mimos = snap.entities.find((e) => e.name === 'mimos');
  result.fidelityDefs = [...new Set(snap.entities.map((e) => e.def).filter((d) => /fidelity|mars-.*-fid|^mars-/.test(d ?? '')))];
  note('after apply: mimos', result.mimos?.def, result.mimos?.p, result.mimos?.r, 'local defs in use', result.fidelityDefs);
  if (resident) {
    await addSoul(ctx);
    const st = async (n) => (await ctx.query({ describe: E(n) })).describe.state;
    result.walk = [];
    const step = async (cap, opt = {}) => { const r = await follow(ctx, cap, { timeout: 400000, ...opt }); const row = { cap: cap.replace(/e_[0-9a-f]+/, (m) => snap.entities.find((e) => e.id === m)?.name ?? m), ok: r.ok ?? false, accepted: r.accepted, code: r.code ?? null, phase: r.phase ?? null, room: r.room ? `${r.room.building}/${r.room.room}` : null, s: Math.round((r.ms ?? 0) / 1000) }; result.walk.push(row); note('step', row); return r; };
    await step('walk:mimos/main-south');
    await step(`sit:${E('red-sofa-12')}`, { seated: true, params: { seconds: 600 } });
    await step('stand:here');
    await step('walk:freeside'); await step('walk:water-tank');
    await step(`pick-up:${E('watering-can')}`);
    await step(`object:${E('water-tank')}:draw-water`);
    await step(`object:${E('garden-bed')}:water`);
    result.levels = { tank: await st('water-tank'), bed: await st('garden-bed'), can: await st('watering-can') };
    note('levels', result.levels);
    await step('put-down:here');
    result.canParent = (await ctx.api('/v1/world/snapshot', { as: 'public' })).entities.find((e) => e.id === E('watering-can'))?.in;
    note('can after put-down', result.canParent);
    await step('walk:chiba/field-fire-bowl');
    await step(`object:${E('field-fire-bowl')}:light`);
    await step(`sit:${E('field-beanbag')}`, { seated: true, params: { seconds: 900 } });
    result.bowl = await st('field-fire-bowl'); note('bowl', result.bowl);
  }
  await shoot('after', 82);
  if (resident) await follow(ctx, 'walk:mimos/floor', { timeout: 400000 }).catch(() => null); // out of the field before rollbacks
  result.rollback = {};
  for (const k of ['water', 'field', 'rotation', 'fidelity']) {
    const review = run(T[k]('--rollback')), apply = review.failed ? { skipped: 'review refused' } : run(T[k]('--rollback', '--apply'));
    result.rollback[k] = { review: short(review), apply: short(apply) }; note('rollback', k, result.rollback[k]);
  }
  const snapR = await ctx.api('/v1/world/snapshot', { as: 'public' });
  const m0 = snap0.entities.find((e) => e.name === 'mimos'), m1 = snapR.entities.find((e) => e.name === 'mimos');
  result.afterRollback = { entities: snapR.entities.length, mimosDef: m1?.def, mimosPoseBack: JSON.stringify([m0.p, m0.r]) === JSON.stringify([m1?.p, m1?.r]) };
  note('after rollback', result.afterRollback);
} catch (e) { result.error = String(e.stack ?? e); note('ERROR', e.message); }
finally { writeFileSync(`${S}/proof.json`, JSON.stringify(result, null, 1)); writeFileSync(`${S}/proof.log`, log.join('\n') + '\n'); await browser?.close(); release?.(); await stop(ctx); rmSync(tokenFile, { force: true }); }
