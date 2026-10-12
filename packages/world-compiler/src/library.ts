// CATRUN (CATALOG-PROGRAM P0, engine fix i): the core kit as ONE process-wide, read-only, content-addressed library.
// Before, GodMode defined all of CORE_KIT into every world's own store at genesis and committed the missing ones on
// every load (~766 defs, 1.6 MB per world). Now a world stores only the defs it uses: WorldModel resolves the rest
// here and adopts a def (pinned by hash) the first time something is placed from it. Old worlds keep every def they
// already store, and their stored hashes always win over the library's.
import type { DefInput, StoredDef } from './schemas.ts';
import { hashOf } from './hash.ts';
import { WorldModel, type DefLibrary } from './model.ts';
import { CORE_KIT } from './core-kit.ts';

/** Build a library from def/1 inputs exactly as a world would have stored them (by 'core', born 0). */
export function buildLibrary(id: string, inputs: DefInput[]): DefLibrary {
  const scratch = new WorldModel({ constants: { ground: 'land', extent: 1000 }, seed: `library:${id}` });
  for (const d of inputs) scratch.defineDef(d, 'core', 0);
  const byKey = scratch.defs;   // name@v, core/<x>@v, sha:<hash>
  const all = Object.freeze([...new Set(byKey.values())].sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)));
  const version = hashOf(all.map((d) => d.hash)).slice(0, 16);
  return Object.freeze({ id, version, get: (key: string) => byKey.get(key), all: () => all });
}

let core: DefLibrary | null = null;
/** The shared core library for this process (built on first use, ~0.1 s). */
export function coreLibrary(): DefLibrary { return (core ??= buildLibrary('core', CORE_KIT)); }
/** A ref string for logs and the god snapshot: which library a world resolves through. */
export const libraryRef = (l: DefLibrary) => `${l.id}@${l.version}`;
/** Every def a world stores itself that the library also has under the same ref but another hash (a pinned older rev). */
export function pinnedOlder(model: WorldModel, lib: DefLibrary): StoredDef[] {
  return [...new Set(model.defs.values())].filter((d) => { const l = lib.get(d.ref); return !!l && l.hash !== d.hash; });
}
