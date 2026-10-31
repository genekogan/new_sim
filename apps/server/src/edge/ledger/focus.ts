// L3 item 4 (server reliability, 2026-10-31): a focused menu build (`EdgeLedger.bindOne`). Acting on one capability id
// used to rebuild the Soul's whole menu (every walk's route goal, every loop's clear spots, every object's actions) to
// find one offer. A focus names what one build must produce; each section of the menu builder skips the offers no focus
// names, and the sections that read other offers (a gait copies its walk, `sit:here` points at the nearest free seat)
// widen the focus to what they read. Pure: no world access.

import type {EdgeCapability} from '../contract.ts';

/** What a focused build must produce: offers with one of these ids, any offer of these verbs, any offer whose target is
 *  one of these ids. */
export type MenuFocus = {ids: ReadonlySet<string>; verbs: ReadonlySet<string>; targets: ReadonlySet<string>; here?: boolean;
  /** srv-act-words (D): a focused words walk builds only the walk offers `keep` passes (GodNav offerWalk); `sig` names the
   *  test in the focus's cache key. Never set by bindOne/here. */
  walkKeep?: {sig: string; keep: (c: Pick<EdgeCapability, 'id' | 'verb' | 'label' | 'aliases' | 'target'>) => boolean}};

/** True when a section must build this offer (always, without a focus). */
export function wants(f: MenuFocus | null | undefined, id: string, verb?: string, target?: string): boolean {
  return !f || f.ids.has(id) || (!!verb && f.verbs.has(verb)) || (!!target && f.targets.has(target)) || (!!f.here && id.endsWith(':here'));
}

/** True when the focus names any offer of this id family (`object:` ids come from the object providers). */
export function wantsPrefix(f: MenuFocus | null | undefined, prefix: string, verb?: string): boolean {
  if (!f) return true;
  if (verb && f.verbs.has(verb)) return true;
  for (const id of f.ids) if (id.startsWith(prefix)) return true;
  return false;
}

/** A focus as a cache key. */
export function focusSig(f: MenuFocus): string {return `${[...f.ids].sort().join(',')}|${[...f.verbs].sort().join(',')}|${[...f.targets].sort().join(',')}|${f.here ? 1 : 0}${f.walkKeep ? '|keep:' + f.walkKeep.sig : ''}`;}

/** The offers `here` reads (L3 item 4): every `…:here` offer, invitations, every seat, and the offers whose target is one
 *  of `targets` (the places and things around the Soul, the places its exits lead to). */
export function hereFocus(targets: Iterable<string>): MenuFocus {
  const t = new Set(targets), ids = new Set<string>();
  // a gait to a place or a stroll through it copies its walk: their targets are here already; sit:here reads every seat
  return {ids, verbs: new Set(['sit', 'accept', 'decline']), targets: t, here: true};
}

/** The focus that builds `id` exactly as the whole menu would. */
export function focusFor(id: string): MenuFocus {
  const i = id.indexOf(':'), verb = i > 0 ? id.slice(0, i) : id, rest = i > 0 ? id.slice(i + 1) : '';
  const ids = new Set([id]), verbs = new Set<string>(), targets = new Set<string>();
  // a gait or a bicycle ride copies every walk whose target is that place (the world profile's walks too)
  if ((verb === 'jog' || verb === 'run' || verb === 'cycle' || verb === 'stroll') && rest) targets.add(rest);
  // sit:here points at the nearest free seat that is here: every sit offer is read
  if (id === 'sit:here') verbs.add('sit');
  return {ids, verbs, targets};
}

/** The object ids a focus can name (L3 c): `object:<id>:<action>` ids and every target (a place id names no object). */
export function focusObjects(f: MenuFocus): Set<string> {
  const out = new Set(f.targets);
  for (const id of f.ids) if (id.startsWith('object:')) {const j = id.indexOf(':', 7); out.add(j > 0 ? id.slice(7, j) : id.slice(7));}
  return out;
}
