// Item ids and the alias table (CATALOG-PROGRAM (a) "Identity and versioning"; P0 "the core/* → eden/* alias").
// Worlds and god scripts keep using core/<x>@1 (and stored refs core-<x>@1); the catalogue names the same thing
// eden/<x>@1 (or lm/<x>@1, mars/<x>@1 for the packs). The engine resolves both (WorldModel.def via aliasRef).
import { aliasRef } from '@sim/world-compiler';

/** core-lm-ada → lm/ada, core-mars-mimos → mars/mimos, core-cafe → eden/cafe. */
export function idOf(defName: string): string {
  const n = defName.replace(/^core-/, '');
  const m = /^(lm|mars)-(.+)$/.exec(n);
  return m ? `${m[1]}/${m[2]}` : `eden/${n}`;
}
export const namespaceOf = (id: string) => id.slice(0, id.indexOf('/'));
/** Old refs that must keep resolving to an item. */
export function aliasesOf(defName: string, major: number): string[] { const n = defName.replace(/^core-/, ''); return [`core/${n}@${major}`, `core-${n}@${major}`]; }
/** An item ref as the engine stores it (core-<x>@v): proves the alias is total and reversible. */
export function engineRefOf(id: string, major: number): string { return aliasRef(`${id}@${major}`).replace(/^core\//, 'core-'); }
