/** Public launcher configuration. Origins are compared exactly, never inferred from a request's Host. */
export type ClerkSatellite = { domain: string; signInUrl: string };
export function clerkSatelliteOptions(satellite: ClerkSatellite | undefined, currentOrigin: string) {
  if (!satellite || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(satellite.domain) || currentOrigin !== `https://${satellite.domain}`) return {};
  try {
    const primary = new URL(satellite.signInUrl);
    if (primary.protocol !== 'https:' || primary.username || primary.password || primary.search || primary.hash || primary.origin === currentOrigin) return {};
    return { isSatellite: true as const, domain: satellite.domain, signInUrl: primary.href };
  } catch { return {}; }
}
/** Let Clerk add its session-sync parameters; a hand-built primary link loses the satellite handshake. */
export function startClerkSignIn(clerk: { buildSignInUrl(options: { signInForceRedirectUrl: string; signUpForceRedirectUrl: string }): string; openSignIn(options: { afterSignInUrl: string; afterSignUpUrl: string }): void }, satellite: ClerkSatellite | undefined, href: string, navigate: (url: string) => void) {
  if (clerkSatelliteOptions(satellite, new URL(href).origin).isSatellite) {
    navigate(clerk.buildSignInUrl({ signInForceRedirectUrl: href, signUpForceRedirectUrl: href }));
  } else clerk.openSignIn({ afterSignInUrl: href, afterSignUpUrl: href });
}
