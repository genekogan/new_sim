// G8 moderation: uploads the world's creator or the site admin has hidden. The server already leaves them
// out of /v1/world/snapshot and 404s their files; this set also stops a later world-diff (or a file still
// in the browser's immutable cache) from drawing one again. Fed by the /v1/world/seq heartbeat.
const hidden = new Set<string>();
let version: string | null = null;
/** True when this content-addressed file is hidden by moderation. */
export function assetHidden(sha: string) { return hidden.has(sha); }
/** The veto state last seen (null until the server says). */
export function moderationVersion() { return version; }
/** Record the server's veto state; returns true when it changed since the last call. */
export function noteModeration(m: { version?: unknown; hidden?: unknown } | null | undefined): boolean {
  if (!m || typeof m.version !== 'string' || !Array.isArray(m.hidden)) return false;
  hidden.clear();
  for (const s of m.hidden) if (typeof s === 'string' && /^[0-9a-f]{64}$/.test(s)) hidden.add(s);
  const changed = version !== null && version !== m.version;
  version = m.version;
  return changed;
}
/** The snapshot's header names the veto state it was filtered with. */
export function noteSnapshotVersion(v: string | null) { if (v) version = v; }
