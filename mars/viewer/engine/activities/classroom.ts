import {planWalk} from '../locomotion/walk.ts';
import { z } from 'zod';
import { createTurns, stepTurns, type TurnState } from './turns.ts';
import type {
  ActionDef,
  ActionRecord,
  Diagnostic,
  Reservation,
  StepResult,
} from '../actions/types.ts';
import { TERMINAL } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Vec2 } from '../core/math.ts';
import type { Spatial } from '../spatial/service.ts';
import { holdingDiagnostic } from '../construction/rules.ts';
import { heldBy } from '../items/model.ts';
import { humanOf } from '../social/actions.ts';
import {
  isFree,
  occupantOf,
  seatApproach,
  slotById,
  type Slot,
} from '../social/slots.ts';
import type {
  ClassroomControlParams,
  ClassroomDisplay,
  ClassroomIntent,
  ClassroomParams,
  ClassroomPhase,
  ClassroomReadout,
} from './types.ts';

const id = z.string().min(1).max(80);
const point = z.tuple([
  z.number().min(-500).max(500),
  z.number().min(-500).max(500),
]);
const seconds = z.number().positive().max(3600);
const paramsSchema = z.strictObject({
  accessScope:z.literal('ground-venue/1').optional(),
  attendanceScope: z.literal('eden-audience24/1').optional(),
  handoverScope: z.literal('owned-readiness/1').optional(),
  readinessVenue: id.optional(),
  seatAssignments: z.record(id, id).optional(),
  host: id,
  presenters: z.array(id).min(1).max(6),
  audience: z.array(id).min(1).max(24),
  seats: z.array(id).min(3).max(40),
  presenterStation: id,
  departure: z.record(id, point),
  conversationPoints: z.array(point).min(1).max(10).optional(),
  displayId: id.optional(),
  requireDisplay: z.boolean().optional(),
  arrivalStaggerSeconds: z.number().min(0).max(5).optional(),
  talkSeconds: seconds.optional(),
  questionSeconds: seconds.optional(),
  conversationSeconds: seconds.optional(),
  maxPhaseSeconds: seconds.optional(),
});
const intentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('question'), actor: id }),
  z.strictObject({ kind: z.literal('depart'), actor: id }),
  z.strictObject({
    kind: z.literal('join'),
    actor: id,
    departure: point.optional(),
  }),
  z.strictObject({ kind: z.literal('advance') }),
  z.strictObject({ kind: z.literal('cancel') }),
]);
type Participant = ClassroomReadout['participants'][number] & {
  hold?: string;
  directedBy?: string;
};
type Program = { people: Participant[]; station: Slot };
type Exec = {
  id: string;
  params: ClassroomParams;
  people: Participant[];
  station: Slot;
  phase: ClassroomPhase;
  phaseTick: number;
  timer: number;
  presenterIndex: number;
  floor?: string;
  attention?: string;
  children: string[];
  groups: { action: string; turns: TurnState }[];
  externalDepartures: string[];
  extraDepartures: Record<string, Vec2>;
  pending: string[];
  queue: ClassroomIntent[];
  questions: string[];
  expectedStops: string[];
  rotatingTo?: string;
  advance: boolean;
  stopping: boolean;
  error?: Diagnostic;
  waiting?: string;
};
const planned = new WeakMap<ClassroomParams, Program>();
type Store = Record<string, Exec>;
const store = (rt: Runtime): Store => (rt.services.classroomActivities ??= {});
const display = (rt: Runtime): ClassroomDisplay | undefined =>
  rt.services.classroomDisplay;
const live = (rt: Runtime, ids: string[]) => ids.some((i) => rt.isActive(i));
const participating = (ex: Exec) =>
  ex.people.filter((p) => p.state === 'participating');
function diagnostic(
  code: string,
  message: string,
  subjects: string[],
): Diagnostic {
  return { code: `classroom.${code}`, message, subjects };
}
function freeSmallHands(rt: Runtime, actor: string): Diagnostic | null {
  const items = heldBy(rt.world, actor).map(({ item }) => item.id);
  return items.length ? diagnostic(
    'hands-occupied',
    `${actor} must explicitly put down ${items.join(', ')} before entering the classroom`,
    [actor, ...items],
  ) : null;
}
function child(
  rt: Runtime,
  ex: Exec,
  verb: string,
  params: unknown,
): ActionRecord {
  const rec = rt.submit(verb, params, { parent: ex.id, preempt: false });
  ex.children.push(rec.id);
  return rec;
}
function phase(rt: Runtime, ex: Exec, name: ClassroomPhase) {
  ex.phase = name;
  ex.phaseTick = rt.tick;
  ex.timer = 0;
  ex.waiting = undefined;
}
function stopHolds(rt: Runtime, ex: Exec, people = participating(ex)) {
  for (const p of people)
    if (p.hold && rt.isActive(p.hold)) {
      ex.expectedStops.push(p.hold);
      rt.cancel(p.hold);
    }
}
function beginCleanup(rt: Runtime, ex: Exec, error?: Diagnostic) {
  ex.stopping = true;
  ex.error ??= error;
  ex.floor = undefined;
  ex.attention = undefined;
  phase(rt, ex, 'cleanup');
  updateGroupTurns(rt, ex, 0);
  for (const i of ex.children) if (rt.isActive(i)) rt.cancel(i);
}
function exclude(rt: Runtime, ex: Exec, actor: string, reason: string) {
  const p = ex.people.find((p) => p.actor === actor);
  if (!p || p.state === 'excluded') return;
  p.state = 'excluded';
  p.reason = reason;
  p.arrival = undefined;
  ex.questions = ex.questions.filter((a) => a !== actor);
  if (ex.attention === actor) ex.attention = ex.floor;
  rt.mark('classroom.participant-excluded', { session: ex.id, actor, reason });
}
function departureOf(ex: Exec, actor: string): Vec2 | undefined {
  return ex.params.departure[actor] ?? ex.extraDepartures[actor];
}

