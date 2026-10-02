import { test, expect } from '@playwright/test';
import { openLab } from './lab-helpers.ts';
import { captureView, collectConsoleErrors } from './helpers.ts';
import { SELECTABLE_SCENARIOS } from '../app/lab/scenarios.ts';
import { LAB_SCENARIO_GROUPS } from '../app/lab/scenario-contracts.ts';

test('all shipped registrations are grouped and longer experiences expose real start and intervention instructions', async ({
  page,
}, testInfo) => {
  const errors = collectConsoleErrors(page);
  await openLab(page, 'living-day-4');
  const selector = page.getByRole('combobox', {
    name: 'Scenario',
    exact: true,
  });
  expect(
    await selector
      .locator('option')
      .evaluateAll((options) =>
        options.map((option) => (option as HTMLOptionElement).value).sort(),
      ),
  ).toEqual(SELECTABLE_SCENARIOS.map((scenario) => scenario.name).sort());
  expect(
    await selector
      .locator('optgroup')
      .evaluateAll((groups) =>
        groups.map((group) => (group as HTMLOptGroupElement).label),
      ),
  ).toEqual(LAB_SCENARIO_GROUPS.map((group) => group.title));
  const connected = selector.locator(
    'optgroup[label="Longer connected experiences"]',
  );
  for (const id of [
    'living-day-4',
    'prepared-day-4',
    'room-preparation',
    'communal-supper',
    'garden-circuit',
  ])
    await expect(connected.locator(`option[value="${id}"]`)).toHaveCount(1);
  await page.getByTestId('scenario-contract').locator('summary').click();
  await expect(page.getByTestId('scenario-contract')).toContainText(
    'Start connected day',
  );
  await expect(page.getByTestId('scenario-contract')).toContainText(
    'Global Pause stops the world',
  );
  await page
    .getByRole('button', {
      name: 'Clear, arrange and use a classroom',
      exact: true,
    })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.__marsEngine!.state().scenario))
    .toBe('room-preparation');
  await expect(page.getByTestId('scenario-contract')).toContainText(
    'Start room preparation',
  );
  await expect(
    page.getByRole('button', { name: 'Start room preparation', exact: true }),
  ).toBeEnabled();
  await captureView(page, 'alpha-connected-discovery', {
    testInfo,
    compare: false,
  });
  expect(errors).toEqual([]);
});
