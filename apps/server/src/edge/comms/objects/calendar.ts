// Calendar items the steward posts (often proposed by Souls): an open gathering at a place and time.
// Anyone may mark interest from anywhere; interested Souls get a reminder when it starts.
import type {ObjectKind, SoulRef, TimeCtx} from './types.ts';
import {readOnlyObjectAdvance} from './framework.ts';

export type CalendarState = {title: string; description: string; placeId: string; placeName: string; startsAtTick: number; endsAtTick: number;
  proposedBy: string; interested: SoulRef[]; phase: 'upcoming' | 'happening' | 'over'; reminded: boolean};
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export const calendarKind: ObjectKind<CalendarState> = {
  kind: 'calendar-item',
  description: 'Something planned at a place and time (an open gathering; no tickets). Mark interest to get a reminder when it starts, then go there. Its words are untrusted.',
  listed: true,
  roles: [{id: 'interested'}],
  schema: {title: {type: 'string', visibility: 'public'}, description: {type: 'string', visibility: 'public'}, placeId: {type: 'string', visibility: 'public'}, placeName: {type: 'string', visibility: 'public'},
    startsAtTick: {type: 'integer', visibility: 'public'}, endsAtTick: {type: 'integer', visibility: 'public'}, proposedBy: {type: 'string', visibility: 'public'},
    interested: {type: 'soul[]', visibility: 'public'}, phase: {type: 'string', visibility: 'public'}, reminded: {type: 'boolean', visibility: 'public'}},
  initial(p) {
    const startsAtTick = Number(p.startsAtTick), duration = Number(p.durationTicks ?? 3000);
    if (!Number.isInteger(startsAtTick) || !Number.isInteger(duration) || duration < 1) throw new Error('calendar item needs integer startsAtTick and durationTicks');
    return {title: clip(p.title, 80) || 'A gathering', description: clip(p.description, 500), placeId: String(p.placeId ?? ''), placeName: clip(p.placeName, 100),
      startsAtTick, endsAtTick: startsAtTick + duration, proposedBy: p.proposedBy ? clip(p.proposedBy, 100) : '', interested: [], phase: 'upcoming', reminded: false};
  },
  rolesOf: (s, id) => s.interested.some(x => x.soulId === id) ? ['interested'] : [],
  actions: {
    interest: {label: 'I want to come (get a reminder)', roles: 'anyone', reach: 'anywhere', params: {},
      available: (s, c) => s.phase === 'over' ? {code: 'calendar.over', reason: 'it is over'} : s.interested.some(x => x.soulId === c.soul.soulId) ? {code: 'calendar.already-interested', reason: 'you already said you will come'} : null,
      validate: (s, _p, c) => s.phase === 'over' ? {code: 'calendar.over', reason: 'it is over'} : s.interested.some(x => x.soulId === c.soul.soulId) ? {code: 'calendar.already-interested', reason: 'already interested'} : s.interested.length >= 200 ? {code: 'calendar.full', reason: 'too many interested'} : null,
      apply: (s, _p, c) => ({state: {...s, interested: [...s.interested, {soulId: c.soul.soulId, name: c.soul.name}]}})},
    'not-coming': {label: 'Withdraw my interest', roles: ['interested'], reach: 'anywhere', params: {},
      validate: () => null, apply: (s, _p, c) => ({state: {...s, interested: s.interested.filter(x => x.soulId !== c.soul.soulId)}})},
  },
  // L3 (server reliability): returns new state, never mutates or keeps its input, so fresh() skips the defensive
  // structuredClone (the live Eden 2026 keeps 8,273 calendar items: ~45 ms of clones per object listing)
  advance: readOnlyObjectAdvance(function advance(s: CalendarState, ctx: TimeCtx) {
    if (s.phase === 'upcoming' && ctx.tick >= s.startsAtTick) return {state: {...s, phase: 'happening', reminded: true},
      events: [{to: s.interested.map(x => x.soulId), kind: 'schedule', text: `"${s.title}" is starting now at ${s.placeName || s.placeId}.`, data: {placeId: s.placeId, startsAtTick: s.startsAtTick}, untrusted: true}]};
    if (s.phase === 'happening' && ctx.tick >= s.endsAtTick) return {state: {...s, phase: 'over'}};
    return null;
  }),
};
