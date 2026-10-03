import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve('.pw-browsers');
const { chromium } = await import('@playwright/test');
const policy = process.argv[2] || 'clear',
  out = path.resolve(
    'e2e/artifacts',
    `codex-autonomous-camera-replay-${policy}`,
  );
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
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(
    `http://127.0.0.1:5593/app/camera-lab/replay.html?policy=${policy}`,
  );
  await page.waitForFunction(() => window.__cameraReplay?.ready);
  await page.evaluate(() => window.__cameraReplay.play());
  await page.waitForFunction(
    () => window.__cameraReplay.state().time >= 70,
    {},
    { timeout: 90000 },
  );
  await page.screenshot({ path: path.join(out, 'end.png') });
  writeFileSync(
    path.join(out, 'proof.json'),
    JSON.stringify({
      policy,
      live: false,
      scenario: 'actual recorded classroom + synthetic camera occluder58–64s',
      branch: 'codex/autonomous-camera',
      commit: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      errors,
    }),
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
