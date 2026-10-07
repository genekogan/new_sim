// Ticketed presentation (C8, vision §4 worked object; Gene §13: standby first-come in
// queue order, released at curtain). Times are world ticks. Phases:
//   booking → (doorsOpenAtTick) doors → (startsAtTick, curtain) running → (endsAtTick) ended.
// `reserve` works from anywhere while booking or doors; a full house joins the standby
// queue. `enter` is refused before doors open. A cancelled ticket goes to the head of
// standby at once. At curtain, ticket holders who have not entered forfeit their seats
// and free seats go to standby in queue order. The presenter `addresses` the audience:
// their `say` also reaches every audience member, and `publish` sends materials to the
// audience Role only. Physical seating is not done here (needs a Ledger hook).
import type {ObjectEvent, ObjectKind, SoulRef, TimeCtx} from './types.ts';

export type PresentationState = {title: string; presenter: SoulRef | null; startsAtTick: number; doorsOpenAtTick: number; endsAtTick: number;
  capacity: number; phase: 'booking' | 'doors' | 'running' | 'ended'; ticketsLeft: number; standbyCount: number; released: boolean;
  tickets: SoulRef[]; standby: SoulRef[]; audience: SoulRef[]; materials: string[]};

export const DEFAULT_DOORS_OPEN_TICKS = 6000;   // 5 real minutes at 20 ticks/s
export const DEFAULT_DURATION_TICKS = 3000;     // one in-world hour (72000-tick day)

const has = (list: SoulRef[], id: string) => list.some(s => s.soulId === id);
const without = (list: SoulRef[], id: string) => list.filter(s => s.soulId !== id);
const ids = (list: SoulRef[]) => list.map(s => s.soulId);
function recount(s: PresentationState) { s.ticketsLeft = Math.max(0, s.capacity - s.tickets.length); s.standbyCount = s.standby.length; return s; }

