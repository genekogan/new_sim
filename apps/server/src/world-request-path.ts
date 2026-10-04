// Shared by the actual HTTP/WS entry point and local producer fixtures.
// Retain historical aliases and the reserved Mars lab paths; PM owns retirement.
export function stripWorldRequestPath(url: string | undefined, worldPath: string) {
  if (!url || /^\/w\/mars\/202[0-7](?:[/?]|$)/.test(url)) return url;
  if (url === worldPath) return '/';
  return url.startsWith(worldPath + '/') ? url.slice(worldPath.length) : url;
}