/** Pure admission preview. The registered control rechecks before claiming in start. */
function joinSeat(
  rt: Runtime,
  ex: Exec,
  actor: string,
  suppliedDeparture?: Vec2,
): Slot | Diagnostic {
  if (ex.stopping || !['presenting', 'question'].includes(ex.phase))
    return diagnostic(
      'join-phase',
      `${actor} can join ${ex.id} only during presenting or question, not ${ex.phase}`,
      [actor, ex.id],
    );
  const previous = ex.people.find((p) => p.actor === actor);
  if (
    previous &&
    (previous.role !== 'audience' || previous.state !== 'excluded')
  )
    return diagnostic(
      'join-ineligible',
      `${actor} is already participating or has a non-audience role in ${ex.id}`,
      [actor, ex.id],
    );
  const audienceCapacity = ex.params.attendanceScope === 'eden-audience24/1' ? 24 : 12;
  if (!previous && ex.people.filter((p) => p.role === 'audience').length >= audienceCapacity)
    return diagnostic(
      'audience-full',
      `${ex.id} already has ${audienceCapacity} distinct audience members`,
      [actor, ex.id],
    );
  const person = humanOf(rt, actor);
  if ('code' in person) return person;
  const holding = holdingDiagnostic(rt.world, actor);
  if (holding) return holding;
  const smallItems = freeSmallHands(rt, actor);
  if (smallItems) return smallItems;
  if (person.human!.level !== 0)
    return diagnostic(
      'ground-only',
      `${actor} is on level ${person.human!.level}; classroom joining supports ground only`,
      [actor],
    );
  const holders = rt.holder(`actor:${actor}`);
  if (
    holders.length &&
    !(previous && holders.length === 1 && holders[0] === ex.id)
  )
    return diagnostic(
      'join-busy',
      `${actor} is held by ${holders.join(', ')} and cannot join ${ex.id}`,
      [actor, ...holders],
    );
  if (!departureOf(ex, actor) && !suppliedDeparture)
    return diagnostic(
      'departure-missing',
      `${actor} needs a departure point to join ${ex.id}`,
      [actor, ex.id],
    );
  let last: Diagnostic | undefined;
  const candidates = previous
    ? [previous.seat, ...ex.params.seats.filter((s) => s !== previous.seat)]
    : ex.params.seats;
  for (const id of candidates) {
    if (
      ex.people.some(
        (p) =>
          p.actor !== actor && p.state === 'participating' && p.seat === id,
      )
    )
      continue;
    const slot = slotById(rt, id);
    if ('code' in slot) {
      last = slot;
      continue;
    }
    if (
      slot.kind !== 'seat' ||
      slot.level !== 0 ||
      !rt.world.entities[slot.owner]
    )
      continue;
    const owners = rt.holder(`slot:${id}`);
    // An excluded member may reclaim their original parent-reserved seat; new
    // people use genuinely spare authored furniture only.
    if (
      owners.length &&
      !(previous?.seat === id && owners.length === 1 && owners[0] === ex.id)
    )
      continue;
    if (occupantOf(rt.world, slot, new Set([actor]))) continue;
    const route = rt.registry.get('sit')!.plan(rt, { actor, slot: id });
    if (route.ok) return slot;
    last = route.diagnostic;
  }
  return diagnostic(
    'join-no-seat',
    `${actor} has no free reachable authored seat in ${ex.id}: ${last?.message ?? ex.params.seats.join(', ')}`,
    [actor, ...ex.params.seats],
  );
}

