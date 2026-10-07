// Kind `ride` (OBJECT-CONTRACT-v1 §7): the social face of a native carrier (carrier/1: a balloon basket with
// seats that carries its riders on a route and back). Rider membership is physical: who rides is read from the
// native carrier every time, never stored as object bookkeeping, so the object, channel, observe and capacity can
// never disagree with the bodies. join / leave / start move the body (logged decisions with normal receipts).
// Talking in the air needs nothing here: the basket is an enclosed carrier place, so `say` reaches only riders and
// `converse` works as anywhere else.
import type {ActionCtx, CarrierView, ObjectEvent, ObjectKind, SoulRef, TimeCtx} from './types.ts';

export type RideState = {carrier: string; capacity: number; phase: string; riders: SoulRef[]; seatsFree: number; departsInSeconds: number | null; holding: boolean; flights: number; routeSeconds: number; door: [number, number] | null};

const view = (ctx: TimeCtx | ActionCtx, id: string): CarrierView | null => ctx.carrier?.(id) ?? null;
function from(state: RideState, v: CarrierView | null): RideState {
  if (!v) return {...state, phase: 'closed', riders: [], seatsFree: 0, departsInSeconds: null};
  return {carrier: state.carrier, capacity: v.capacity, phase: v.phase, holding: v.holding, flights: v.flights, seatsFree: v.seatsFree, routeSeconds: v.route.seconds,
    door: v.door as [number, number] | null, departsInSeconds: v.departsInSeconds,
    riders: v.riders.filter(r => r.soulId && r.phase !== 'leaving').map(r => ({soulId: r.soulId!, name: r.name ?? 'someone'}))};
}
const minutes = (s: number) => s >= 90 ? `about ${Math.round(s / 60)} minutes` : `${Math.round(s)} seconds`;

export const rideKind: ObjectKind<RideState> = {
  kind: 'ride',
  description: 'A ride for a few people (here a hot-air balloon). `join` walks you up to it and you climb in by its boarding step into a free place in the basket; it lifts off by itself a little after the first rider is in (sooner when full, or at once when a rider says `start`), flies its route and lands where it started, and then everyone steps out by themselves. Speech in the basket is heard only by the riders; `converse` works as usual. You cannot leave while it is in the air.',
  listed: true,
  roles: [{id: 'rider', relations: [{name: 'shares', to: 'rider'}]}],
  schema: {
    carrier: {type: 'string', visibility: 'public'}, capacity: {type: 'integer', visibility: 'public'}, phase: {type: 'string', visibility: 'public'},
    riders: {type: 'soul[]', visibility: 'public'}, seatsFree: {type: 'integer', visibility: 'public'}, departsInSeconds: {type: 'json', visibility: 'public'},
    holding: {type: 'boolean', visibility: 'public'}, flights: {type: 'integer', visibility: 'public'}, routeSeconds: {type: 'integer', visibility: 'public'}, door: {type: 'json', visibility: 'public'},
  },
  initial(params, ctx) {
    const carrier = String(params.carrier ?? '');
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(carrier)) throw new Error('ride needs params.carrier (a native carrier entity id)');
    return from({carrier, capacity: 0, phase: 'closed', riders: [], seatsFree: 0, departsInSeconds: null, holding: false, flights: 0, routeSeconds: 0, door: null}, view(ctx, carrier));
  },
  rolesOf: (s, soulId) => s.riders.some(r => r.soulId === soulId) ? ['rider'] : [],
  personal: (s, soulId) => ({riding: s.riders.some(r => r.soulId === soulId)}),
  advance(state, ctx) {
    const next = from(state, view(ctx, state.carrier));
    if (JSON.stringify({...next, departsInSeconds: null}) === JSON.stringify({...state, departsInSeconds: null})) return null;
    const to = next.riders.map(r => r.soulId), events: ObjectEvent[] = [], was = [...new Set([...state.riders.map(r => r.soulId), ...to])];
    if (state.phase !== next.phase && was.length) {
      if (next.phase === 'aloft') events.push({to: was, text: `The balloon lifts off. The flight takes ${minutes(next.routeSeconds)}; you can talk freely in the basket (only riders hear you).`});
      if (next.phase === 'landed' || (state.phase === 'aloft' && next.phase === 'parked')) events.push({to: was, text: 'The balloon has landed where it started; you step out onto the grass.'});
    }
    if (next.phase === 'boarding' && next.riders.length > state.riders.length) for (const r of next.riders.filter(r => !state.riders.some(o => o.soulId === r.soulId)))
      events.push({to: to.filter(id => id !== r.soulId), text: `${r.name} climbs into the basket with you.`, untrusted: true}, {to: [r.soulId], text: `You are in the basket. It lifts off in about ${next.departsInSeconds ?? 0} seconds, or now if a rider says start.`});
    if (!state.holding && next.holding && to.length) events.push({to, text: 'The balloon hovers above its landing spot until the ground below is clear.'});
    return {state: next, events};
  },
  actions: {
    join: {
      label: 'Take a ride: walk to the boarding step and climb into the basket', roles: 'anyone', reach: 'anywhere', params: {},
      available: (s, ctx) => s.riders.some(r => r.soulId === ctx.soul.soulId) ? {code: 'ride.already-aboard', reason: 'You are already in it.'}
        : s.phase === 'aloft' ? {code: 'ride.departed', reason: 'It is in the air; it lands where it started.'}
        : s.phase === 'landed' ? {code: 'ride.landing', reason: 'It has just landed; its riders are stepping out.'}
        : s.phase === 'closed' ? {code: 'ride.closed', reason: 'This ride is not running.'}
        : s.seatsFree < 1 ? {code: 'ride.full', reason: 'Every place in the basket is taken.'} : null,
      validate(s, _p, ctx) { return rideKind.actions.join.available!(s, ctx); },
      apply(s, _p, _ctx) {
        return {state: s, result: {boarding: s.carrier}, bodies: [{label: 'Board the balloon', steps: [
          {verb: 'stand', params: {}}, {verb: 'walk_to', params: {to: s.carrier, standoff: 2.2}}, {verb: 'mars:carrier_ride', params: {carrier: s.carrier}}]}]};
      },
    },
    leave: {
      label: 'Step out of the basket (only on the ground)', roles: ['rider'], reach: 'anywhere', params: {},
      available: s => s.phase === 'aloft' ? {code: 'ride.aloft', reason: 'You are in the air; it lands by itself and you step out then.'} : null,
      validate(s, _p, ctx) { return rideKind.actions.leave.available!(s, ctx); },
      apply(s, _p, ctx) {
        const exit = ctx.carrier?.(s.carrier)?.riders.find(r => r.soulId === ctx.soul.soulId)?.exit ?? s.door;
        return {state: s, result: {leaving: s.carrier}, bodies: [{label: 'Step out of the balloon', steps: [{verb: 'walk_to', params: {to: exit, standoff: 0}}]}]};
      },
    },
    start: {
      label: 'Lift off now instead of waiting for more riders', roles: ['rider'], reach: 'anywhere', params: {},
      available: s => s.phase !== 'boarding' ? {code: 'ride.not-boarding', reason: 'It is not waiting on the ground.'} : null,
      validate(s, _p, ctx) { return rideKind.actions.start.available!(s, ctx); },
      apply(s) { return {state: s, result: {departing: s.carrier}, bodies: [{label: 'Ask the balloon to lift off', steps: [{verb: 'mars:carrier_depart', params: {carrier: s.carrier}}]}]}; },
    },
  },
};
