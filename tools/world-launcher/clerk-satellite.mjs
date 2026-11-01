import { createHash } from 'node:crypto';
/** Public satellite settings only; never reads an authentication file. */
export function satelliteSettings(domain, signInUrl, publicOrigin, legacyDomains) {
  if (!domain && !signInUrl && !legacyDomains) return undefined;
  const fail = () => { throw new Error('launcher: --clerk-satellite and --clerk-sign-in-url require a satellite hostname matching --public-origin and an https primary sign-in URL'); };
  if (typeof domain !== 'string' || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) fail();
  let primary; try { primary = new URL(signInUrl); } catch { fail(); }
  if (publicOrigin !== `https://${domain}` || primary.protocol !== 'https:' || primary.username || primary.password || primary.search || primary.hash || primary.origin === publicOrigin) fail();
  const legacy = legacyDomains === undefined ? [] : typeof legacyDomains === 'string' ? legacyDomains.split(',').map(s => s.trim()) : [];
  if (legacyDomains !== undefined && (!legacy.length || legacy.length > 4 || legacy.some(d => !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(d) || `https://${d}` === primary.origin || d === domain))) fail();
  return { domain, signInUrl: primary.href, ...(legacy.length ? { legacyDomains: [...new Set(legacy)] } : {}) };
}

/** The primary bridge never accepts a return destination outside the configured satellite. */
export function satelliteReturnUrl(value, domain, legacyDomains = []) {
  if (!value) return `https://${domain}/`;
  let url; try { url = new URL(value); } catch { return null; }
  if (![domain, ...legacyDomains].some(d => url.origin === `https://${d}`) || url.username || url.password) return null;
  // Old links finish on the canonical satellite, even after the old Clerk satellite is removed.
  url.host = domain;
  return url.href;
}
const literal = value => JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
const attribute = value => '"' + value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') + '"';

/** Clerk SDKs can carry redirect options in the query or the hash router. Validate both before Clerk loads. */
export function primaryReturnTarget(search, hash, domain, legacyDomains = []) {
  const params = [new URLSearchParams(search), new URLSearchParams(hash.slice(hash.indexOf('?') + 1))];
  let target = `https://${domain}/`;
  const keys = ['redirect_url', 'sign_in_force_redirect_url', 'sign_up_force_redirect_url', 'sign_in_fallback_redirect_url', 'sign_up_fallback_redirect_url', 'after_sign_in_url', 'after_sign_up_url', '__clerk_satellite_url'];
  for (const part of params) for (const key of keys) for (const value of part.getAll(key)) {
    const safe = satelliteReturnUrl(value, domain, legacyDomains);
    if (!safe) return null;
    if (key === 'redirect_url' || key === 'sign_in_force_redirect_url') target = safe;
  }
  return target;
}

/** Independent primary sign-in document: can be proxied beside a frozen primary app. */
export function primarySignInPage(auth, search) {
  const satellite = auth?.clerkSatellite;
  if (!satellite || !primaryReturnTarget(search, '', satellite.domain, satellite.legacyDomains)) return null;
  const primary = new URL(satellite.signInUrl);
  const config = { primaryOrigin: primary.origin, signInUrl: satellite.signInUrl, domain: satellite.domain, legacyDomains: satellite.legacyDomains ?? [], satelliteOrigin: `https://${satellite.domain}` };
  const source = `${auth.clerkIssuer}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`;
  const script = `
(async () => {
  const config = ${literal(config)}, root = document.getElementById('sign-in');
  const satelliteReturnUrl = ${satelliteReturnUrl.toString()};
  const primaryReturnTarget = ${primaryReturnTarget.toString()};
  if (location.origin !== config.primaryOrigin) { root.textContent = 'Open this sign-in page on the primary site.'; return; }
  const target = primaryReturnTarget(location.search, location.hash, config.domain, config.legacyDomains);
  if (!target) { root.textContent = 'This sign-in return address is not allowed.'; return; }
  try {
    await Clerk.load({ signInUrl: config.signInUrl, allowedRedirectOrigins: [config.satelliteOrigin, ...config.legacyDomains.map(d => 'https://' + d)], signInForceRedirectUrl: target, signUpForceRedirectUrl: target });
    if (Clerk.session) { location.replace(target); return; }
    root.textContent = '';
    Clerk.mountSignIn(root, { routing: 'hash', forceRedirectUrl: target, signUpForceRedirectUrl: target });
  } catch { root.textContent = 'Sign-in could not load. Please reload to try again.'; }
})();
`;
  const hash = createHash('sha256').update(script).digest('base64');
  return { html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Sign in to Souls</title></head><body><main id="sign-in">Loading sign-in…</main><script crossorigin="anonymous" data-clerk-publishable-key=${attribute(auth.clerkPublishableKey)} src=${attribute(source)}></script><script>${script}</script></body></html>`,
    // Clerk's identity providers and verification frames use HTTPS. Inline code is pinned to this document.
    csp: `default-src 'none'; script-src ${auth.clerkIssuer} https://challenges.cloudflare.com https://*.protect.clerk.com https://static.cloudflareinsights.com 'sha256-${hash}'; worker-src 'self' blob:; connect-src https:; img-src https: data:; style-src https: 'unsafe-inline'; font-src https: data:; frame-src https:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'` };
}
