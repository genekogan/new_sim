// Kind `ride` (OBJECT-CONTRACT-v1 §7): the social face of a native carrier (carrier/1: a balloon basket with
// seats that carries its riders on a route and back). Rider membership is physical: who rides is read from the
// native carrier every time, never stored as object bookkeeping, so the object, channel, observe and capacity can
// never disagree with the bodies. join / leave / start move the body (logged decisions with normal receipts).
// Talking in the air needs nothing here: the basket is an enclosed carrier place, so `say` reaches only riders and
// `converse` works as anywhere else.
import type {ActionCtx, CarrierView, ObjectEvent, ObjectKind, SoulRef, TimeCtx} from './types.ts';

export type RideState = {carrier: string; capacity: number; phase: string; riders: SoulRef[]; seatsFree: number; departsInSeconds: number | null; holding: boolean; flights: number; routeSeconds: number; door: [number, number] | null;
  /** together/1: invited companions the basket keeps a place for and waits for (absent on older objects). */
  keptFor?: SoulRef[]; rowing?: boolean};

const view = (ctx: TimeCtx | ActionCtx, id: string): CarrierView | null => ctx.carrier?.(id) ?? null;
function from(state: RideState, v: CarrierView | null): RideState {
  if (!v) return {...state, phase: 'closed', riders: [], seatsFree: 0, departsInSeconds: null};
  return {carrier: state.carrier, rowing: v.def === 'rowing-punt', capacity: v.capacity, phase: v.phase, holding: v.holding, flights: v.flights, seatsFree: v.seatsFree, routeSeconds: v.route.seconds,
    door: v.door as [number, number] | null, departsInSeconds: v.departsInSeconds, keptFor: (v as {hold?: {for: SoulRef[]}}).hold?.for ?? [],
    riders: v.riders.filter(r => r.soulId && r.phase !== 'leaving').map(r => ({soulId: r.soulId!, name: r.name ?? 'someone'}))};
}
const minutes = (s: number) => s >= 90 ? `about ${Math.round(s / 60)} minutes` : `${Math.round(s)} seconds`;

