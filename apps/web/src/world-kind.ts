// Old worlds vs new worlds in one frontend (reconciliation with main e8, docs/god/MERGE-GUIDE.md).
// Old worlds: the root-path /w/eden, /w/mars, /w/littlemartians (and the toy). They keep main's (e8) behaviour exactly.
// New worlds: anything made with "New world" — served under a prefix (BASE, e.g. /worlds) or under a key that is not
// one of the old ones (local dev worlds at the root). The server's matching switch is config.worldEngine
// (apps/server/src/config.ts: every key outside KNOWN_WORLD_KEYS). Every world-engine delta in the shared frontend
// files (Shell, main, LiveWorld, auth-ui, world-discovery) is gated on this.
import { BASE } from './base-path.ts';
import { worldKey } from './world-path.ts';
import { OLD_WORLD_KEYS } from './snapshot-prefetch.ts';  // one list: index.html's entry prefetch skips the same worlds
export { OLD_WORLD_KEYS };
// An old world's key is an old world under a prefix too: the operator's forks /worlds/w/{eden,mars,littlemartians} (lane
// FORKS) run main's old-world server (config.worldEngine off); public creation never yields these slugs (registry slugFor).
export const isNewWorld = (_base: string, key: string) => !OLD_WORLD_KEYS.includes(key);
/** This page shows a new (world-engine) world. */
export const newWorld = isNewWorld(BASE, worldKey);
