// Route aliases only. Requests keep their method, body, headers and streaming transport.
// Registry entries retain one canonical slug and bounded old slugs; no second world is created.
export function canonicalRequest(path, base, registry) {
  let rel = path === base ? '/' : base && path.startsWith(base + '/') ? path.slice(base.length) : base ? null : path;
  for (const old of registry.legacyBases) {
    if (old !== base && (path === old || path.startsWith(old + '/'))) { rel = path.slice(old.length) || '/'; break; }
  }
  if (rel === null) return null;
  const match = /^(\/w\/|\/__sim\/worlds\/)([a-z][a-z0-9-]{0,31})(?=\/|$)/.exec(rel);
  if (match) {
    const slug = registry.resolveSlug(match[2]);
    if (slug) rel = match[1] + slug + rel.slice(match[0].length);
  }
  return base + rel;
}
