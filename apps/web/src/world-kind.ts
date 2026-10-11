// Old worlds vs new worlds in one frontend (reconciliation with main e8, docs/god/MERGE-GUIDE.md).
// Old worlds: the root-path /w/eden, /w/mars, /w/littlemartians (and the toy). They keep main's (e8) behaviour exactly.
// New worlds: anything made with "New world" — served under a prefix (BASE, e.g. /worlds) or under a key that is not
// one of the old ones (local dev worlds at the root). The server's matching switch is config.worldEngine
// (apps/server/src/config.ts: every key outside KNOWN_WORLD_KEYS). Every world-engine delta in the shared frontend
// files (Shell, main, LiveWorld, auth-ui, world-discovery) is gated on this.
import { BASE } from './base-path.ts';
import { worldKey } from './world-path.ts';

export const OLD_WORLD_KEYS: readonly string[] = ['eden', 'mars', 'littlemartians', 'toy'];
export const isNewWorld = (base: string, key: string) => base !== '' || !OLD_WORLD_KEYS.includes(key);
/** This page shows a new (world-engine) world. */
export const newWorld = isNewWorld(BASE, worldKey);
