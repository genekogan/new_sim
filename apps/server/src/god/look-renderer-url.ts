const loopbackMessage = 'Configure a 127.0.0.1 HTTP URL for the world renderer.';

function loopbackUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(loopbackMessage); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash) {
    throw new Error(loopbackMessage);
  }
  return url;
}

/** Production context HTML uses the launcher's asset base (e.g. /worlds/assets).
 * Its child serves only /assets, so load that unchanged HTML through the launcher.
 * Both inputs are host configuration, never a public URL or request header. */
export function rendererWorldUrl(worldUrl: string, context: boolean, siteUrl?: string): URL {
  const world = loopbackUrl(worldUrl);
  if (!context || siteUrl === undefined) return world;
  const site = loopbackUrl(siteUrl), base = site.pathname.replace(/\/$/, ''), prefix = `${base}/w/`;
  const slug = world.pathname.slice(prefix.length).replace(/\/$/, '');
  // Match the launcher's configured base contract, including the root launcher.
  if ((base && !/^\/[a-z][a-z0-9-]{0,31}$/.test(base)) || !world.pathname.startsWith(prefix) || !slug || slug.includes('/')) {
    throw new Error('Configure the launcher base matching the context renderer world path.');
  }
  // Assign the validated authority rather than resolving a path as a relative URL:
  // a malformed leading // path must never acquire a different hostname.
  world.host = site.host;
  return world;
}
