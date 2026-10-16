// knowledge/1: keep places secret from the Souls of this world.
//   secret                      list the secret places
//   secret <place>              mark a place secret (its id, e.g. g-hidden-grove, or its name, e.g. hidden-grove)
//   secret <place> off          make it public again
// A secret place (and everything inside it) is on no Soul's map, offer or name lookup until that Soul has been inside it
// or found it by looking around close by. It is still drawn: secrecy hides the name, not the thing.
import { call, ok } from './state.mjs';
export const SECRET_HELP = 'secret:  secret (list) · secret <place> [off] — a secret place is on no Soul\'s map until that Soul has been inside or found it by looking around';
export async function secret(place, onOff) {
  if (!place) return ok(await call('/v1/god/places/secret'), 'secret');
  if (onOff !== undefined && !['on', 'off'].includes(onOff)) throw new Error('secret <place> [on|off]');
  const tries = [place, ...(/^g-/.test(place) ? [] : [`g-${place.toLowerCase().replace(/\//g, '.').replace(/[^a-z0-9._-]+/g, '-')}`])];
  let last;
  for (const p of tries) { last = await call('/v1/god/places/secret', { method: 'POST', body: { place: p, secret: onOff !== 'off' } }); if (last.status !== 404) break; }
  return ok(last, 'secret');
}
