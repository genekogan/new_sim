// What the swarm gate reads: per-seat place and speech from the world's public Soul page (no owner data, no tokens).
//   GET <base>/v1/edge/public/souls/<soulId> → {self:{placePath:[{id,name,kind}], state, activity},
//     events:[{tick, at, kind:'speech', channel, text, untrusted}] (newest first, last 30; server edge/ledger publicSoul),
//     receipts:[{…, endedAt:{pos:[x,z], heading, …}}] (newest first, last 10)}
// The page has no live position; `pos` is where the newest ended receipt left the body, and each speech line's `pos` is
// where the newest receipt ended by that line's tick (a say/act ends one, so a Soul that walked to the podium and spoke
// reads as there even if it walked off before the next poll). posSource names the receipt.
import { getJson } from '../../observer/world-truth.mjs';

const lc = (s) => String(s ?? '').toLowerCase();
/** at → epoch ms (the ledger stores ms; seconds are tolerated). */
export const atMs = (at) => (typeof at === 'number' ? (at > 1e12 ? at : at > 1e9 ? at * 1000 : null) : Number.isFinite(Date.parse(at)) ? Date.parse(at) : null);

/** placePath names (and ids) match any of room.match, case-insensitively. */
export function inRoom(placePath, room) {
  const names = (placePath ?? []).flatMap((p) => (typeof p === 'string' ? [p] : [p?.name, p?.id])).filter(Boolean).map(lc);
  return (room?.match ?? []).some((m) => names.some((n) => n.includes(lc(m))));
}

/** Where the body was at a tick: endedAt of the newest receipt that ended by then (the say that carried a line ends one),
 *  else of the newest ended receipt when the tick is unknown. → {pos:[x,z], src} | null */
export function posAt(pub, tick = null) {
  const ended = (Array.isArray(pub?.receipts) ? pub.receipts : []).filter((r) => Array.isArray(r?.endedAt?.pos) && r.endedAt.pos.length >= 2);
  const by = Number.isFinite(tick) ? ended.filter((r) => Number.isFinite(r.endedTick) && r.endedTick <= tick + 2).sort((a, b) => b.endedTick - a.endedTick) : ended;
  const r = by[0]; return r ? { pos: [r.endedAt.pos[0], r.endedAt.pos.at(-1)], src: `receipt ${r.id ?? '?'} (${r.capability ?? '?'})` } : null;
}

/** Speech events of one Soul, oldest first: [{atMs, tick, text, channel, pos, posSource}]. */
export function speechOf(pub) {
  return (Array.isArray(pub?.events) ? pub.events : []).filter((e) => e?.kind === 'speech' && typeof e.text === 'string')
    .map((e) => { const p = posAt(pub, e.tick ?? null); return { atMs: atMs(e.at), tick: e.tick ?? null, text: e.text, channel: e.channel ?? null, pos: p?.pos ?? null, posSource: p?.src ?? null }; })
    .sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0) || (a.tick ?? 0) - (b.tick ?? 0));
}

/** Pure projection of the public Soul page. */
export function projectTruth(soulId, pub) {
  const self = pub?.self ?? {};
  const placePath = (self.placePath ?? []).map((p) => (typeof p === 'string' ? p : p?.name ?? p?.id)).filter(Boolean);
  const now = posAt(pub);
  return { soulId, ok: !!pub, place: self.placePath?.[0]?.id ?? null, placePath, posture: self.state ?? null, activity: self.activity ?? null, speech: speechOf(pub), pos: now?.pos ?? null, posSource: now?.src ?? null };
}

/** The real source: soul(soulId) → projection, never throws (ok:false when the page is unreachable). */
export function worldTruth({ base }) {
  const b = String(base).replace(/\/+$/, '');
  return {
    async soul(soulId) {
      const r = await getJson(`${b}/v1/edge/public/souls/${encodeURIComponent(soulId)}`);
      return projectTruth(soulId, r.status === 200 ? r.body : null);
    },
  };
}