function admitJoin(
  rt: Runtime,
  ex: Exec,
  intent: Extract<ClassroomIntent, { kind: 'join' }>,
): Diagnostic | null {
  const seat = joinSeat(rt, ex, intent.actor, intent.departure);
  if ('code' in seat) return seat;
  if (!rt.holder(`actor:${intent.actor}`).includes(ex.id)) {
    const claim = rt.reclaimSocialActor(ex.id, intent.actor);
    if (claim) return claim;
  }
  const previous = ex.people.find((p) => p.actor === intent.actor);
  if (previous) {
    // The old cancelled child remains in the action history. It must not
    // exclude this person again after an explicit rejoin.
    if (previous.hold) ex.expectedStops.push(previous.hold);
    previous.state = 'participating';
    previous.reason = undefined;
    previous.seat = seat.id;
    previous.arrival = 'joining';
    previous.directedBy = undefined;
  } else
    ex.people.push({
      actor: intent.actor,
      role: 'audience',
      seat: seat.id,
      state: 'participating',
      arrival: 'joining',
    });
  if (!departureOf(ex, intent.actor) && intent.departure)
    ex.extraDepartures[intent.actor] = intent.departure;
  const rec = child(rt, ex, 'sit', { actor: intent.actor, slot: seat.id });
  ex.people.find((p) => p.actor === intent.actor)!.hold = rec.id;
  if (rec.status === 'failed')
    return (
      rec.diagnostic ??
      diagnostic('join-failed', `${intent.actor} could not take ${seat.id}`, [
        intent.actor,
        seat.id,
      ])
    );
  rt.mark('classroom.joining', {
    session: ex.id,
    actor: intent.actor,
    seat: seat.id,
  });
  return null;
}
function nextPresenter(ex: Exec): string | undefined {
  return ex.params.presenters
    .slice(ex.presenterIndex)
    .find((a) =>
      ex.people.some((p) => p.actor === a && p.state === 'participating'),
    );
}
function setPresentation(rt: Runtime, ex: Exec, actor: string) {
  ex.floor = actor;
  ex.attention = actor;
  const p = ex.people.find((p) => p.actor === actor)!;
  const rec = child(rt, ex, 'take_slot', {
    actor,
    slot: ex.station.id,
    activity: 'talk',
  });
  p.hold = rec.id;
  ex.pending = [rec.id];
  phase(rt, ex, 'releasing');
  ex.rotatingTo = actor;
}
function startRotation(rt: Runtime, ex: Exec) {
  const previous = ex.people.find((p) => p.actor === ex.floor);
  if (
    previous &&
    previous.state === 'participating' &&
    previous.hold &&
    rt.isActive(previous.hold)
  ) {
    ex.expectedStops.push(previous.hold);
    rt.cancel(previous.hold);
  }
  ex.presenterIndex = ex.floor
    ? ex.params.presenters.indexOf(ex.floor) + 1
    : ex.presenterIndex;
  ex.rotatingTo = nextPresenter(ex);
  ex.floor = undefined;
  ex.attention = undefined;
  const next = ex.people.find((p) => p.actor === ex.rotatingTo);
  if (next?.hold && rt.isActive(next.hold)) {
    ex.expectedStops.push(next.hold);
    rt.cancel(next.hold);
  }
  ex.pending = [previous?.hold, next?.hold].filter((a): a is string => !!a);
  phase(rt, ex, 'rotating');
}
function conversationGroups(rt: Runtime, ex: Exec): ClassroomReadout['groups'] {
  return ex.groups.map(({ action, turns }) => {
    const rec = rt.records.get(action)!;
    const members = (rec.params as { actors: string[] }).actors.filter((actor) =>
      participating(ex).some((p) => p.actor === actor) &&
      (rec.phase !== 'talking' || rt.world.entities[actor]?.human?.task === action));
    const status = ex.stopping || ex.phase !== 'conversing' || !rt.isActive(action)
      ? 'ended' : rec.phase === 'talking' ? 'talking' : 'gathering';
    const floorHolder = status === 'talking' && members.length >= 2 && turns.floorHolder && members.includes(turns.floorHolder) ? turns.floorHolder : undefined;
    const actor = floorHolder ? rt.world.entities[floorHolder] : undefined;
    return { action, members, status, floorHolder, attentionTarget: actor ? { actor: actor.id, point: [actor.pose.p[0], actor.pose.p[2]] as Vec2 } : undefined };
  });
}
function updateGroupTurns(rt: Runtime, ex: Exec, dt: number) {
  for (const group of conversationGroups(rt, ex)) {
    const turns = ex.groups.find((g) => g.action === group.action)!.turns;
    if (stepTurns(turns, group.members, group.status === 'talking', dt))
      rt.mark('classroom.group-floor', { session: ex.id, group: group.action, members: group.members, floorHolder: turns.floorHolder });
  }
}
function publish(rt: Runtime, ex: Exec) {
  if (ex.params.displayId && !ex.stopping) {
    if (!display(rt)) {
      beginCleanup(
        rt,
        ex,
        diagnostic(
          'display-unavailable',
          `display ${ex.params.displayId} lost its classroomDisplay service`,
          [ex.params.displayId],
        ),
      );
      return;
    }
    const d = display(rt)!.focus(rt, {
      session: ex.id,
      displayId: ex.params.displayId,
      phase: ex.phase,
      floorHolder: ex.floor,
      attentionTarget: attention(rt, ex),
    });
    if (d) beginCleanup(rt, ex, d);
  }
}
function attention(rt: Runtime, ex: Exec) {
  const e = ex.attention ? rt.world.entities[ex.attention] : undefined;
  return e
    ? { actor: e.id, point: [e.pose.p[0], e.pose.p[2]] as Vec2 }
    : undefined;
}
export function readClassroom(
  rt: Runtime,
  session: string,
): ClassroomReadout | undefined {
  const ex = (rt.services.classroomActivities as Store | undefined)?.[session];
  if (!ex) return undefined;
  return {
    session,
    phase: ex.phase,
    floorHolder: ex.phase === 'question' ? ex.attention : ex.floor,
    presenter: ex.floor,
    attentionTarget: attention(rt, ex),
    waitingReason: ex.waiting,
    participants: ex.people.map(
      ({ hold: _hold, directedBy: _directive, ...p }) => ({ ...p }),
    ),
    controls:
      rt.isActive(session) && !ex.stopping
        ? [
            'question',
            'depart',
            ...(['presenting', 'question'].includes(ex.phase)
              ? ['join' as const]
              : []),
            'advance',
            'cancel',
          ]
        : [],
    groups: conversationGroups(rt, ex),
    queuedQuestions: [...ex.questions],
    joining: ex.people
      .filter((p) => p.state === 'participating' && p.arrival === 'joining')
      .map((p) => p.actor),
    diagnostic: ex.error,
  };
}

