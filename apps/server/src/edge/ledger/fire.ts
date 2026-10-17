// B6: what counts as a campfire Souls can warm themselves by: the old worlds' native `campfire` fixture, or any engine
// fixture with fire-circle places (a god-built core campfire gets them from the catalog adapter, isFireCircleDef).
import {CATALOG} from '../../../../../mars/viewer/engine/world/catalog.ts';

export function isCampfire(e: {def?: string} | undefined): boolean {
  if (!e?.def) return false;
  return e.def === 'campfire' || !!CATALOG[e.def]?.slots?.some(s => s.kind === 'fire-circle');
}
