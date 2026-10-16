// knowledge/1: the world's creator marks places secret (Godmode, behind the god token).
//   GET  /v1/god/places/secret            → {secrets: [{id, name}]}
//   POST /v1/god/places/secret {place, secret}  (place = an id or the place's exact name; secret false = public again)
// A secret place and everything inside it leaves the public map, the boot catalogue, exits, walks and `far` for every
// Soul that has not been inside it or found it by looking around. Its geometry stays drawn.
import type {Context, Hono} from 'hono';
import type {EdgeLedger} from '../ledger/ledger.ts';

export function mountSecretPlaceRoutes(app: Hono, d: {ledger: EdgeLedger; requireGod: (c: Context) => void}) {
  const L = d.ledger, noStore = {'cache-control': 'no-store'};
  app.get('/v1/god/places/secret', c => {d.requireGod(c); return c.json({secrets: L.knowledge.secrets()}, 200, noStore);});
  app.post('/v1/god/places/secret', async c => {
    d.requireGod(c);
    const b = await c.req.json().catch(() => null) as {place?: unknown; secret?: unknown} | null;
    if (!b || typeof b.place !== 'string' || !b.place.trim() || (b.secret !== undefined && typeof b.secret !== 'boolean'))
      return c.json({ok: false, code: 'invalid', message: 'body must be {place: "<id or name>", secret: true|false}'}, 400, noStore);
    const q = b.place.trim(), lq = q.toLowerCase(), all = [...L.places.byId.values()];
    const hits = L.places.byId.has(q) ? [L.places.byId.get(q)!] : all.filter(p => p.parent !== null && p.name.toLowerCase() === lq);
    if (hits.length !== 1) return c.json({ok: false, code: hits.length ? 'place.ambiguous' : 'place.unknown', message: hits.length ? 'several places have that name; use an id' : 'no such place', ...(hits.length ? {ids: hits.map(p => p.id)} : {})}, hits.length ? 409 : 404, noStore);
    const p = hits[0]!; if (p.parent === null) return c.json({ok: false, code: 'place.root', message: 'the whole world cannot be secret'}, 400, noStore);
    L.knowledge.setSecret(p.id, b.secret !== false);
    return c.json({ok: true, place: {id: p.id, name: p.name}, secret: L.knowledge.isSecret(p.id), secrets: L.knowledge.secrets()}, 200, noStore);
  });
}
