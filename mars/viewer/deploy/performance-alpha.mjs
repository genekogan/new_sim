// Observation only. Never imported by the app or the normal release gate.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const viewer = path.resolve(import.meta.dirname, '..');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const help = `Prepare: node deploy/performance-alpha.mjs --plan
Execute ONLY after root grants the serialized slot:
node deploy/performance-alpha.mjs --execute --base https://sim.mars.college \
  --deployment /absolute/verified/deployment.json --source FULL_PUBLISHED_SHA \
  --build-root /absolute/frozen/viewer/dist --large-manifest /absolute/large-assets.json
Optional --out ignored-receipt-directory; --renderer swiftshader|native (default swiftshader).
--museum-2026-only measures only the actual campus homepage cold then ordinary warm reload.
Two isolated Lab contexts (design-studio, living-day-studio), each cold then ordinary warm reload;
three strict design-studio resets; one isolated cold museum /studio/2022 visit.
No retries, cache disabling, request interception, programmatic engine ticks or backend calls.
Fixed 1280x800/DPR1, 8s paused + 8s actual Play per Lab; aggregate transfer ceiling 300MiB.
Native renderer is a separate explicit profile, never compared as equivalent to SwiftShader.`;
if (!args.includes('--execute')) {
  console.log(help);
} else {
  await execute();
}

async function execute() {
  const museum2026Only = args.includes('--museum-2026-only');
  for (const name of [
    '--base',
    '--deployment',
    '--source',
    '--build-root',
    '--large-manifest',
  ]) {
    assert(
      args.includes(name) && option(name) && !option(name).startsWith('--'),
      `Missing ${name}`,
    );
  }
  const base = new URL(option('--base'));
  assert(
    base.protocol === 'https:' &&
      !base.username &&
      !base.password &&
      base.pathname === '/' &&
      !base.search &&
      !base.hash,
    'Public HTTPS origin required',
  );
  assert(
    ['sim.mars.college', 'mars-campus-2026.<workers-subdomain>.workers.dev'].includes(
      base.hostname,
    ),
    'Unrecognized publication origin',
  );
  const source = option('--source');
  assert(/^[a-f0-9]{40}$/.test(source), 'Full published source SHA required');
  const deploymentBytes = fs.readFileSync(option('--deployment'));
  const deployment = JSON.parse(deploymentBytes);
  assert.equal(
    deployment.source_commit,
    source,
    'Deployment receipt/source mismatch',
  );
  const largeBytes = fs.readFileSync(option('--large-manifest'));
  const large = JSON.parse(largeBytes);
  const buildRoot = path.resolve(option('--build-root'));
  assert(
    fs.existsSync(path.join(buildRoot, 'index.html')),
    'Frozen Vite build required',
  );
  const renderer = args.includes('--renderer')
    ? option('--renderer')
    : 'swiftshader';
  assert(
    ['swiftshader', 'native'].includes(renderer),
    'Unknown renderer profile',
  );
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(viewer, '.pw-browsers');
  const { chromium } = await import('@playwright/test');
  const out = path.resolve(
    args.includes('--out')
      ? option('--out')
      : path.join(
          viewer,
          '.cloudflare/performance-alpha',
          `run-${new Date().toISOString().replace(/[:.]/g, '-')}`,
        ),
  );
  assert(
    out.includes(`${path.sep}.cloudflare${path.sep}`),
    'Receipts must remain in ignored .cloudflare',
  );
  fs.mkdirSync(out, { recursive: true });
  assert(
    !fs.existsSync(path.join(out, 'result.json')),
    'Never overwrite an existing measurement receipt',
  );
  const report = {
    startedAtUtc: new Date().toISOString(),
    status: 'running',
    publishedSource: source,
    harnessSource: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: viewer,
      encoding: 'utf8',
    }).trim(),
    harnessSha256: hash(fs.readFileSync(import.meta.filename)),
    base: base.href,
    operatorSuppliedPublication: {
      version: deployment.version,
      release: deployment.release,
      deployedAt: deployment.deployed_at,
      deploymentSha256: hash(deploymentBytes),
      largeManifestSha256: hash(largeBytes),
      buildRoot,
    },
    provenanceLimit:
      'Supplied frozen publication receipts identify source/version; HTTP alone does not attest a Worker version. Large body hashes are inherited manifest evidence, not newly downloaded hashes.',
    profile: {
      renderer,
      selection: museum2026Only
        ? 'museum-2026-cold-warm'
        : 'lab-and-museum-2022',
      viewport: { width: 1280, height: 800 },
      dpr: 1,
      reducedMotion: 'reduce',
      cache:
        'new isolated context cold; same context ordinary reload warm; never disabled',
      sampleMs: 8000,
    },
    visits: [],
    errors: [],
    encodedDataBytesObserved: 0,
    limits: [
      'No server CPU measurements/backend calls; network wall time is not CPU.',
      'Resource counters/JS heap are not native GPU memory proof; no forced GC.',
      'RAF intervals are browser scheduling; hook-frame deltas separately identify rendered frames.',
      museum2026Only
        ? 'Ordinary cold/warm campus visit; no model body materialization or newly computed GLB hash.'
        : 'One cold museum2022 visit only; no warm full-model claim.',
    ],
  };
  const save = () =>
    fs.writeFileSync(
      path.join(out, 'result.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  const launchArgs = ['--enable-precise-memory-info'];
  if (renderer === 'swiftshader')
    launchArgs.push(
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    );
  save();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: launchArgs });
  } catch (error) {
    report.status = 'launch-failed';
    report.failure = String(error);
    save();
    throw error;
  }
  report.browser = browser.version();
  let budgetExceeded = false;
  try {
    for (const scenario of museum2026Only
      ? [null]
      : ['design-studio', 'living-day-studio', null]) {
      const context = await browser.newContext({
        viewport: report.profile.viewport,
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on('pageerror', (e) =>
        report.errors.push({ kind: 'pageerror', message: e.message }),
      );
      page.on('console', (m) => {
        if (m.type() === 'error')
          report.errors.push({ kind: 'console', message: m.text() });
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
      await page.addInitScript(() => {
        performance.setResourceTimingBufferSize(2000);
        window.__alphaLongTasks = [];
        window.__alphaLongTaskSupported =
          PerformanceObserver.supportedEntryTypes.includes('longtask');
        try {
          new PerformanceObserver((list) =>
            window.__alphaLongTasks.push(
              ...list
                .getEntries()
                .map((e) => ({ startTime: e.startTime, duration: e.duration })),
            ),
          ).observe({ type: 'longtask', buffered: true });
        } catch {
          /* Browser support is recorded by the receipt. */
        }
      });
      let active;
      const requests = new Map();
      cdp.on('Network.requestWillBeSent', (e) => {
        if (!active) return;
        const r = {
          id: e.requestId,
          url: e.request.url,
          method: e.request.method,
          type: e.type,
          timestamp: e.timestamp,
        };
        active.requests.push(r);
        requests.set(e.requestId, r);
      });
      cdp.on('Network.requestServedFromCache', (e) => {
        const r = requests.get(e.requestId);
        if (r) r.servedFromCache = true;
      });
      cdp.on('Network.responseReceived', (e) => {
        const r = requests.get(e.requestId);
        if (!r) return;
        const h = e.response.headers;
        const allowed =
          /^(cache-control|etag|content-length|content-encoding|content-range|vary|age|cf-cache-status|last-modified)$/i;
        Object.assign(r, {
          status: e.response.status,
          protocol: e.response.protocol,
          fromDiskCache: e.response.fromDiskCache,
          fromServiceWorker: e.response.fromServiceWorker,
          responseTimestamp: e.timestamp,
          timing: e.response.timing,
          headers: Object.fromEntries(
            Object.entries(h).filter(([k]) => allowed.test(k)),
          ),
        });
        const urlPath = new URL(r.url).pathname;
        if (large[urlPath])
          r.expectedLarge = {
            ...large[urlPath],
            evidence:
              'local frozen manifest only; body not hashed by this harness',
          };
      });
      cdp.on('Network.dataReceived', (e) => {
        report.encodedDataBytesObserved += e.encodedDataLength;
        if (
          !budgetExceeded &&
          report.encodedDataBytesObserved > 300 * 1024 * 1024
        ) {
          budgetExceeded = true;
          report.errors.push({
            kind: 'budget',
            message: '300MiB encoded-data ceiling exceeded; stopping, no retry',
          });
          void context.close();
        }
      });
      cdp.on('Network.loadingFinished', (e) => {
        const r = requests.get(e.requestId);
        if (r)
          Object.assign(r, {
            finishedTimestamp: e.timestamp,
            encodedDataLength: e.encodedDataLength,
          });
      });
      cdp.on('Network.loadingFailed', (e) => {
        const r = requests.get(e.requestId);
        if (r) Object.assign(r, { failed: e.errorText, cancelled: e.canceled });
      });
      for (const temperature of scenario || museum2026Only
        ? ['cold', 'warm']
        : ['cold']) {
        active = {
          scenario:
            scenario ?? (museum2026Only ? 'museum-2026' : 'museum-2022'),
          temperature,
          startedAtUtc: new Date().toISOString(),
          requests: [],
        };
        report.visits.push(active);
        requests.clear();
        save();
        const started = performance.now();
        const url = new URL(
          scenario
            ? `/lab?scenario=${scenario}`
            : museum2026Only
              ? '/'
              : '/studio/2022',
          base,
        ).href;
        if (temperature === 'warm')
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
        else
          await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 90000,
          });
        active.domContentLoadedWallMs = performance.now() - started;
        await page.waitForFunction(
          (isLab) =>
            isLab ? window.__marsEngine?.ready : window.__marsStudio?.ready,
          !!scenario,
          { timeout: 90000 },
        );
        active.hookReadyWallMs = performance.now() - started;
        if (scenario) {
          await page.waitForFunction(
            () => window.__marsEngine.backdropReady,
            null,
            { timeout: 45000 },
          );
          if (scenario === 'design-studio')
            await page.waitForFunction(
              () =>
                window.__marsEngine.workstationAppearances()[0]?.status ===
                'ready',
              null,
              { timeout: 45000 },
            );
        } else {
          assert.equal(
            await page.evaluate(() => window.__marsStudio.year),
            museum2026Only ? 2026 : 2022,
            'Wrong museum year loaded',
          );
          await page.waitForFunction(
            () =>
              !!document.querySelector('.studio canvas')?.dataset.pixelRatio,
            null,
            { timeout: 90000 },
          );
        }
        active.assetsReadyWallMs = performance.now() - started;
        await page.waitForLoadState('networkidle', { timeout: 30000 });
        active.networkIdleWallMs = performance.now() - started;
        active.ready = await snapshot(page, !!scenario);
        if (scenario)
          assert.equal(
            active.ready.state.scenario,
            scenario,
            'Wrong scenario loaded',
          );
        // Hash only small already-fetched JS responses; never request or materialize GLB bodies.
        for (const r of active.requests.filter(
          (r) => r.type === 'Script' && new URL(r.url).origin === base.origin,
        )) {
          const pathname = new URL(r.url).pathname;
          const local = path.resolve(buildRoot, `.${pathname}`);
          if (
            !local.startsWith(`${buildRoot}${path.sep}`) ||
            !fs.existsSync(local) ||
            fs.statSync(local).size > 2 * 1024 * 1024
          )
            continue;
          const bytes = fs.readFileSync(local);
          r.localBuild = { bytes: bytes.length, sha256: hash(bytes) };
          try {
            const response = await cdp.send('Network.getResponseBody', {
              requestId: r.id,
            });
            const actual = Buffer.from(
              response.body,
              response.base64Encoded ? 'base64' : 'utf8',
            );
            r.decodedResponse = { bytes: actual.length, sha256: hash(actual) };
            assert.equal(
              r.decodedResponse.sha256,
              r.localBuild.sha256,
              `Served script differs from supplied frozen build: ${pathname}`,
            );
          } catch (e) {
            if (e.code === 'ERR_ASSERTION') throw e;
            r.bodyHashUnavailable = String(e);
          }
        }
        assert(
          active.requests.some((r) => r.localBuild && r.decodedResponse),
          'No exact served script/build hash could be verified',
        );
        if (scenario && temperature === 'warm') {
          await page.evaluate(() => window.__marsEngine.pause(true));
          active.paused = await sample(page, true);
          assert.equal(
            active.paused.end.state.tick,
            active.paused.start.state.tick,
            'Paused world advanced ticks',
          );
          assert(
            active.paused.hookFrameDelta > 0,
            'Paused view rendered no frames',
          );
          await page
            .getByRole('button', {
              name:
                scenario === 'design-studio'
                  ? 'Start notes'
                  : 'Start connected day',
              exact: true,
            })
            .click();
          await page.getByRole('button', { name: 'Play', exact: true }).click();
          active.play = await sample(page, true);
          assert(
            active.play.end.state.tick > active.play.start.state.tick,
            'Actual Play did not advance fixed ticks',
          );
          await page
            .getByRole('button', { name: 'Pause', exact: true })
            .click();
          if (scenario === 'design-studio') {
            // Fresh same world baseline; retain the existing strict counter ceiling.
            await page
              .getByRole('button', { name: 'Reset', exact: true })
              .click();
            await appearanceReady(page);
            const baseline = await snapshot(page, true);
            active.resets = { baseline, samples: [] };
            for (let i = 0; i < 3; i++) {
              await page
                .getByRole('button', { name: 'Reset', exact: true })
                .click();
              await appearanceReady(page);
              const s = await snapshot(page, true);
              active.resets.samples.push(s);
              assert(
                s.renderer.geometries <= baseline.renderer.geometries,
                'Reset geometry count exceeded baseline',
              );
              assert(
                s.renderer.textures <= baseline.renderer.textures,
                'Reset texture count exceeded baseline',
              );
              assert.deepEqual(s.violations, []);
            }
            active.resets.scope =
              'Ordinary public resets; no delayed interception. Existing delayed-load regression remains separate and unchanged.';
          }
        } else if (!scenario) active.static = await sample(page, false);
        active.final = await snapshot(page, !!scenario);
        if (scenario) {
          assert.equal(active.final.error, '');
          assert.deepEqual(active.final.violations, []);
        }
        await page.screenshot({
          path: path.join(out, `${active.scenario}-${temperature}.png`),
        });
        fs.writeFileSync(
          path.join(out, `${active.scenario}-${temperature}.a11y.txt`),
          await page.locator('body').ariaSnapshot(),
        );
        active.finishedAtUtc = new Date().toISOString();
        save();
      }
      await context.close();
    }
    assert.deepEqual(
      report.errors,
      [],
      'Page/console/budget errors; inspect receipt',
    );
    report.status = 'observed';
  } catch (error) {
    report.status = 'failed';
    report.failure = String(error);
    throw error;
  } finally {
    await browser.close();
    report.finishedAtUtc = new Date().toISOString();
    save();
    console.log(
      `Observation receipt: ${path.join(out, 'result.json')} (${report.status})`,
    );
  }
}

async function appearanceReady(page) {
  await page.waitForFunction(
    () => window.__marsEngine.workstationAppearances()[0]?.status === 'ready',
  );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

async function snapshot(page, lab) {
  return page.evaluate((isLab) => {
    const h = isLab ? window.__marsEngine : window.__marsStudio;
    const canvas = document.querySelector(
      isLab ? '.lab-stage canvas' : '.studio canvas',
    );
    const gl = canvas?.getContext('webgl2');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      at: performance.now(),
      frames: h.frames,
      renderer: h.info(),
      state: isLab ? h.state() : null,
      violations: isLab ? h.violations() : null,
      error: isLab ? h.error : null,
      heap: performance.memory
        ? {
            usedJSHeapSize: performance.memory.usedJSHeapSize,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
            jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
          }
        : null,
      gpu: debug
        ? {
            vendor: gl.getParameter(debug.UNMASKED_VENDOR_WEBGL),
            renderer: gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
          }
        : null,
      navigation: performance
        .getEntriesByType('navigation')
        .map((e) => e.toJSON()),
      resources: performance
        .getEntriesByType('resource')
        .map((e) => e.toJSON()),
      longTasks: window.__alphaLongTasks,
      longTaskSupported: window.__alphaLongTaskSupported,
      userAgent: navigator.userAgent,
      dpr: devicePixelRatio,
      resourceTimingLimit:
        'Cross-origin/TAO and cache restrictions may report zero sizes; CDP cache fields are recorded separately.',
    };
  }, lab);
}

async function sample(page, lab) {
  const start = await snapshot(page, lab);
  const intervals = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const values = [];
        const begin = performance.now();
        let previous;
        function frame(t) {
          if (previous !== undefined) values.push(t - previous);
          previous = t;
          if (t - begin >= 8000) resolve(values);
          else requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      }),
  );
  const end = await snapshot(page, lab);
  const sorted = [...intervals].sort((a, b) => a - b);
  return {
    start,
    end,
    rafIntervalsMs: intervals,
    medianMs: sorted[Math.floor(sorted.length * 0.5)],
    p95Ms:
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    hookFrameDelta: end.frames - start.frames,
    longTasksInWindow: (end.longTasks ?? []).filter(
      (e) => e.startTime >= start.at && e.startTime <= end.at,
    ),
  };
}
