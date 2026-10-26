// Keep the native owner dialog from obstructing this one normal New Soul click.
// It can open after account readiness and after any one-shot visibility check.
export async function clickNewSoulEntry(page, record = () => {}) {
  const godModal = page.locator('[data-god-modal][open]');
  await page.addLocatorHandler(godModal, async () => {
    record('god-dialog');
    await page.keyboard.press('Escape');
    await godModal.waitFor({state: 'hidden'});
  });
  try {
    const entry = page.locator('.bring-agent-open:visible').first();
    record('entry', await entry.evaluate(el => ({tag: el.tagName, href: el.getAttribute('href'),
      currentURL: location.href, godOpen: !!document.querySelector('[data-god-modal][open]')})));
    await entry.click();
  } finally {
    await page.removeLocatorHandler(godModal);
  }
}
