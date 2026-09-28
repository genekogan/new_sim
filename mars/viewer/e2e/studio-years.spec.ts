import { test, expect } from '@playwright/test';
import {
  captureView,
  collectConsoleErrors,
  expectCanvasNotBlank,
  lookAt,
  openStudio,
  readPerf,
  waitFrames,
  writeArtifact,
} from './helpers';

const YEARS = [2026, 2020, 2021, 2022, 2023, 2024, 2025] as const;
const label = (year: number) => (year === 2026 ? 'studio' : `studio-${year}`);

for (const year of YEARS) {
  test(`${label(year)}: loads cleanly, default + plan views match baselines`, async ({ page }, testInfo) => {
    const errors = collectConsoleErrors(page);
    await openStudio(page, year);
    await expectCanvasNotBlank(page);
    await captureView(page, `${label(year)}-default`, { testInfo });

    await page.getByRole('button', { name: 'Plan view ↑' }).click();
    await waitFrames(page, 3);
    await captureView(page, `${label(year)}-plan`, { testInfo });

    expect(errors, 'console/page errors').toEqual([]);
  });
}

// Framed views of the recent photographic corrections (app/history/
// photographic-corrections.ts and scenes.ts). Camera poses in scene metres.
const CORRECTIONS: { year: number; name: string; position: number[]; target: number[] }[] = [
  // Two parallel wings with a bare corridor and draped aluminet, seen down the aisle from the south.
  { year: 2021, name: 'corridor-aluminet', position: [2, 13, 30], target: [0, 2.5, 0] },
  // Four rotated buildings around the courtyard: high oblique shows the open corners.
  { year: 2022, name: 'courtyard', position: [20, 34, 24], target: [0, 0, 0] },
  // Front (2026-09-29 edit): vertical inset with straight stairs, leaning PV (left) / plexiglass (right) flaps.
  { year: 2024, name: 'frontage', position: [0, 6.5, 30], target: [0, 3.2, 6] },
  // Eye level (1.6 m above the −0.16 ground) inside the 2020 tire ring, looking at its east-end arc: the tires lie on the ground (§15).
  { year: 2020, name: 'ring-edge', position: [46.5, 1.44, -4.5], target: [51, -0.1, -9] },
  // Eye level on the door axis, framed like evidence/2024-chiba-facade-front-vertical-inset-stairs-plexiglass.webp.
  { year: 2024, name: 'front-eye', position: [0, 1.6, 24], target: [0, 2.4, 5.5] },
  // Through the right flap's plexiglass panes into the solarium (2x4 lattice, rack frames, end wall + open door).
  { year: 2024, name: 'solarium', position: [7.2, 2.9, 9.6], target: [9.0, 1.1, 5.0] },
  // The solarium's end: plexiglass wall on 2x4 studs with its door standing open (the first door object).
  { year: 2024, name: 'solarium-door', position: [16.5, 1.8, 10.5], target: [10.9, 1.5, 6.0] },
];

for (const c of CORRECTIONS) {
  test(`studio-${c.year}: framed ${c.name} view`, async ({ page }, testInfo) => {
    const errors = collectConsoleErrors(page);
    await openStudio(page, c.year);
    await lookAt(page, c.position, c.target);
    await captureView(page, `studio-${c.year}-${c.name}`, { testInfo });
    expect(errors).toEqual([]);
  });
}

test('perf snapshot: renderer.info and JS heap per year', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  const perf: Record<string, unknown> = {};
  for (const year of YEARS) {
    const started = Date.now();
    await openStudio(page, year);
    const loadMs = Date.now() - started;
    perf[label(year)] = { loadMs, ...(await readPerf(page)) };
  }
  const file = writeArtifact('perf.json', {
    run: process.env.E2E_RUN,
    viewport: page.viewportSize(),
    note: 'SwiftShader software WebGL; renderer.info.render reflects the last frame, default camera.',
    years: perf,
  });
  console.log(`perf written to ${file}`);
  expect(errors).toEqual([]);
});
