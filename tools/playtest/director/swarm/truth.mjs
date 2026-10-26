// What the swarm gate reads: per-seat place and speech from the world's public Soul page (no owner data, no tokens).
//   GET <base>/v1/edge/public/souls/<soulId> → {self:{placePath:[{id,name,kind}], state, activity},
//     events:[{tick, at, kind:'speech', channel, text, untrusted}] (newest first, last 30; server edge/ledger publicSoul)}
import { getJson } from '../../observer/world-truth.mjs';

const lc = (s) => String(s ?? '').toLowerCase();
/** at → epoch ms (the ledger stores ms; seconds are tolerated). */
export const atMs = (at) => (typeof at === 'number' ? (at > 1e12 ? at : at > 1e9 ? at * 1000 : null) : Number.isFinite(Date.parse(at)) ? Date.parse(at) : null);

/** placePath names (and ids) match any of room.match, case-insensitively. */
export function inRoom(placePath, room) {
  const names = (placePath ?? []).flatMap((p) => (typeof p === 'string' ? [p] : [p?.name, p?.id])).filter(Boolean).map(lc);
  return (room?.match ?? []).some((m) => names.some((n) => n.includes(lc(m))));
}

/** Speech events of one Soul, oldest first: [{atMs, tick, text, channel}]. */
export function speechOf(pub) {
  return (Array.isArray(pub?.events) ? pub.events : []).filter((e) => e?.kind === 'speech' && typeof e.text === 'string')
    .map((e) => ({ atMs: atMs(e.at), tick: e.tick ?? null, text: e.text, channel: e.channel ?? null }))
    .sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0) || (a.tick ?? 0) - (b.tick ?? 0));
}

/** Pure projection of the public Soul page. */
export function projectTruth(soulId, pub) {
  const self = pub?.self ?? {};
  const placePath = (self.placePath ?? []).map((p) => (typeof p === 'string' ? p : p?.name ?? p?.id)).filter(Boolean);
  return { soulId, ok: !!pub, place: self.placePath?.[0]?.id ?? null, placePath, posture: self.state ?? null, activity: self.activity ?? null, speech: speechOf(pub) };
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
