import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve('.pw-browsers');
const { chromium } = await import('@playwright/test');
const name = process.argv[2] || 'varied-baseline',
  out = path.resolve('e2e/artifacts', `codex-autonomous-camera-${name}`);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: out, size: { width: 1280, height: 720 } },
  }),
  page = await context.newPage(),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let failure;
try {
  await page.goto('http://127.0.0.1:5593/app/camera-lab/suite.html');
  await page.waitForFunction(() => window.__cameraSuite?.ready);
  await page.evaluate(() => window.__cameraSuite.play());
  await page.waitForFunction(
    () => window.__cameraSuite.state().time >= 89.99,
    {},
    { timeout: 115000 },
  );
  await page.screenshot({ path: path.join(out, 'end.png') });
  writeFileSync(
    path.join(out, 'proof.json'),
    JSON.stringify(
      {
        live: false,
        branch: execFileSync('git', ['branch', '--show-current'], {
          encoding: 'utf8',
        }).trim(),
        commit: execFileSync('git', ['rev-parse', 'HEAD'], {
          encoding: 'utf8',
        }).trim(),
        errors,
        scenario:
          'six actual engine takes; labeled camera-owned semantic/occlusion fixtures',
        remaining:
          'Dense scenes may force wide/obstructed framing; replay head attention unsupported; no live Jev, no riding.',
      },
      null,
      2,
    ),
  );
} catch (e) {
  failure = e.message;
  writeFileSync(
    path.join(out, 'failed-proof.json'),
    JSON.stringify(
      {
        failure,
        errors,
        state: await page
          .evaluate(() => window.__cameraSuite?.state())
          .catch(() => null),
      },
      null,
      2,
    ),
  );
} finally {
  await context.close();
  await browser.close();
}
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-i',
    await page.video().path(),
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '22',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    path.join(out, 'review.mp4'),
  ],
  { stdio: 'ignore' },
);
console.log(JSON.stringify({ out, errors }));
if (failure) process.exitCode = 1;
