import { defineConfig } from '@playwright/test';
import path from 'node:path';

// Browser e2e + visual capture for Mars Studio. See e2e/README.md.
// Browsers live in viewer/.pw-browsers (never ~/Library); the npm scripts set
// PLAYWRIGHT_BROWSERS_PATH, this default covers direct `npx playwright` use.
const viewer = path.resolve(import.meta.dirname, '..');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(viewer, '.pw-browsers');
// One run id shared by the runner and its workers (workers inherit env).
process.env.E2E_RUN ||= new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const VITE_PORT = Number(process.env.E2E_VITE_PORT || 5391);
const SIM_PORT = Number(process.env.MARS_SIMULATION_PORT || 8897);
const withSimulation = process.env.E2E_SIMULATION === '1';

export default defineConfig({
  testDir: '.',
  outputDir: path.join(viewer, 'test-results'),
  // WebGL through SwiftShader is CPU-heavy; serial runs keep frames stable.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${VITE_PORT}`,
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    // Freezes campus life (walkers, breeze, clouds) so frames are repeatable.
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    launchOptions: {
      // Software WebGL: identical pixels on any machine, no GPU needed.
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: [
    {
      command: `npx vite --port ${VITE_PORT} --strictPort`,
      cwd: viewer,
      url: `http://127.0.0.1:${VITE_PORT}/studio`,
      env: { MARS_SIMULATION_PORT: String(SIM_PORT) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    // The studio only talks to the simulation after a room is joined, so it is
    // off by default. E2E_SIMULATION=1 starts the local Durable Object server.
    ...(withSimulation
      ? [
          {
            command: `npx wrangler dev --config simulation/wrangler.jsonc --port ${SIM_PORT} --inspector-port 9337`,
            cwd: viewer,
            url: `http://127.0.0.1:${SIM_PORT}/mcp`,
            env: { WRANGLER_WRITE_LOGS: 'false' },
            reuseExistingServer: false,
            timeout: 120_000,
            ignoreHTTPSErrors: true,
          },
        ]
      : []),
  ],
});
