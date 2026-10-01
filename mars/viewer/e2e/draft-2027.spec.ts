import { test, expect } from '@playwright/test';
import { openStudio, expectCanvasNotBlank, collectConsoleErrors, waitReady, waitFrames } from './helpers';

test('2027 draft: open concept renders, editable assemblies and plan view remain usable', async ({page}, testInfo) => {
  const errors = collectConsoleErrors(page);
  const refs=await page.request.get('/history/2027/references.json');
  expect(refs.headers()['content-type']).toContain('application/json');
  expect(await refs.json()).toEqual([]);
  await openStudio(page, 2027);
  await expectCanvasNotBlank(page);
  await expect(page.getByLabel('Campus year')).toHaveValue('2027');
  await expect(page.getByText('2027 · resident concept draft.', {exact:false})).toBeVisible();
  await expect(page.getByRole('button', {name:/MIT gallery · western end/})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('draft-2027-overview.png')});
  await page.getByRole('button', {name:'Plan view ↑',exact:true}).click();
  await waitFrames(page,3);
  await expectCanvasNotBlank(page);
  await page.screenshot({path:testInfo.outputPath('draft-2027-plan.png')});
  expect(errors).toEqual([]);
});

test('2027 presentation draft is selectable and2026 remains default', async ({page}) => {
  const errors=collectConsoleErrors(page);
  await page.goto('/?year=2027'); await waitReady(page);
  await expectCanvasNotBlank(page);
  await page.getByRole('button',{name:/Controls/}).click();
  await expect(page.getByLabel('Year',{exact:true})).toHaveValue('2027');
  await page.getByLabel('Year',{exact:true}).selectOption('2026');
  await expect(page).toHaveURL(/\/$/); await waitReady(page);
  expect(await page.evaluate(()=>window.__marsStudio?.year)).toBe(2026);
  await expectCanvasNotBlank(page);
  expect(errors).toEqual([]);
});
