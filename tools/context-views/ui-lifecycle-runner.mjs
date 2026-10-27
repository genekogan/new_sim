// One existing fixture session; no independent server or render policy.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { artwork } from './fixture-artwork.mjs';
import { edits } from './fixture.mjs';

const exec = promisify(execFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

/** Browser and CLI use the actual public endpoints; the owner's job trace cap
 * includes their requests, not only session.request calls. No route mocks. */
export async function runUiLifecycleProof({ root, withFixtureSession, report, save, out }) {
  const evidence = report.ui = { startedAt: new Date().toISOString(), checks: [], notes: [
    'Asset and wall edits precede opening Explore; this proves the UI displays the latest revision, not an in-place media refresh.',
    'The standalone Soul CLI retrieves public context without creating or moving a Soul.',
    'No mocked pagination, inference, extra scenes, or camera battery.',
  ] };
  const check = (name, ok, data = {}) => { evidence.checks.push({ name, ok: !!ok, ...data }); save(); assert.ok(ok, name); };
  const receipt = await withFixtureSession({ variant: 'ui-lifecycle' }, async session => {
    const { request, signal, deadline, base, bindings, setPhase } = session;
    const ref = id => bindings.find(row => row.id === id).ref;
    const landmark = ref('landmark'), art = ref('wall-artwork'), room = ref('enclosed-room');
    const budget = () => { signal.throwIfAborted(); assert.ok(Date.now() < deadline, 'absolute deadline'); assert.ok(session.jobEvents().filter(e => e.phase === 'start').length <= 22, 'actual job cap'); };
    const wait = ms => delay(ms, undefined, { signal });
    const views = async refs => (await request('/v1/world/context/views', { refs, detail: false, sheet: false }, null)).json();
    const ready = async (refs, label) => {
      setPhase(label); const start = performance.now(); let data;
      for (;;) {
        budget(); data = await views(refs);
        if (data.views.every(v => v.status !== 'pending')) break;
        await wait(200);
      }
      const ms = performance.now() - start;
      check(label, data.views.every(v => v.status === 'ready') && ms <= 15000, { ms, views: data.views.map(v => ({ ref: v.ref, key: v.key, revision: v.revision, url: v.url, status: v.status })) });
      return data.views;
    };
    const settled = async () => {
      for (;;) {
        budget(); const events = session.jobEvents();
        if (events.filter(e => e.phase === 'start').length === events.filter(e => e.phase === 'finish').length) { await wait(300); if (session.jobEvents().length === events.length) return; }
        await wait(100);
      }
    };
    const firstListing = await (await request('/v1/world/context', undefined, null)).json();
    evidence.initialListing = firstListing.targets.map(t => ({ ref: t.ref, title: t.title }));
    const expectedRefs = [...new Set([...bindings.map(b => b.ref), bindings.find(b => b.id === 'enclosed-room').entity])].sort();
    check('initial default listing has six exact fixture records', firstListing.total === 6 && JSON.stringify(firstListing.targets.map(t => t.ref).sort()) === JSON.stringify(expectedRefs), { expectedRefs });
    const first = await ready([landmark, art], 'prime-two-nondetail');
    const artBefore = first.find(v => v.ref === art);
    const bytes = artwork(1), uploaded = await session.uploadArtwork(bytes), asset = uploaded.asset ?? uploaded;
    check('replacement asset uses frozen exact bytes', (asset.sha ?? asset.hash) === sha(bytes));
    setPhase('asset-replace');
    const changed = await (await request('/v1/god/act', { ops: [{ op: 'set', id: 'hall/artwork', state: { media: `/assets/${sha(bytes)}.png` } }] })).json();
    check('media-only edit accepted', changed.accepted);
    const second = await ready([art, landmark], 'asset-refresh');
    const artAfter = second.find(v => v.ref === art);
    check('media replaces pixels under stable ref', artAfter.ref === artBefore.ref && artAfter.key !== artBefore.key);
    const oldOriginal = await session.rawGet(artBefore.original.url);
    check('old original version refused', oldOriginal.status === 404, { status: oldOriginal.status });
    const oldArt = await session.rawGet(artBefore.url);
    check('old cached artwork URL refused', oldArt.status === 404, { status: oldArt.status });
    const exact = await (await request('/v1/world/context?ref=' + encodeURIComponent(art), undefined, null)).json();
    const original = exact.targets[0].original, originalBytes = Buffer.from(await (await session.rawGet(original.url)).arrayBuffer());
    check('current original is exact replacement', sha(originalBytes) === sha(bytes), { original });
    setPhase('intervening-wall');
    const wall = await (await request('/v1/god/act', { ops: edits.find(e => e.id === 'intervening-wall').ops })).json();
    check('frozen intervening wall accepted', wall.accepted);
    const third = await ready([landmark, art], 'wall-refresh');
    check('neighbour wall invalidates landmark key', third.find(v => v.ref === landmark).key !== second.find(v => v.ref === landmark).key);
    const oldFountain = await session.rawGet(second.find(v => v.ref === landmark).url);
    check('old cached fountain URL refused after wall', oldFountain.status === 404, { status: oldFountain.status });
    await settled();
    const listing = await (await request('/v1/world/context', undefined, null)).json();
    evidence.uiListing = listing.targets.map(t => ({ ref: t.ref, title: t.title }));
    check('bounded real default listing before opening UI', listing.total >= 6 && listing.total <= 7 && !listing.nextCursor);

    let browserServer, browser, page, closing;
    const responseTasks = new Set(), browserViews = [], errors = [];
    const snapshot = async name => {
      writeFileSync(resolve(out, name + '.yml'), await page.locator('body').ariaSnapshot());
      await page.screenshot({ path: resolve(out, name + '.png'), fullPage: false });
    };
    const closeBrowser = () => {
      if (!browser && !browserServer) return Promise.resolve();
      return closing ??= (async () => {
      if (browser) await Promise.race([browser.close().catch(() => {}), delay(750)]);
      if (browserServer) await Promise.race([browserServer.close().catch(() => {}), delay(750)]);
      // The fixture owner's identity registry is the final bounded force-cleanup fallback.
      if (browserServer?.process().exitCode === null) await Promise.race([browserServer.kill().catch(() => {}), delay(250)]);
      })();
    };
    const onAbort = () => { void closeBrowser(); };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const { chromium } = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test');
      budget(); assert.ok(deadline - Date.now() >= 20000, 'enough work budget before browser launch');
      browserServer = await chromium.launchServer({ executablePath: process.env.GOD_LOOK_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--ignore-gpu-blocklist'], timeout: 5000 });
      await session.registerProcess(browserServer.process().pid);
      budget();
      browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: 5000 });
      budget();
      const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
      await context.addInitScript(() => localStorage.setItem('skipgc', 't'));
      page = await context.newPage(); page.setDefaultTimeout(12000);
      page.on('pageerror', error => errors.push(String(error).slice(0, 300)));
      page.on('response', response => {
        if (!response.url().endsWith('/v1/world/context/views')) return;
        const task = response.json().then(data => browserViews.push(data)).catch(error => errors.push(String(error))).finally(() => responseTasks.delete(task));
        responseTasks.add(task);
      });
      setPhase('explore-ui');
      await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: Math.min(30000, deadline - Date.now()) });
      await page.getByRole('button', { name: /Explore/ }).first().waitFor({ state: 'visible' });
      await snapshot('ui-before-open');
      await page.getByRole('button', { name: /Explore/ }).first().click();
      const dialog = page.getByRole('dialog'); await dialog.waitFor({ state: 'visible' });
      await snapshot('ui-explore-initial');
      for (const target of listing.targets) {
        const button = dialog.getByRole('button', { name: target.title, exact: true });
        await button.scrollIntoViewIfNeeded();
        await button.locator('img').waitFor({ state: 'visible', timeout: 15000 });
        const label = await button.getAttribute('aria-description');
        check('architectural disclosure ' + target.ref, /Architectural context.*fixed daylight.*default doors.*no Souls/.test(label ?? ''), { label });
      }
      await Promise.all([...responseTasks]); await settled();
      await snapshot('ui-explore-ready');
      const roomTarget = listing.targets.find(t => t.ref === room);
      const roomButton = dialog.getByRole('button', { name: roomTarget.title, exact: true });
      const imageUrl = await roomButton.locator('img').getAttribute('src');
      const uiView = browserViews.flatMap(v => v.views ?? []).findLast(v => v.ref === room && v.status === 'ready');
      check('Explore uses ready shared room image', !!uiView && new URL(imageUrl, base).href === base + uiView.url, { uiView, imageUrl });
      const uiBytes = Buffer.from(await (await session.rawGet(uiView.url)).arrayBuffer());
      const cliDir = resolve(out, 'cli-public'); mkdirSync(cliDir);
      writeFileSync(resolve(cliDir, '.eden-agent.json'), JSON.stringify({ world: base }), { mode: 0o600 });
      const startsBefore = session.jobEvents().filter(e => e.phase === 'start').length;
      const cliPath = process.env.CONTEXT_CLI ?? resolve(root, 'tools/world-launcher/soul/eden.mjs');
      const cliSource = readFileSync(cliPath), cliSha = sha(cliSource);
      if (process.env.CONTEXT_CLI_SHA256) check('approved CLI source hash', cliSha === process.env.CONTEXT_CLI_SHA256);
      evidence.cliSource = { path: cliPath, sha256: cliSha, version: cliSource.toString().match(/const VERSION = "([^"]+)"/)?.[1] ?? null };
      const cliImage = resolve(out, 'cli-room.png');
      const { stdout } = await exec(process.execPath, [cliPath, 'views', room, '--out', cliImage], { cwd: cliDir, timeout: Math.min(15000, deadline - Date.now()), signal, maxBuffer: 1024 * 1024 });
      const cli = JSON.parse(stdout), cliView = cli.views[0];
      check('CLI reuses exact non-detail UI image without a render', cliView.key === uiView.key && cliView.revision === uiView.revision && cliView.url === uiView.url && sha(readFileSync(cliImage)) === sha(uiBytes) && session.jobEvents().filter(e => e.phase === 'start').length === startsBefore,
        { ref: room, key: cliView.key, revision: cliView.revision, url: cliView.url, imageSha: sha(uiBytes), cliPath });
      await snapshot('ui-before-room-selection');
      const soulsBefore = (await (await request('/v1/world', undefined, null)).json()).souls;
      check('fixture has no Souls before selection', Array.isArray(soulsBefore) && soulsBefore.length === 0);
      const beforeCamera = await page.evaluate(() => globalThis.__simCamera ?? null);
      await roomButton.click();
      await dialog.waitFor({ state: 'hidden' });
      await page.waitForFunction(before => JSON.stringify(globalThis.__simCamera?.p) !== JSON.stringify(before?.p), beforeCamera);
      await wait(1500);
      const afterCamera = await page.evaluate(() => globalThis.__simCamera ?? null);
      await snapshot('ui-room-selected');
      const expectedCamera = roomTarget.viewpoint ?? roomTarget.camera;
      const distance = (a, b) => a && b ? Math.hypot(...a.map((v, i) => v - b[i])) : Infinity;
      check('room selection reaches published inspection eye and target', !!afterCamera && !!expectedCamera && distance(afterCamera.p, expectedCamera.eye) < .05 && distance(afterCamera.pivot, expectedCamera.at) < .05,
        { beforeCamera, afterCamera, expectedCamera, roomRef: room });
      const soulsAfter = (await (await request('/v1/world', undefined, null)).json()).souls;
      check('Explore never creates or moves a Soul in the empty fixture', JSON.stringify(soulsBefore) === JSON.stringify(soulsAfter), { before: soulsBefore.length, after: soulsAfter.length });
      evidence.browserErrors = errors;
    } finally { signal.removeEventListener('abort', onAbort); await closeBrowser(); await Promise.race([Promise.all([...responseTasks]), delay(250)]); }
    await settled();
    setPhase('idle-after-browser-close');
    const idleEvents = session.jobEvents().length, idleAt = Date.now(), idleBefore = await session.ownedProcesses();
    await wait(30000);
    const idleAfter = await session.ownedProcesses();
    check('30 seconds idle has no new jobs or owned browser processes', session.jobEvents().length === idleEvents && idleBefore.every(p => p.server) && idleAfter.every(p => p.server), { elapsedMs: Date.now() - idleAt, idleBefore, idleAfter });
  });
  evidence.receipt = receipt;
  evidence.finishedAt = new Date().toISOString();
  evidence.pass = !receipt.error && receipt.cleanup.complete && evidence.checks.every(c => c.ok);
  evidence.error = receipt.error;
  save();
  return evidence;
}
