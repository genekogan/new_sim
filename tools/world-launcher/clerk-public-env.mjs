/** Public deployment override only; never inherits issuer, keys or arbitrary parent variables. */
export function authorizedPartiesOverride(value) {
  if (value === undefined) return undefined;
  const origins = typeof value === 'string' ? value.split(',').map(s => s.trim()) : [];
  if (!origins.length || origins.length > 8 || origins.some(origin => {
    try { const url = new URL(origin); return url.protocol !== 'https:' || url.origin !== origin || !!url.username || !!url.password; }
    catch { return true; }
  })) throw new Error('launcher: CLERK_AUTHORIZED_PARTIES override must contain 1–8 exact HTTPS origins');
  return [...new Set(origins)].join(',');
}
export function publicAuthEnvironment(auth) {
  return auth?.authorizedParties === undefined ? {} : { CLERK_AUTHORIZED_PARTIES: auth.authorizedParties };
}
