// Runtime footage, not generated video. Run from viewer with a camera-owned Vite server.

import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve('.pw-browsers');
const { chromium } = await import('@playwright/test');
const mode = process.argv[2] || 'baseline';
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
const branch = execFileSync('git', ['branch', '--show-current'], {
  encoding: 'utf8',
}).trim();
const out = path.resolve('e2e/artifacts', `codex-autonomous-camera-${mode}`);
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
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: out, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:5593/lab?scenario=classroom-4');
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(() =>
    window.__marsEngine.runScenario('classroom-4', { paused: true }),
  );
  await page
    .getByRole('button', { name: 'Start session', exact: true })
    .click();
  await page.evaluate(() => {
    for (
      let i = 0;
      i < 2400 &&
      window.__marsEngine.classroom().session?.phase !== 'presenting';
      i++
    )
      window.__marsEngine.step();
    window.__marsEngine.setSpeed(0.5);
    window.__marsEngine.pause(false);
  });
  if (mode !== 'baseline')
    await page.evaluate(
      async (policy) => {
        const { attachLabCamera } =
          await import('/cinematography/lab-driver.ts');
        window.__cameraReview = attachLabCamera(window.__marsEngine, policy);
      },
      mode.startsWith('restrained') ? 'restrained' : 'clear',
    );
  await page.evaluate(
    ({ mode, commit, branch }) => {
      const label = document.createElement('div');
      label.textContent = `LIVE · ${mode} · classroom-4 · ${branch} · ${commit.slice(0, 7)} · hypothetical · dense views may obstruct`;
      Object.assign(label.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        right: '0',
        padding: '10px',
        background: '#101820',
        color: 'white',
        zIndex: '10000',
        font: '14px monospace',
      });
      document.body.append(label);
    },
    { mode, commit, branch },
  );
  await page.waitForTimeout(8000);
  await page.getByRole('button', { name: 'Ask question', exact: true }).click();
  await page.waitForTimeout(8000);
  if (mode !== 'baseline')
    await page.evaluate(() => window.__cameraReview.takeover('guest2', 5));
  await page.waitForTimeout(8000);
  await page
    .getByRole('button', { name: 'Direct to courtyard', exact: true })
    .click();
  await page.waitForTimeout(8000);
  await page
    .getByRole('button', { name: 'Next presenter', exact: true })
    .click();
  await page.waitForTimeout(10000);
  const proof = await page.evaluate(() => ({
    state: window.__marsEngine.state(),
    classroom: window.__marsEngine.classroom(),
    camera: window.__cameraReview?.report(),
  }));
  writeFileSync(
    path.join(out, 'proof.json'),
    JSON.stringify(
      {
        mode,
        live: true,
        scenario: 'classroom-4',
        branch,
        commit,
        errors,
        ...proof,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: path.join(out, 'end.png') });
} finally {
  await context.close();
  await browser.close();
}
const source = await page.video().path();
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-i',
    source,
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
console.log(JSON.stringify({ out, mp4: path.join(out, 'review.mp4'), errors }));