export const classroomSession: ActionDef<ClassroomParams, Program, Exec> = {
  verb: 'classroom_session',
  description:
    'Bounded ground classroom: real fixture seating, presentation, queued questions, presenter rotation, conversations and cleanup.',
  schema: paramsSchema,
  reservations(_world, p): Reservation[] {
    // Parent commitments remain stable while physical children delegate the claims.
    return [
      ...[p.host, ...p.presenters, ...p.audience].map((a) => ({
        resource: `actor:${a}`,
        mode: 'exclusive' as const,
      })),
      { resource: `slot:${p.presenterStation}`, mode: 'exclusive' },
      ...(planned.get(p)?.people.map((person) => ({
        resource: `slot:${person.seat}`,
        mode: 'exclusive' as const,
      })) ?? []),
      ...(p.displayId
        ? [{ resource: `display:${p.displayId}`, mode: 'exclusive' as const }]
        : []),
    ];
  },
  plan(rt, p) {
    if (p.audience.length > 12 && p.attendanceScope !== 'eden-audience24/1')
      return {
        ok: false,
        diagnostic: diagnostic(
          'legacy-audience-capacity',
          'More than twelve audience members need the explicit Eden attendance policy',
          p.audience,
        ),
      };
    const actors = [p.host, ...p.presenters, ...p.audience];
    if (new Set(actors).size !== actors.length)
      return {
        ok: false,
        diagnostic: diagnostic(
          'duplicate-participant',
          `classroom repeats a participant across roles: ${actors.join(', ')}`,
          actors,
        ),
      };
    if (new Set(p.seats).size !== p.seats.length)
      return {
        ok: false,
        diagnostic: diagnostic(
          'duplicate-seat',
          `classroom repeats a candidate seat: ${p.seats.join(', ')}`,
          p.seats,
        ),
      };
    if (!rt.services.spatial)
      return {
        ok: false,
        diagnostic: diagnostic(
          'spatial-missing',
          'classroom requires authoritative spatial planning',
          actors,
        ),
      };
    const links = (rt.services.spatial as Spatial).base.links.filter(
      (link) => link.usable,
    );
    if (links.length&&p.accessScope!=='ground-venue/1')
      return {
        ok: false,
        diagnostic: diagnostic(
          'access-unsupported',
          `classroom ground-only scope refuses usable access links ${links.map((l) => l.id).join(', ')}`,
          links.map((l) => l.id),
        ),
      };
    for (const verb of ['sit', 'take_slot', 'walk_to', 'face', 'converse'])
      if (!rt.registry.has(verb))
        return {
          ok: false,
          diagnostic: diagnostic(
            'action-missing',
            `classroom requires registered ${verb}`,
            [verb],
          ),
        };
    for (const a of actors) {
      const e = humanOf(rt, a);
      if ('code' in e) return { ok: false, diagnostic: e };
      const holding = holdingDiagnostic(rt.world, a);
      if (holding) return { ok: false, diagnostic: holding };
      const smallItems = freeSmallHands(rt, a);
      if (smallItems) return { ok: false, diagnostic: smallItems };
      if (e.human!.level !== 0)
        return {
          ok: false,
          diagnostic: diagnostic(
            'ground-only',
            `${a} is on level ${e.human!.level}; classroom only supports ground participants`,
            [a],
          ),
        };
      const h = rt.holder(`actor:${a}`);
      if (h.length)
        return {
          ok: false,
          diagnostic: diagnostic(
            'participant-busy',
            `${a} is held by ${h.join(', ')} and cannot join this classroom`,
            [a, ...h],
          ),
        };
      if (!p.departure[a])
        return {
          ok: false,
          diagnostic: diagnostic(
            'departure-missing',
            `classroom has no departure point for ${a}`,
            [a],
          ),
        };
    }
    if (p.requireDisplay !== false && !p.displayId)
      return {
        ok: false,
        diagnostic: diagnostic(
          'display-required',
          'presentation requires an explicit available displayId; requireDisplay:false explicitly selects discussion',
          actors,
        ),
      };
    if (p.displayId) {
      if (!display(rt))
        return {
          ok: false,
          diagnostic: diagnostic(
            'display-unavailable',
            `display ${p.displayId} has no classroomDisplay capability service`,
            [p.displayId],
          ),
        };
      const d = display(rt)!.supports(rt, p.displayId);
      if (d) return { ok: false, diagnostic: d };
    }
    const station = slotById(rt, p.presenterStation);
    if ('code' in station) return { ok: false, diagnostic: station };
    if (
      station.kind !== 'stand' ||
      station.level !== 0 ||
      !isFree(rt.world, station, new Set(actors))
    )
      return {
        ok: false,
        diagnostic: diagnostic(
          'station-unavailable',
          `${station.id} must be an available ground standing station`,
          [station.id],
        ),
      };
    const free: Slot[] = [];
    for (const s of p.seats) {
      const slot = slotById(rt, s);
      if ('code' in slot) return { ok: false, diagnostic: slot };
      if (
        slot.kind !== 'seat' ||
        slot.level !== 0 ||
        !rt.world.entities[slot.owner]
      )
        return {
          ok: false,
          diagnostic: diagnostic(
            'fixture-seat-required',
            `${s} is not a ground fixture seat`,
            [s],
          ),
        };
      if (isFree(rt.world, slot, new Set(actors))) {
        const q = seatApproach(rt, slot);
        if (Array.isArray(q)) free.push(slot);
      }
    }
    if (free.length < actors.length)
      return {
        ok: false,
        diagnostic: diagnostic(
          'seats-unavailable',
          `classroom needs ${actors.length} usable seats for ${actors.join(', ')}; only ${free.length} of ${p.seats.join(', ')} are free and reachable`,
          [...actors, ...p.seats],
        ),
      };
    const assignments = p.seatAssignments ?? {};
    const assignedSeats = new Set(Object.values(assignments));
    if (p.seatAssignments && (
      p.attendanceScope !== 'eden-audience24/1' ||
      Object.keys(assignments).some(actor => !actors.includes(actor)) ||
      assignedSeats.size !== Object.values(assignments).length ||
      [...assignedSeats].some(seat => !free.some(slot => slot.id === seat))
    )) return {
      ok: false,
      diagnostic: diagnostic('seat-assignment-invalid',
        'Explicit Eden assignments require distinct available candidate seats for participating actors',
        [...Object.keys(assignments), ...assignedSeats]),
    };
    const people: Participant[] = [];
    const available = [...free];
    for (const actor of actors) {
      let last: Diagnostic | undefined;
      const index = available.findIndex((slot) => {
        if (assignments[actor] ? slot.id !== assignments[actor] : assignedSeats.has(slot.id)) return false;
        const attempt = rt.registry
          .get('sit')!
          .plan(rt, { actor, slot: slot.id });
        if (!attempt.ok) last = attempt.diagnostic;
        return attempt.ok;
      });
      if (index < 0)
        return {
          ok: false,
          diagnostic: diagnostic(
            'seat-route-unavailable',
            `${actor} cannot reach any remaining eligible seat (${available.map((s) => s.id).join(', ')}): ${last?.message ?? 'none remain'}`,
            [actor, ...available.map((s) => s.id)],
          ),
        };
      const [seat] = available.splice(index, 1);
      people.push({
        actor,
        role:
          actor === p.host
            ? 'host'
            : p.presenters.includes(actor)
              ? 'presenter'
              : 'audience',
        seat: seat.id,
        state: 'participating',
      });
    }
    if(p.accessScope==='ground-venue/1')for(const person of people){const body=rt.world.entities[person.actor],seat=slotById(rt,person.seat);if('code' in seat)return {ok:false,diagnostic:seat};const approach=seatApproach(rt,seat);if(!Array.isArray(approach))return {ok:false,diagnostic:approach};for(const point of [approach,p.departure[person.actor],...(p.presenters.includes(person.actor)?[station.p]:[])]){const route=planWalk(rt,body,{level:0,p:point});if(!route.ok)return {ok:false,diagnostic:route.diagnostic};if(route.route.legs.some(leg=>leg.kind!=='walk'||leg.level!==0))return {ok:false,diagnostic:diagnostic('venue-route-scope','This ground venue requires routes that stay on level zero without access links',[person.actor])};}}
    const program = { people, station };
    planned.set(p, program);
    return { ok: true, program };
  },
  start(rt, p, program, actionId) {
    const ex: Exec = {
      id: actionId,
      params: p,
      people: program.people,
      station: program.station,
      phase: 'arriving',
      phaseTick: rt.tick,
      timer: 0,
      presenterIndex: 0,
      children: [],
      groups: [],
      externalDepartures: [],
      extraDepartures: {},
      pending: [],
      queue: [],
      questions: [],
      expectedStops: [],
      advance: false,
      stopping: false,
    };
    store(rt)[actionId] = ex;
    for (const [i, person] of ex.people.entries())
      if (!p.arrivalStaggerSeconds || i === 0)
        person.hold = child(rt, ex, 'sit', {
          actor: person.actor,
          slot: person.seat,
        }).id;
    return ex;
  },
  step(rt, ex, dt): StepResult {
    if (ex.phase === 'cleanup') {
      ex.waiting = 'waiting for child actions to reach safe stops';
      if (live(rt, ex.children)) {
        publish(rt, ex);
        return { status: 'running', phase: 'cleanup' };
      }
      ex.phase = 'ended';
      ex.waiting = undefined;
      if (ex.params.displayId)
        ex.error ??=
          display(rt)?.clear(rt, ex.id, ex.params.displayId) ?? undefined;
      return ex.error
        ? { status: 'failed', diagnostic: ex.error }
        : {
            status: 'completed',
            outputs: {
              participants: ex.people.map((p) => ({
                actor: p.actor,
                state: p.state,
                reason: p.reason,
              })),
            },
          };
    }
    for (const intent of ex.queue.splice(0)) {
      if (intent.kind === 'cancel') {
        rt.cancel(ex.id);
        return { status: 'running', phase: 'cleanup' };
      }
      if (intent.kind === 'advance') ex.advance = true;
      if (intent.kind === 'question') ex.questions.push(intent.actor);
      if (intent.kind === 'depart') {
        const destination = departureOf(ex, intent.actor)!;
        const rec = rt.submit('walk_to', {
          actor: intent.actor,
          x: destination[0],
          z: destination[1],
          level: 0,
        });
        ex.externalDepartures.push(rec.id); // Independent departure directive survives later session cleanup.
        if (rec.status === 'failed') {
          beginCleanup(rt, ex, rec.diagnostic);
          break;
        }
      }
    }
    if (ex.stopping) return { status: 'running', phase: 'cleanup' };
    for (const p of participating(ex))
      if (
        p.arrival === 'joining' &&
        p.hold &&
        rt.records.get(p.hold)?.phase === 'occupied'
      ) {
        p.arrival = 'seated';
        rt.mark('classroom.joined', {
          session: ex.id,
          actor: p.actor,
          seat: p.seat,
        });
      }
    // A foreign cancellation of a participant's social hold permanently excludes that member.
    for (const p of participating(ex))
      if (p.hold) {
        const rec = rt.records.get(p.hold);
        if (rec?.status === 'failed') {
          if (rec.diagnostic?.code === 'child.cancelled') {
            exclude(rt, ex, p.actor, rec.diagnostic.message);
            continue;
          }
          beginCleanup(rt, ex, rec.diagnostic);
          return { status: 'running', phase: 'cleanup' };
        }
        if (
          rec?.status === 'cancelled' &&
          !ex.expectedStops.includes(rec.id) &&
          !ex.pending.includes(rec.id) &&
          !['conversation-release', 'conversing', 'departing'].includes(
            ex.phase,
          )
        )
          exclude(
            rt,
            ex,
            p.actor,
            rec.diagnostic?.message ?? `hold ${rec.id} was cancelled`,
          );
      }
    for (const id of ex.children) {
      const rec = rt.records.get(id)!;
      if (rec.status !== 'cancelled' || ex.expectedStops.includes(id)) continue;
      const cp = rec.params as { actor?: string; actors?: string[] };
      if (cp.actors && rec.diagnostic?.code === 'social.pre-empted') continue; // Runtime may stop a gathering circle as a unit; only the directed member departs.
      for (const actor of cp.actors ?? (cp.actor ? [cp.actor] : []))
        exclude(
          rt,
          ex,
          actor,
          rec.diagnostic?.message ?? `child ${id} was cancelled`,
        );
    }
    if (!participating(ex).some((p) => p.role === 'host')) {
      beginCleanup(
        rt,
        ex,
        diagnostic(
          'host-left',
          `host ${ex.params.host} left classroom ${ex.id}`,
          [ex.params.host, ex.id],
        ),
      );
      return { status: 'running', phase: 'cleanup' };
    }
    if (rt.tick - ex.phaseTick > (ex.params.maxPhaseSeconds ?? 120) * 20) {
      beginCleanup(
        rt,
        ex,
        diagnostic(
          'phase-timeout',
          `${ex.id} exceeded its bounded ${ex.phase} wait: ${ex.waiting ?? 'child completion'}`,
          [ex.id],
        ),
      );
      return { status: 'running', phase: 'cleanup' };
    }
    if (ex.params.displayId) {
      const d =
        display(rt)?.supports(rt, ex.params.displayId) ??
        (!display(rt)
          ? diagnostic(
              'display-unavailable',
              `display ${ex.params.displayId} lost its classroomDisplay service`,
              [ex.params.displayId],
            )
          : null);
      if (d) {
        beginCleanup(rt, ex, d);
        return { status: 'running', phase: 'cleanup' };
      }
    }
    switch (ex.phase) {
      case 'arriving': {
        for (const [i, person] of ex.people.entries())
          if (
            person.state === 'participating' &&
            !person.hold &&
            rt.tick - ex.phaseTick >=
              i * (ex.params.arrivalStaggerSeconds ?? 0) * 20
          )
            person.hold = child(rt, ex, 'sit', {
              actor: person.actor,
              slot: person.seat,
            }).id;
        ex.waiting =
          'waiting for all participating people to occupy their fixture seats';
        if (
          participating(ex).every(
            (p) => rt.records.get(p.hold!)?.phase === 'occupied',
          )
        ) {
          ex.rotatingTo = nextPresenter(ex);
          if (!ex.rotatingTo) {
            beginCleanup(
              rt,
              ex,
              diagnostic(
                'no-presenter',
                `${ex.id} has no remaining presenter`,
                [ex.id],
              ),
            );
            break;
          }
          const p = ex.people.find((p) => p.actor === ex.rotatingTo)!;
          ex.expectedStops.push(p.hold!);
          rt.cancel(p.hold!);
          ex.pending = [p.hold!];
          phase(rt, ex, 'rotating');
        }
        break;
      }
      case 'rotating': {
        ex.waiting =
          'waiting for old and new presenters to leave their holds safely';
        if (!live(rt, ex.pending)) {
          const a = ex.rotatingTo;
          for (const p of participating(ex))
            if (
              p.actor !== a &&
              p.role === 'presenter' &&
              (!p.hold || TERMINAL.has(rt.records.get(p.hold)!.status))
            )
              p.hold = child(rt, ex, 'sit', {
                actor: p.actor,
                slot: p.seat,
              }).id;
          if (!a || !participating(ex).some((p) => p.actor === a)) {
            stopHolds(rt, ex);
            ex.pending = ex.children.filter((i) => rt.isActive(i));
            phase(rt, ex, 'conversation-release');
            break;
          }
          const face = child(rt, ex, 'face', {
            actor: a,
            target: { point: [ex.station.p[0] + 2, ex.station.p[1]] },
          });
          ex.pending = [face.id];
          phase(rt, ex, 'releasing');
        }
        break;
      }
      case 'releasing': {
        ex.waiting = 'waiting for presenter facing and actual station arrival';
        const failed = ex.pending
          .map((i) => rt.records.get(i)!)
          .find((r) => r.status === 'failed');
        if (failed) {
          beginCleanup(rt, ex, failed.diagnostic);
          break;
        }
        const p = ex.people.find(
          (p) => p.actor === ex.rotatingTo && p.state === 'participating',
        );
        if (!p) {
          startRotation(rt, ex);
          break;
        }
        if (
          ex.pending.every(
            (i) =>
              rt.records.get(i)?.verb === 'face' &&
              rt.records.get(i)?.status === 'completed',
          )
        )
          setPresentation(rt, ex, p.actor);
        else if (
          ex.pending.every((i) => rt.records.get(i)?.phase === 'occupied')
        ) {
          phase(rt, ex, 'presenting');
          ex.advance = false;
        }
        break;
      }
      case 'presenting': {
        if (!participating(ex).some((p) => p.actor === ex.floor)) {
          startRotation(rt, ex);
          break;
        }
        ex.timer += dt;
        const asker = ex.questions.shift();
        if (asker && participating(ex).some((p) => p.actor === asker)) {
          ex.attention = asker;
          phase(rt, ex, 'question');
          rt.mark('classroom.question', {
            session: ex.id,
            presenter: ex.floor,
            actor: asker,
          });
        } else if (ex.advance || ex.timer >= (ex.params.talkSeconds ?? 8)) {
          ex.advance = false;
          startRotation(rt, ex);
        }
        break;
      }
      case 'question':
        ex.timer += dt;
        if (!participating(ex).some((p) => p.actor === ex.floor))
          startRotation(rt, ex);
        else if (ex.advance || ex.timer >= (ex.params.questionSeconds ?? 3)) {
          ex.attention = ex.floor;
          ex.advance = false;
          phase(rt, ex, 'presenting');
          rt.mark('classroom.attention-return', {
            session: ex.id,
            actor: ex.floor,
          });
        }
        break;
      case 'conversation-release': {
        ex.waiting =
          'waiting for seats and presenter station to release before conversations';
        if (!live(rt, ex.pending)) {
          const actors = participating(ex).map((p) => p.actor);
          const count = Math.ceil(actors.length / 4);
          const width = Math.floor(actors.length / Math.max(1, count));
          let offset = 0;
          ex.pending = [];
          for (let i = 0; i < count; i++) {
            const size = width + (i < actors.length % count ? 1 : 0);
            const group = actors.slice(offset, offset + size);
            offset += size;
            if (group.length < 2) continue;
            const at = ex.params.conversationPoints?.[i];
            const rec = child(rt, ex, 'converse', {
              actors: group,
              ...(at ? { at } : {}),
              duration: ex.params.conversationSeconds ?? 5,
            });
            ex.pending.push(rec.id);
            ex.groups.push({ action: rec.id, turns: createTurns(i) });
          }
          phase(rt, ex, 'conversing');
        }
        break;
      }
      case 'conversing': {
        for (let i = 0; i < ex.pending.length; i++) {
          const rec = rt.records.get(ex.pending[i])!;
          const cp = rec.params as {
            actors: string[];
            at?: Vec2;
            duration?: number;
          };
          if (
            !rt.isActive(rec.id) ||
            !cp.actors.some((a) =>
              ex.people.some((p) => p.actor === a && p.state === 'excluded'),
            )
          )
            continue;
          if (
            ex.people.some(
              (p) =>
                cp.actors.includes(p.actor) &&
                p.state === 'excluded' &&
                p.directedBy &&
                rt.isActive(p.directedBy),
            )
          )
            continue; // Retained members keep talking until the directive ends; stop the group before any return can move.
          ex.expectedStops.push(rec.id);
          rt.cancel(rec.id);
          updateGroupTurns(rt, ex, 0); // Record the old floor ending before replacing its child.
          const remaining = cp.actors.filter((a) =>
            participating(ex).some((p) => p.actor === a),
          );
          if (remaining.length >= 2) {
            ex.pending[i] = child(rt, ex, 'converse', {
              actors: remaining,
              ...(cp.at ? { at: cp.at } : {}),
              duration: cp.duration,
            }).id;
            ex.groups[i] = { action: ex.pending[i], turns: createTurns(i) };
          }
        }
        ex.waiting =
          'waiting for conversation arrivals and bounded talk completion';
        const failed = ex.pending
          .map((i) => rt.records.get(i)!)
          .find((r) => r.status === 'failed');
        if (failed) {
          beginCleanup(rt, ex, failed.diagnostic);
          break;
        }
        if (!live(rt, ex.pending)) {
          ex.pending = [];
          for (const p of participating(ex)) {
            const q = departureOf(ex, p.actor)!;
            ex.pending.push(
              child(rt, ex, 'walk_to', {
                actor: p.actor,
                x: q[0],
                z: q[1],
                level: 0,
              }).id,
            );
          }
          phase(rt, ex, 'departing');
        }
        break;
      }
      case 'departing': {
        ex.waiting = 'waiting for actual departures';
        const failed = ex.pending
          .map((i) => rt.records.get(i)!)
          .find((r) => r.status === 'failed');
        if (failed) beginCleanup(rt, ex, failed.diagnostic);
        else if (!live(rt, ex.pending)) beginCleanup(rt, ex);
        break;
      }
    }
    updateGroupTurns(rt, ex, dt);
    publish(rt, ex);
    return { status: 'running', phase: ex.phase };
  },
  cancel(rt, ex) {
    beginCleanup(rt, ex);
    return { ok: true, deferred: true };
  },
  yieldTo: (_rt, self, holder) => (holder.id !== self.id ? [holder.id] : []), // Ground walk children stop safely; parent membership yields independently.
  canYieldMembers: (_rt, ex, actors) =>
    !ex.stopping &&
    actors.every((a) => participating(ex).some((p) => p.actor === a)),
  releaseMembers(rt, ex, actors, by) {
    for (const a of actors) {
      const p = ex.people.find((p) => p.actor === a)!;
      p.directedBy = by.id;
      exclude(rt, ex, a, `directed by ${by.id} (${by.verb})`);
    }
  },
  resumable:
    'classroom coordinator snapshots are deferred until the activity graph has focused continuation proof',
};

