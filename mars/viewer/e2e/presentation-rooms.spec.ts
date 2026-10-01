import { test, expect } from '@playwright/test';
import { PRESENTATION_ROOMS } from '../app/studio/presentation-rooms';
import {
  captureView,
  collectConsoleErrors,
  expectCanvasNotBlank,
  waitReady,
  waitFrames,
} from './helpers';

for (const year of [2020, 2021, 2022, 2023, 2024, 2025]) {
  test(`alumni ${year}: reviewed room choices show the current source`, async ({
    page,
  }, testInfo) => {
    const errors = collectConsoleErrors(page);
    await page.goto(`/?year=${year}`);
    await waitReady(page);
    const rooms = page.getByLabel('Go inside', { exact: true });
    await expect(rooms.locator('option')).toHaveCount(
      Object.keys(PRESENTATION_ROOMS[year]).length + 1,
    );
    for (const [id] of Object.entries(PRESENTATION_ROOMS[year])) {
      await rooms.selectOption(id);
      await waitFrames(page, 3);
      await expectCanvasNotBlank(page);
      await captureView(page, `presentation-${year}-${id}`, {
        testInfo,
        compare: false,
      });
    }
    expect(errors).toEqual([]);
  });
}
