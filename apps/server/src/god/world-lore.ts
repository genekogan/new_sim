// F3 (rehearsal item 15): a new world has no Eden lore. The edge's outcomes serve Eden's authored content to every
// world: first-visit lore for any walkable place whose id matches an Eden place ("field" → "The commons is the town's
// broad welcome …") and passages of Eden's library ("A Field Guide to Eden's Gardens") for every completed `read`.
// On a god's world (not eden/mars/littlemartians/toy) this replaces both, on our side of the edge contract:
//   - arriving somewhere for the first time tells a Soul the world's lore once: the god's constitution if one is set,
//     else a short neutral line (outcome detail.firstVisit, source "world-constitution" / "world-new");
//   - reading a god-built sign reads its words; any other read reads the constitution (or the neutral line);
//   - the generic reading offer is labelled as reading the constitution, not "the book you carry".
// It wraps the ledger's outcome store instance (the same pattern the engine bridge uses for `act`); proposed as an edge
// hook for Codex in team/lanes/f3.md ("world content provider"), after which this file shrinks to that provider.
import type { EdgeLedger } from '../edge/ledger/ledger.ts';
import type { GodMode } from './god.ts';
import { signText } from './perceive.ts';

export const NEW_WORLD_LORE = 'A new world, still being made. Nothing here has a history yet: what it becomes is up to its god and the Souls who live in it.';
const WALKS = ['walk', 'stroll', 'go', 'go-near', 'hang-out', 'wander', 'swim'];
const clip = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n);

/* eslint-disable @typescript-eslint/no-explicit-any */
export function installWorldLore(L: EdgeLedger, god: GodMode) {
  const o = L.outcomes as any, db = o.db, worldId: string = o.worldId;
  db.exec('CREATE TABLE IF NOT EXISTS god_lore_visits_v1(world_id TEXT NOT NULL, soul_id TEXT NOT NULL, receipt_id TEXT NOT NULL, PRIMARY KEY(world_id, soul_id)) WITHOUT ROWID');
  const lore = () => {
    const c = String(god.model.state.constitution ?? '').trim();
    return c ? { source: 'world-constitution', text: c.slice(0, 2000) } : { source: 'world-new', text: NEW_WORLD_LORE };
  };
  const terminal = o.terminal.bind(o);
  o.terminal = (receipt: any, snapshot: any, effects: any = {}) => {
    const kind = String(receipt.capability ?? '').split(':')[0];
    let eff = effects;
    if (receipt.phase === 'completed' && WALKS.includes(kind) && snapshot?.pos && !o.read(receipt.id)) {
      const ctx = o.context(receipt.id);
      if (ctx && Number(db.prepare('INSERT OR IGNORE INTO god_lore_visits_v1(world_id, soul_id, receipt_id) VALUES (?,?,?)').run(worldId, ctx.soulId, receipt.id).changes) > 0) {
        const l = lore();
        eff = { ...effects, detail: { ...(effects?.detail ?? {}), firstVisit: { placeId: snapshot.place ?? 'world', tick: snapshot.tick, pos: [...snapshot.pos], source: l.source, lore: l.text, contentVersion: 'world-lore/1' } } };
      }
    }
    // no Eden place lore: an empty place path matches none of it
    return terminal(receipt, snapshot ? { ...snapshot, placePath: [] } : snapshot, eff);
  };
  const libraryRead = typeof o.readPassage === 'function' ? o.readPassage.bind(o) : null;
  o.readPassage = (context: any, out: any) => {
    // E-life: a book taken from a god-built bookcase (a derived reading spot, read:read.<seat>, or reading in a place with
    // shelves, read:g-<place>) on Eden 2026 is a book of the Eden library, as on old Eden; elsewhere it reads the lore
    if (libraryRead && /^read:(?:read\.|g-)/.test(String(context.capability ?? '')) && /^\s*#?\s*Eden\b/.test(String(god.model.state.constitution ?? ''))) return libraryRead(context, out);
    const target = String(context.capability ?? '').slice('read:'.length), e: any = target ? god.model.entities.get(target) : undefined;
    const def = e ? god.model.resolvedDef(e.def) : undefined, words = (e && def ? signText(e, def) ?? '' : '').trim();
    if (words) {
      const name = e.name ? god.model.pathOf(e.id) : 'a sign';
      out.summary = clip(`Read ${name}: "${words}"`, 160);
      out.learned = [{ fact: clip(`${name} reads: ${words}`, 2000), about: e.id, source: `${e.id}:text`, provenance: 'authored-content', untrusted: true }];
      out.untrusted = true;
      out.detail = { ...out.detail, sign: { id: e.id, name }, passage: words, provenance: 'god-authored' };
      return;
    }
    const l = lore();
    out.summary = l.source === 'world-constitution' ? "Read this world's constitution." : 'Read about this world: it is new and has no history yet.';
    out.learned = [{ fact: clip(l.text, 2000), about: 'world', source: l.source, provenance: 'authored-content', untrusted: l.source === 'world-constitution' }];
    out.untrusted ||= l.source === 'world-constitution';
    out.detail = { ...out.detail, book: { id: l.source, title: l.source === 'world-constitution' ? "This world's constitution" : 'About this world' }, passage: l.text, provenance: l.source === 'world-constitution' ? 'god-authored' : 'world' };
  };
  const prev = L.worldProfile;
  L.worldProfile = (soul, caps, plans) => {
    prev?.(soul, caps, plans);
    for (const c of caps) if (c.verb === 'read' && !god.model.entities.get(c.id.slice('read:'.length))) {
      c.label = String(c.label).replace(/the book you carry/i, god.model.state.constitution ? "this world's constitution" : 'about this world');
      const p = plans.get(c.id); if (p) p.label = p.label.replace(/a book/i, god.model.state.constitution ? "this world's constitution" : 'about this world');
    }
  };
  // This wrapper changes read labels only; exact walk cap/plan remain unchanged.
  L.registerExactWalkProfile(L.worldProfile!,prev);
}
