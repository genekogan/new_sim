// Example --steps module for record.mjs. Copy it under .e2e/ (gitignored), not into the repo.
// Drive the changed journey with real input at real speed; do not add sleeps to pad the clip.
export default async function steps(page, { viewport, mark }) {
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 30_000 });
  mark('world visible');
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw Error('no canvas box');
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  if (viewport === 'phone') {
    await page.touchscreen.tap(cx, cy);                     // a real tap on the scene
  } else {
    await page.mouse.move(cx, cy);
    await page.mouse.down(); await page.mouse.move(cx + 160, cy, { steps: 20 }); await page.mouse.up();   // orbit
    await page.mouse.click(cx, cy);
  }
  mark('interacted');
  await page.waitForTimeout(1500);                          // let the result render on camera
}