export const classroomControl: ActionDef<
  ClassroomControlParams,
  null,
  { id: string; error?: Diagnostic }
> = {
  verb: 'classroom_control',
  description:
    'Validate and queue one bounded classroom intention; movement stays in Runtime child actions.',
  schema: z.strictObject({ session: id, intent: intentSchema }),
  reservations: () => [],
  plan(rt, p) {
    const ex = (rt.services.classroomActivities as Store | undefined)?.[
      p.session
    ];
    if (!ex || !rt.isActive(p.session) || ex.stopping)
      return {
        ok: false,
        diagnostic: diagnostic(
          'session-inactive',
          `classroom ${p.session} is not accepting controls`,
          [p.session],
        ),
      };
    const requestedActor = 'actor' in p.intent ? p.intent.actor : undefined;
    if (
      p.intent.kind !== 'join' &&
      requestedActor &&
      !participating(ex).some((a) => a.actor === requestedActor)
    )
      return {
        ok: false,
        diagnostic: diagnostic(
          'participant-ineligible',
          `${requestedActor} is not participating in ${p.session}`,
          [requestedActor, p.session],
        ),
      };
    if (p.intent.kind === 'join') {
      const seat = joinSeat(rt, ex, p.intent.actor, p.intent.departure);
      if ('code' in seat) return { ok: false, diagnostic: seat };
    }
    const questionActor =
      p.intent.kind === 'question' ? p.intent.actor : undefined;
    if (
      questionActor &&
      (!ex.people.some(
        (member) =>
          member.actor === questionActor &&
          member.role === 'audience' &&
          member.state === 'participating' &&
          member.arrival !== 'joining',
      ) ||
        ![
          'arriving',
          'rotating',
          'releasing',
          'presenting',
          'question',
        ].includes(ex.phase))
    )
      return {
        ok: false,
        diagnostic: diagnostic(
          'question-ineligible',
          `${questionActor} cannot ask a question during ${ex.phase} in ${p.session}`,
          [questionActor, p.session],
        ),
      };
    if (
      ex.queue.length >= 32 ||
      (p.intent.kind === 'question' &&
        ex.questions.length +
          ex.queue.filter((q) => q.kind === 'question').length >=
          12)
    )
      return {
        ok: false,
        diagnostic: diagnostic(
          'queue-full',
          `${p.session} control/question queue is full`,
          [p.session],
        ),
      };
    return { ok: true, program: null };
  },
  start(rt, p, _program, actionId) {
    const ex = store(rt)[p.session];
    if (p.intent.kind === 'join') {
      const error = admitJoin(rt, ex, p.intent);
      if (error) beginCleanup(rt, ex, error);
      return { id: actionId, error: error ?? undefined };
    }
    ex.queue.push(p.intent);
    return { id: actionId };
  },
  step: (_rt, ex) =>
    ex.error
      ? { status: 'failed', diagnostic: ex.error }
      : { status: 'completed' },
  cancel: () => ({ ok: true }),
  resumable: true,
};
export const CLASSROOM_ACTIONS: ActionDef[] = [
  classroomSession,
  classroomControl,
];