export const presentationKind: ObjectKind<PresentationState> = {
  kind: 'presentation',
  description: 'A ticketed presentation. Reserve a seat from anywhere; doors open shortly before the start; enter in person. If full, you join the standby queue; unclaimed seats go to standby in order at curtain. After you enter, walk in and sit on any free seat in this place yourself (its sit:… capabilities); the presenter\'s speech and published materials reach the audience wherever they sit.',
  listed: true,
  roles: [{id: 'presenter', relations: [{name: 'addresses', to: 'audience'}]}, {id: 'ticket-holder'}, {id: 'standby'}, {id: 'audience'}],
  schema: {
    title: {type: 'string', visibility: 'public'}, presenter: {type: 'soul?', visibility: 'public'},
    startsAtTick: {type: 'integer', visibility: 'public'}, doorsOpenAtTick: {type: 'integer', visibility: 'public'}, endsAtTick: {type: 'integer', visibility: 'public'},
    capacity: {type: 'integer', visibility: 'public'}, phase: {type: 'string', visibility: 'public'},
    ticketsLeft: {type: 'integer', visibility: 'public'}, standbyCount: {type: 'integer', visibility: 'public'}, released: {type: 'boolean', visibility: 'public'},
    tickets: {type: 'soul[]', visibility: ['presenter']}, standby: {type: 'soul[]', visibility: ['presenter']},
    audience: {type: 'soul[]', visibility: ['presenter', 'audience']}, materials: {type: 'string[]', visibility: ['presenter', 'audience']},
  },
  initial(p, ctx) {
    const startsAtTick = Number(p.startsAtTick), capacity = Number(p.capacity);
    if (!Number.isInteger(startsAtTick) || !Number.isInteger(capacity) || capacity < 1) throw new Error('presentation needs integer startsAtTick and capacity >= 1');
    const doors = Number(p.doorsOpenTicks ?? DEFAULT_DOORS_OPEN_TICKS), duration = Number(p.durationTicks ?? DEFAULT_DURATION_TICKS);
    const presenter = typeof p.presenter === 'string' ? {soulId: p.presenter, name: ctx.nameOf(p.presenter)} : null;
    return recount({title: String(p.title ?? 'A presentation').slice(0, 200), presenter, startsAtTick, doorsOpenAtTick: startsAtTick - doors, endsAtTick: startsAtTick + duration,
      capacity, phase: 'booking', ticketsLeft: capacity, standbyCount: 0, released: false, tickets: [], standby: [], audience: [], materials: []});
  },
  rolesOf(s, id) {
    const roles: string[] = [];
    if (s.presenter?.soulId === id) roles.push('presenter');
    if (has(s.tickets, id)) roles.push('ticket-holder');
    if (has(s.standby, id)) roles.push('standby');
    if (has(s.audience, id)) roles.push('audience');
    return roles;
  },
  personal: (s, id) => ({ticket: has(s.tickets, id), entered: has(s.audience, id), standbyPosition: has(s.standby, id) ? s.standby.findIndex(x => x.soulId === id) + 1 : null}),
  addressees: (s, id) => s.presenter?.soulId === id && (s.phase === 'doors' || s.phase === 'running') ? ids(s.audience).filter(x => x !== id) : [],
  advance(s: PresentationState, ctx: TimeCtx) {
    const events: ObjectEvent[] = [];
    let changed = false;
    if (s.phase === 'booking' && ctx.tick >= s.doorsOpenAtTick) {
      s.phase = 'doors'; changed = true;
      events.push({to: [...ids(s.tickets), ...(s.presenter ? [s.presenter.soulId] : [])], kind: 'schedule', text: `Doors are open for "${s.title}". Come and enter before it starts.`, data: {phase: 'doors', startsAtTick: s.startsAtTick}, untrusted: true});
      if (s.standby.length) events.push({to: ids(s.standby), kind: 'schedule', text: `Doors are open for "${s.title}". Standby seats are released at curtain in queue order.`, data: {phase: 'doors'}, untrusted: true});
    }
    if (s.phase === 'doors' && ctx.tick >= s.startsAtTick) {
      s.phase = 'running'; s.released = true; changed = true;
      const forfeited = s.tickets.filter(t => !has(s.audience, t.soulId));
      const free = Math.max(0, s.capacity - s.audience.length);
      const promoted = s.standby.slice(0, free);
      s.tickets = [...s.audience, ...promoted];
      s.standby = s.standby.slice(promoted.length);
      if (forfeited.length) events.push({to: ids(forfeited), kind: 'schedule', text: `"${s.title}" has begun; your unclaimed seat was released to standby.`, data: {phase: 'running'}, untrusted: true});
      if (promoted.length) events.push({to: ids(promoted), kind: 'schedule', text: `A standby seat for "${s.title}" is yours. Enter now.`, data: {phase: 'running', ticket: true}, untrusted: true});
      if (s.standby.length) events.push({to: ids(s.standby), kind: 'schedule', text: `No seat came free for "${s.title}".`, data: {phase: 'running', ticket: false}, untrusted: true});
    }
    if (s.phase === 'running' && ctx.tick >= s.endsAtTick) {
      s.phase = 'ended'; changed = true;
      events.push({to: [...ids(s.audience), ...(s.presenter ? [s.presenter.soulId] : [])], kind: 'schedule', text: `"${s.title}" has ended.`, data: {phase: 'ended'}, untrusted: true});
    }
    return changed ? {state: recount(s), events} : null;
  },
  actions: {
    reserve: {
      label: 'Reserve a seat', roles: 'anyone', reach: 'anywhere', params: {},
      available: (s, ctx) => s.phase === 'running' || s.phase === 'ended' ? {code: 'presentation.closed', reason: 'Reservations are closed.'}
        : has(s.tickets, ctx.soul.soulId) || has(s.standby, ctx.soul.soulId) ? {code: 'presentation.already-reserved', reason: 'You already hold a ticket or a standby place.'}
        : s.presenter?.soulId === ctx.soul.soulId ? {code: 'presentation.presenter', reason: 'You are presenting.'} : null,
      validate: (s, _p, ctx) => presentationKind.actions.reserve!.available!(s, ctx),
      apply(s, _p, ctx) {
        const me = {soulId: ctx.soul.soulId, name: ctx.soul.name};
        if (s.tickets.length < s.capacity) { s.tickets.push(me); return {state: recount(s), result: {ticket: true}}; }
        s.standby.push(me);
        return {state: recount(s), result: {ticket: false, standbyPosition: s.standby.length}};
      },
    },
    cancel: {
      label: 'Give up my ticket or standby place', roles: ['ticket-holder', 'standby'], reach: 'anywhere', params: {},
      validate: (s, _p, ctx) => has(s.audience, ctx.soul.soulId) ? {code: 'presentation.entered', reason: 'You have already entered.'} : null,
      apply(s, _p, ctx) {
        const events: ObjectEvent[] = [];
        if (has(s.tickets, ctx.soul.soulId)) {
          s.tickets = without(s.tickets, ctx.soul.soulId);
          if (s.standby.length && s.tickets.length < s.capacity) {
            const next = s.standby.shift()!;
            s.tickets.push(next);
            events.push({to: [next.soulId], kind: 'schedule', text: `A seat came free for "${s.title}"; you now hold a ticket.`, data: {ticket: true}, untrusted: true});
          }
        } else s.standby = without(s.standby, ctx.soul.soulId);
        return {state: recount(s), events};
      },
    },
    enter: {
      label: 'Enter and take a seat', roles: 'anyone', reach: 'place', params: {},
      available(s, ctx) {
        const id = ctx.soul.soulId;
        if (has(s.audience, id)) return {code: 'presentation.entered', reason: 'You are already inside.'};
        if (s.phase === 'ended') return {code: 'presentation.ended', reason: 'It has ended.'};
        if (s.phase === 'booking') return {code: 'presentation.doors-closed', reason: `Doors open at tick ${s.doorsOpenAtTick}.`};
        if (s.presenter?.soulId === id) return null;
        if (!has(s.tickets, id)) return has(s.standby, id) && s.phase === 'doors'
          ? {code: 'presentation.standby-wait', reason: 'Standby seats are released at curtain.'}
          : {code: 'presentation.no-ticket', reason: 'You need a ticket.'};
        if (s.audience.length >= s.capacity) return {code: 'presentation.full', reason: 'Every seat is taken.'};
        return null;
      },
      validate: (s, _p, ctx) => presentationKind.actions.enter!.available!(s, ctx),
      apply(s, _p, ctx) {
        if (s.presenter?.soulId === ctx.soul.soulId) return {state: s, result: {entered: true, presenter: true}};
        s.audience.push({soulId: ctx.soul.soulId, name: ctx.soul.name});
        return {state: recount(s), result: {entered: true, seat: s.audience.length}};
      },
    },
    publish: {
      label: 'Publish material to the audience', roles: ['presenter'], reach: 'anywhere',
      params: {text: {type: 'string', maxLength: 2000, description: 'markdown for the audience'}},
      available: s => s.phase === 'doors' || s.phase === 'running' ? null : {code: 'presentation.not-open', reason: 'Materials can be published once doors open.'},
      validate: (s, p) => !String(p.text).trim() ? {code: 'capability.params', reason: 'text must not be empty.'} : presentationKind.actions.publish!.available!(s, undefined as never),
      apply(s, p, ctx) {
        const text = String(p.text).trim();
        s.materials.push(text);
        return {state: s, result: {published: s.materials.length},
          events: [{to: ids(s.audience).filter(x => x !== ctx.soul.soulId), text, data: {material: s.materials.length, from: {soulId: ctx.soul.soulId, name: ctx.soul.name}}, untrusted: true}]};
      },
    },
  },
};