export const rideKind: ObjectKind<RideState> = {
  kind: 'ride',
  description: 'A native ride for one or two people: balloon flight or rowing punt. Join walks to its boarding point. A balloon join completes when seated; a punt join completes only after its water loop and disembarkation. Both depart automatically after boarding (sooner when full; balloon riders may also start early) and return to their starting point. A punt is open to shore speech; a balloon basket is private. Invite companions with params {"with":["<Soul ID or name>"]}; each independently accepts, and the ride keeps their place for up to 90 seconds. Read the object and receipt to distinguish boarding, travelling, returned and ashore.',
  listed: true,
  roles: [{id: 'rider', relations: [{name: 'shares', to: 'rider'}]}],
  schema: {
    rowing: {type: 'boolean', visibility: 'public'},
    carrier: {type: 'string', visibility: 'public'}, capacity: {type: 'integer', visibility: 'public'}, phase: {type: 'string', visibility: 'public'},
    riders: {type: 'soul[]', visibility: 'public'}, seatsFree: {type: 'integer', visibility: 'public'}, departsInSeconds: {type: 'json', visibility: 'public'},
    holding: {type: 'boolean', visibility: 'public'}, flights: {type: 'integer', visibility: 'public'}, routeSeconds: {type: 'integer', visibility: 'public'}, door: {type: 'json', visibility: 'public'},
    keptFor: {type: 'json', visibility: 'public', description: 'invited companions the basket keeps a place for and waits for'},
  },
  initial(params, ctx) {
    const carrier = String(params.carrier ?? '');
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(carrier)) throw new Error('ride needs params.carrier (a native carrier entity id)');
    return from({carrier, capacity: 0, phase: 'closed', riders: [], seatsFree: 0, departsInSeconds: null, holding: false, flights: 0, routeSeconds: 0, door: null, keptFor: []}, view(ctx, carrier));
  },
  rolesOf: (s, soulId) => s.riders.some(r => r.soulId === soulId) ? ['rider'] : [],
  personal: (s, soulId) => ({riding: s.riders.some(r => r.soulId === soulId)}),
  advance(state, ctx) {
    const next = from(state, view(ctx, state.carrier));
    if (JSON.stringify({...next, departsInSeconds: null}) === JSON.stringify({...state, departsInSeconds: null})) return null;
    const to = next.riders.map(r => r.soulId), events: ObjectEvent[] = [], was = [...new Set([...state.riders.map(r => r.soulId), ...to])];
    if (state.phase !== next.phase && was.length) {
      if (next.phase === 'aloft') events.push({to: was, text: next.rowing ? `You row away from the bank. The water loop takes ${minutes(next.routeSeconds)}; you can talk in the open punt.` : `The balloon lifts off. The flight takes ${minutes(next.routeSeconds)}; you can talk freely in the basket (only riders hear you).`});
      if (next.phase === 'landed' || (state.phase === 'aloft' && next.phase === 'parked')) events.push({to: was, text: next.rowing ? 'The punt has returned to its bank; you are disembarking. Wait for the row receipt and your ashore observation.' : 'The balloon has landed where it started; you step out onto the grass.'});
    }
    if (next.phase === 'boarding' && next.riders.length > state.riders.length) for (const r of next.riders.filter(r => !state.riders.some(o => o.soulId === r.soulId)))
      events.push({to: to.filter(id => id !== r.soulId), text: `${r.name} climbs into ${next.rowing ? 'the punt' : 'the basket'} with you.`, untrusted: true}, {to: [r.soulId], text: (next.keptFor ?? []).length
        ? `You are in ${next.rowing ? 'the punt' : 'the basket'}. It waits for ${(next.keptFor ?? []).map(k => k.name).join(', ')} before departing, and lifts off by itself once they are aboard.` : `You are in ${next.rowing ? 'the punt' : 'the basket'}. It departs in about ${next.departsInSeconds ?? 0} seconds, or now if a rider says start.`, untrusted: true});
    if (!state.holding && next.holding && to.length) events.push({to, text: next.rowing ? 'The punt waits at the bank until its disembarkation point is clear.' : 'The balloon hovers above its landing spot until the ground below is clear.'});
    return {state: next, events};
  },
  actions: {
    join: {
      movesBody:true,
      label: 'Join the ride: board, travel and return (punt receipt includes disembarkation)', roles: 'anyone', reach: 'anywhere', params: {},
      available: (s, ctx) => s.riders.some(r => r.soulId === ctx.soul.soulId) ? {code: 'ride.already-aboard', reason: 'You are already in it.'}
        : s.phase === 'aloft' ? {code: 'ride.departed', reason: s.rowing ? 'It is out on the water; it returns to this bank.' : 'It is in the air; it lands where it started.'}
        : s.phase === 'landed' ? {code: 'ride.landing', reason: 'It has just returned; its riders are stepping out.'}
        : s.phase === 'closed' ? {code: 'ride.closed', reason: 'This ride is not running.'}
        : s.seatsFree < 1 && !(s.keptFor ?? []).some(r => r.soulId === ctx.soul.soulId) ? {code: 'ride.full', reason: (s.keptFor ?? []).length ? `The last place is kept for ${(s.keptFor ?? []).map(r => r.name).join(', ')}.` : 'Every place in this ride is taken.'} : null,
      validate(s, _p, ctx) { return rideKind.actions.join.available!(s, ctx); },
      apply(s, _p, _ctx) {
        return {state: s, result: {boarding: s.carrier}, bodies: [{label: s.rowing ? 'Row the punt loop and disembark' : 'Board the balloon', steps: [
          ...(!s.rowing ? [{verb: 'stand', params: {}}] : []), {verb: 'walk_to', params: {to: s.rowing ? s.door : s.carrier, standoff: s.rowing ? 0 : 2.2}}, {verb: 'mars:carrier_ride', params: {carrier: s.carrier, ...(s.rowing ? {throughReturn: true} : {})}}]}]};
      },
    },
    leave: {
      movesBody:true,
      label: 'Disembark at the boarding point (only while parked)', roles: ['rider'], reach: 'anywhere', params: {},
      available: s => s.phase === 'aloft' ? {code: 'ride.aloft', reason: s.rowing ? 'You are on the water; finish the loop and disembark at the bank.' : 'You are in the air; it lands by itself and you step out then.'} : null,
      validate(s, _p, ctx) { return rideKind.actions.leave.available!(s, ctx); },
      apply(s, _p, ctx) {
        const exit = ctx.carrier?.(s.carrier)?.riders.find(r => r.soulId === ctx.soul.soulId)?.exit ?? s.door;
        return {state: s, result: {leaving: s.carrier}, bodies: [{label: s.rowing ? 'Disembark the punt' : 'Step out of the balloon', steps: [{verb: 'walk_to', params: {to: exit, standoff: 0}}]}]};
      },
    },
    start: {
      movesBody:true,
      label: 'Depart now instead of waiting for more riders', roles: ['rider'], reach: 'anywhere', params: {},
      // r3 quality case 33: a host who forced "start" while the invited companion (who had accepted) was still walking to the
      // basket left them behind (carrier.departed). While a place is kept for an invited companion, it departs by itself.
      available: s => s.rowing ? {code: 'ride.automatic', reason: 'The punt departs automatically after boarding; wait for the rowing receipt.'} : s.phase !== 'boarding' ? {code: 'ride.not-boarding', reason: 'It is not waiting at its boarding point.'}
        : (s.keptFor ?? []).length ? {code: 'ride.keeping-place', reason: `It is keeping a place for ${(s.keptFor ?? []).map(k => k.name).join(', ')} (invited) and departs by itself once they are aboard or the hold ends; starting now would leave them behind. Keep waiting.`} : null,
      validate(s, _p, ctx) { return rideKind.actions.start.available!(s, ctx); },
      apply(s) { return {state: s, result: {departing: s.carrier}, bodies: [{label: s.rowing ? 'Start the rowing loop' : 'Ask the balloon to lift off', steps: [{verb: 'mars:carrier_depart', params: {carrier: s.carrier}}]}]}; },
    },
  },
};
