type SignOutClient = { signOut(callback: () => void): Promise<void> };
type ReturnBrowser = { location: Pick<Location, 'href' | 'reload' | 'assign'>; history: Pick<History, 'state' | 'replaceState'> };

/** Complete Clerk's cleanup, then reload same-document returns so sign-in starts with fresh UI state. */
export async function signOutAndReturn(clerk: SignOutClient, returnUrl?: string, browser: ReturnBrowser = window): Promise<void> {
  const here = browser.location;
  const target = new URL(returnUrl ?? here.href, here.href);
  // The callback suppresses Clerk's default navigation. Wait for its session/cookie cleanup before returning.
  await clerk.signOut(() => {});
  const current = new URL(here.href);
  if (target.origin === current.origin && target.pathname === current.pathname && target.search === current.search) {
    if (target.href !== current.href) browser.history.replaceState(browser.history.state, '', target.href);
    here.reload();
  } else here.assign(target.href);
}
