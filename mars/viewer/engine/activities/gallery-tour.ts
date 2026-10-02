// Future hypothetical tour: registered sharing/walking actions own all physics.
import { z } from 'zod';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Vec2 } from '../core/math.ts';
import {
  artSharing,
  artSharingControl,
  readArtSharing,
  type ArtSharingParams,
  type ArtSharingIntent,
  type ArtSharingReadout,
} from './art-sharing.ts';
export interface GalleryStop {
  sharing: ArtSharingParams;
  departure: { actor: string; to: Vec2 }[];
}
export interface GalleryTourParams {
  stops: GalleryStop[];
  retryLimit?: number;
}
type Mode =
  | 'binding'
  | 'sharing'
  | 'clearing'
  | 'pausing'
  | 'paused'
  | 'waiting'
  | 'ending'
  | 'completed';
type Exec = {
  id: string;
  p: GalleryTourParams;
  index: number;
  mode: Mode;
  resumeMode: 'binding' | 'sharing' | 'clearing';
  members: {
    actor: string;
    active: boolean;
    state: 'participating' | 'invited' | 'left' | 'directed-away';
  }[];
  child?: string;
  children: string[];
  walks: Record<string, string>;
  history: { index: number; pad: string; sharing: ArtSharingReadout }[];
  recorded: boolean;
  attempts: number;
  retryTick: number;
  diagnostic?: Diagnostic;
  finished: boolean;
};
const store = (rt: Runtime): Record<string, Exec> =>
  (rt.services.galleryTours ??= {});
const find = (rt: Runtime, id: string) =>
  (rt.services.galleryTours as Record<string, Exec> | undefined)?.[id];
const issue = (
  code: string,
  message: string,
  subjects: string[],
  cause?: Diagnostic,
): Diagnostic => ({
  code: `gallery_tour.${code}`,
  message,
  subjects,
  ...(cause ? { details: { cause } } : {}),
});
const id = z.string().min(1).max(80);
const xz = z.tuple([
  z.number().min(-500).max(500),
  z.number().min(-500).max(500),
]);
const binding = (ex: Exec): ArtSharingParams => ({
  ...structuredClone(ex.p.stops[ex.index].sharing),
  visitors: ex.p.stops[ex.index].sharing.visitors.map((v) => ({
    ...v,
    join: ex.members.find((m) => m.actor === v.actor)!.active,
  })),
});
function structural(p: GalleryTourParams): Diagnostic | undefined {
  const first = p.stops[0].sharing,
    people = [first.host.actor, ...first.visitors.map((v) => v.actor)];
  if (
    first.visitors.length > 3 ||
    new Set(people).size !== people.length ||
    new Set(p.stops.map((s) => s.sharing.pad)).size !== p.stops.length
  )
    return issue(
      'definition',
      'Gallery requires distinct pads and a host with two or three distinct declared visitors',
      people,
    );
  for (const s of p.stops) {
    if (
      s.sharing.host.actor !== first.host.actor ||
      JSON.stringify(s.sharing.visitors.map((v) => v.actor)) !==
        JSON.stringify(first.visitors.map((v) => v.actor)) ||
      s.sharing.visitors.some(
        (v, i) => (v.join !== false) !== (first.visitors[i].join !== false),
      )
    )
      return issue(
        'membership',
        `${s.sharing.pad} must retain the same declared people and initial membership`,
        [s.sharing.pad, ...people],
      );
    if (
      s.departure.length !== people.length ||
      new Set(s.departure.map((d) => d.actor)).size !== people.length ||
      people.some((a) => !s.departure.some((d) => d.actor === a))
    )
      return issue(
        'departure',
        `${s.sharing.pad} needs one ordinary departure point for each declared person`,
        [s.sharing.pad, ...people],
      );
  }
}
function waiting(ex: Exec, d: Diagnostic): StepResult {
  ex.diagnostic = d;
  ex.mode = 'waiting';
  if (ex.recorded) ex.resumeMode = 'clearing';
  return { status: 'blocked', diagnostic: d };
}
function forward(
  rt: Runtime,
  ex: Exec,
  intent: ArtSharingIntent,
): Diagnostic | undefined {
  if (!ex.child || !rt.isActive(ex.child))
    return issue('no-circle', `${ex.id} has no active artwork circle`, [ex.id]);
  const p = { session: ex.child, intent },
    plan = artSharingControl.plan(rt, p);
  if (!plan.ok) return plan.diagnostic;
  const r = rt.submit('art_sharing_control', p, {
    parent: ex.id,
    preempt: false,
  });
  ex.children.push(r.id);
  return r.status === 'failed' ? r.diagnostic : undefined;
}
function pause(rt: Runtime, ex: Exec, d?: Diagnostic) {
  if (['paused', 'pausing', 'ending', 'completed'].includes(ex.mode)) return;
  const completed = ex.child ? readArtSharing(rt, ex.child) : undefined;
  if (completed?.finished && !rt.isActive(completed.session) && !ex.recorded) {
    ex.history.push({
      index: ex.index,
      pad: completed.pad,
      sharing: structuredClone(completed),
    });
    ex.recorded = true;
  }
  ex.resumeMode =
    ex.child && rt.isActive(ex.child)
      ? 'sharing'
      : ex.recorded
        ? 'clearing'
        : 'binding';
  if (ex.resumeMode === 'sharing') forward(rt, ex, { kind: 'pause' });
  for (const w of Object.values(ex.walks)) if (rt.isActive(w)) rt.cancel(w);
  ex.mode = 'pausing';
  ex.diagnostic = d;
}
function terminate(rt: Runtime, ex: Exec) {
  ex.mode = 'ending';
  for (const c of ex.children) if (rt.isActive(c)) rt.cancel(c);
}
function sharingState(rt: Runtime, ex: Exec) {
  const s = ex.child ? readArtSharing(rt, ex.child) : undefined;
  if (s)
    for (const p of s.participants)
      if (!p.active && ['left', 'directed-away'].includes(p.membership)) {
        const m = ex.members.find((m) => m.actor === p.actor)!;
        m.active = false;
        if (m.state !== 'directed-away')
          m.state = p.membership as 'left' | 'directed-away';
      }
  return s;
}
export const galleryTour: ActionDef<GalleryTourParams, null, Exec> = {
  verb: 'gallery_tour',
  description:
    'Visit two or three declared supported marked pads through real sharing circles and ordinary departures, retaining tour history and explicit membership.',
  schema: z.strictObject({
    stops: z
      .array(
        z.strictObject({
          sharing: artSharing.schema,
          departure: z
            .array(z.strictObject({ actor: id, to: xz }))
            .min(3)
            .max(4),
        }),
      )
      .min(2)
      .max(3),
    retryLimit: z.number().int().min(1).max(60).optional(),
  }),
  reservations: (_w, p) =>
    [p.stops[0].sharing.host, ...p.stops[0].sharing.visitors].map((m) => ({
      resource: `gallery-tour:${m.actor}`,
      mode: 'exclusive',
    })),
  plan(rt, p) {
    const bad = structural(p);
    if (bad) return { ok: false, diagnostic: bad };
    for (const verb of ['art_sharing', 'art_sharing_control', 'walk_to'])
      if (!rt.registry.has(verb))
        return {
          ok: false,
          diagnostic: issue(
            'missing-action',
            `Gallery needs registered ${verb}`,
            [verb],
          ),
        };
    return { ok: true, program: null };
  },
  start(rt, p, _program, id) {
    const first = p.stops[0].sharing,
      ex: Exec = {
        id,
        p: structuredClone(p),
        index: 0,
        mode: 'binding',
        resumeMode: 'binding',
        members: [first.host, ...first.visitors].map((m) => ({
          actor: m.actor,
          active: m.actor === first.host.actor || m.join !== false,
          state:
            m.actor === first.host.actor || m.join !== false
              ? 'participating'
              : 'invited',
        })),
        children: [],
        walks: {},
        history: [],
        recorded: false,
        attempts: 0,
        retryTick: rt.tick,
        finished: false,
      };
    store(rt)[id] = ex;
    return ex;
  },
  onDirective(rt, ex, by, claims, ancestors) {
    if (
      ancestors.includes(ex.id) ||
      by.verb === 'gallery_tour_control' ||
      ['ending', 'completed'].includes(ex.mode)
    )
      return;
    for (const m of ex.members.filter((m) => m.active))
      if (claims.some((c) => c.resource === `actor:${m.actor}`)) {
        if (m.actor === ex.p.stops[0].sharing.host.actor)
          pause(
            rt,
            ex,
            issue(
              'host-directed',
              `${by.id} directs host ${m.actor}; explicit Resume is required`,
              [by.id, m.actor, ex.id],
            ),
          );
        else {
          m.active = false;
          m.state = 'directed-away';
        }
      }
  },
  step(rt, ex) {
    const s = sharingState(rt, ex);
    if (ex.mode === 'ending') {
      for (const c of ex.children) if (rt.isActive(c)) rt.cancel(c);
      if (ex.children.some((c) => rt.isActive(c)))
        return { status: 'running', phase: 'safe-end' };
      ex.mode = 'completed';
      return {
        status: 'completed',
        outputs: { finished: ex.finished, history: ex.history },
      };
    }
    if (ex.mode === 'pausing') {
      if (
        Object.values(ex.walks).some((c) => rt.isActive(c)) ||
        (s && rt.isActive(s.session) && !['paused', 'waiting'].includes(s.mode))
      )
        return { status: 'running', phase: 'safe-pause' };
      ex.mode = 'paused';
      return ex.diagnostic
        ? { status: 'blocked', diagnostic: ex.diagnostic }
        : { status: 'running', phase: 'paused' };
    }
    if (ex.mode === 'paused')
      return ex.diagnostic
        ? { status: 'blocked', diagnostic: ex.diagnostic }
        : { status: 'running', phase: 'paused' };
    if (ex.mode === 'sharing') {
      if (ex.child && rt.isActive(ex.child)) {
        if (s && ['paused', 'waiting'].includes(s.mode)) {
          ex.resumeMode = 'sharing';
          ex.mode = 'paused';
          ex.diagnostic = s.diagnostic;
        }
        return ex.diagnostic
          ? { status: 'blocked', diagnostic: ex.diagnostic }
          : { status: 'running', phase: s?.mode ?? 'arriving' };
      }
      if (!s?.finished) {
        ex.attempts = ex.p.retryLimit ?? 20;
        ex.resumeMode = 'binding';
        return waiting(
          ex,
          issue(
            'circle-stopped',
            `${ex.child} stopped before finishing ${ex.p.stops[ex.index].sharing.pad}; explicit Resume or End`,
            [ex.child ?? ex.id, ex.p.stops[ex.index].sharing.pad],
          ),
        );
      }
      if (!ex.recorded) {
        ex.history.push({
          index: ex.index,
          pad: s.pad,
          sharing: structuredClone(s),
        });
        ex.recorded = true;
      }
      ex.mode = 'clearing';
      ex.walks = {};
      ex.diagnostic = undefined;
    }
    if (ex.mode === 'clearing') {
      for (const d of ex.p.stops[ex.index].departure) {
        if (!ex.members.find((m) => m.actor === d.actor)!.active) continue;
        const old = ex.walks[d.actor];
        if (old) {
          const r = rt.records.get(old)!;
          if (rt.isActive(old)) continue;
          if (r.status === 'completed') continue;
          return waiting(
            ex,
            issue(
              'departure-stopped',
              `${d.actor} did not finish departure ${old}; explicit Resume is required`,
              [d.actor, old],
            ),
          );
        }
        const p = { actor: d.actor, x: d.to[0], z: d.to[1], level: 0 },
          plan = rt.registry.get('walk_to')!.plan(rt, p);
        if (!plan.ok)
          return waiting(
            ex,
            issue(
              'departure-blocked',
              `${d.actor} cannot leave ${ex.p.stops[ex.index].sharing.pad}: ${plan.diagnostic.message}`,
              [d.actor, ex.p.stops[ex.index].sharing.pad],
              plan.diagnostic,
            ),
          );
        const r = rt.submit('walk_to', p, { parent: ex.id, preempt: false });
        ex.walks[d.actor] = r.id;
        ex.children.push(r.id);
      }
      if (Object.values(ex.walks).some((c) => rt.isActive(c)))
        return { status: 'running', phase: 'departing' };
      // No later binding may race an earlier physical departure, including Leave.
      if (ex.children.some((c) => rt.isActive(c)))
        return { status: 'running', phase: 'departure-release' };
      ex.index++;
      ex.child = undefined;
      ex.recorded = false;
      ex.walks = {};
      ex.attempts = 0;
      ex.retryTick = rt.tick;
      if (ex.index === ex.p.stops.length) {
        ex.finished = true;
        ex.mode = 'completed';
        return {
          status: 'completed',
          outputs: { finished: true, history: ex.history },
        };
      }
      ex.mode = 'binding';
    }
    if (
      ex.mode === 'waiting' &&
      (ex.recorded || ex.attempts >= (ex.p.retryLimit ?? 20))
    )
      return { status: 'blocked', diagnostic: ex.diagnostic! };
    if (rt.tick < ex.retryTick)
      return ex.diagnostic
        ? { status: 'blocked', diagnostic: ex.diagnostic }
        : { status: 'running', phase: 'binding' };
    ex.resumeMode = 'binding';
    ex.retryTick = rt.tick + 20;
    ex.attempts++;
    const p = binding(ex);
    if (p.visitors.filter((v) => v.join !== false).length < 2)
      return waiting(
        ex,
        issue(
          'insufficient-audience',
          `${p.pad} needs host ${p.host.actor} and two active viewers; a declared visitor may Join or the owner may End`,
          [p.pad, ...ex.members.filter((m) => !m.active).map((m) => m.actor)],
        ),
      );
    const plan = artSharing.plan(rt, p);
    if (!plan.ok)
      return waiting(
        ex,
        issue(
          'stop-unavailable',
          `${p.pad} waits: ${plan.diagnostic.message}`,
          [p.pad, ...(plan.diagnostic.subjects ?? [])],
          plan.diagnostic,
        ),
      );
    const child = rt.submit('art_sharing', p, {
      parent: ex.id,
      preempt: false,
    });
    ex.children.push(child.id);
    ex.child = child.id;
    if (child.status === 'failed') {
      ex.attempts = ex.p.retryLimit ?? 20;
      return waiting(
        ex,
        issue(
          'admission',
          `${p.pad} lost admission: ${child.diagnostic?.message}`,
          [p.pad, child.id],
          child.diagnostic,
        ),
      );
    }
    ex.mode = 'sharing';
    ex.diagnostic = undefined;
    return { status: 'running', phase: 'arriving' };
  },
  cancel(rt, ex) {
    terminate(rt, ex);
    return { ok: true, deferred: true };
  },
  resumable:
    'Retained same-Runtime tour history and explicit Resume; active save/load remains deferred.',
};
export interface GalleryControlParams {
  tour: string;
  intent: ArtSharingIntent;
}
export const galleryTourControl: ActionDef<GalleryControlParams, null, null> = {
  verb: 'gallery_tour_control',
  description:
    'Pause, Resume, End, ask, answer, floor, or explicitly Join/Leave a declared tour participant.',
  schema: z.strictObject({
    tour: id,
    intent: z.union([
      z.strictObject({ kind: z.enum(['pause', 'resume', 'end']) }),
      z.strictObject({
        kind: z.enum(['ask', 'answer', 'floor', 'join']),
        actor: id,
      }),
      z.strictObject({ kind: z.literal('leave'), actor: id, to: xz }),
    ]),
  }),
  reservations: () => [],
  plan(rt, p) {
    const ex = find(rt, p.tour);
    if (
      !ex ||
      !rt.isActive(p.tour) ||
      ['ending', 'completed'].includes(ex.mode)
    )
      return {
        ok: false,
        diagnostic: issue('inactive', `${p.tour} is not accepting controls`, [
          p.tour,
        ]),
      };
    const k = p.intent.kind;
    if (k === 'end' || k === 'pause') return { ok: true, program: null };
    if (k === 'resume') {
      if (!['paused', 'waiting'].includes(ex.mode))
        return {
          ok: false,
          diagnostic: issue(
            'not-paused',
            `${p.tour} must safely pause or wait before Resume`,
            [p.tour],
          ),
        };
      if (ex.resumeMode === 'sharing' && ex.child && rt.isActive(ex.child))
        return artSharingControl.plan(rt, {
          session: ex.child,
          intent: { kind: 'resume' },
        });
      return { ok: true, program: null };
    }
    if (!('actor' in p.intent))
      return {
        ok: false,
        diagnostic: issue('intent', 'Unknown tour intent', [p.tour]),
      };
    const actor = p.intent.actor,
      m = ex.members.find((m) => m.actor === actor);
    if (
      !m ||
      (m.actor === ex.p.stops[0].sharing.host.actor &&
        ['join', 'leave'].includes(k))
    )
      return {
        ok: false,
        diagnostic: issue(
          'participant',
          `${p.intent.actor} is not an eligible declared visitor`,
          [p.intent.actor, p.tour],
        ),
      };
    if (
      k === 'join' &&
      ['binding', 'waiting'].includes(ex.mode) &&
      !ex.child &&
      !m.active
    )
      return { ok: true, program: null };
    if (!ex.child || !rt.isActive(ex.child))
      return {
        ok: false,
        diagnostic: issue(
          'no-circle',
          `${p.tour} has no active circle for ${k}`,
          [p.tour],
        ),
      };
    return artSharingControl.plan(rt, { session: ex.child, intent: p.intent });
  },
  start(rt, p) {
    const ex = find(rt, p.tour)!,
      k = p.intent.kind;
    if (k === 'end') rt.cancel(ex.id);
    else if (k === 'pause') pause(rt, ex);
    else if (k === 'resume') {
      if (ex.resumeMode === 'sharing' && ex.child && rt.isActive(ex.child)) {
        const d = forward(rt, ex, { kind: 'resume' });
        if (d) {
          ex.diagnostic = d;
          return null;
        }
        // A player may direct an already released visitor during Pause. Resume
        // validates all current actors are free, then withdraws that declared
        // member at its actual position before any sharing hold can rebind it.
        const circle = readArtSharing(rt, ex.child)!;
        for (const m of ex.members.filter((m) => !m.active)) {
          if (!circle.participants.find((p) => p.actor === m.actor)?.active)
            continue;
          const pose = rt.world.entities[m.actor].pose;
          const withdrawal = forward(rt, ex, {
            kind: 'leave',
            actor: m.actor,
            to: [pose.p[0], pose.p[2]],
          });
          if (withdrawal) {
            ex.diagnostic = withdrawal;
            ex.mode = 'sharing';
            return null;
          }
          const departure = readArtSharing(rt, ex.child)!.participants.find(
            (p) => p.actor === m.actor,
          )?.departure;
          if (departure) ex.children.push(departure);
        }
      }
      if (ex.resumeMode === 'clearing')
        ex.walks = Object.fromEntries(
          Object.entries(ex.walks).filter(
            ([, id]) => rt.records.get(id)?.status === 'completed',
          ),
        );
      ex.mode = ex.resumeMode;
      ex.diagnostic = undefined;
      ex.attempts = 0;
      ex.retryTick = rt.tick;
    } else if ('actor' in p.intent) {
      const actor = p.intent.actor,
        m = ex.members.find((m) => m.actor === actor)!;
      if (k === 'join' && !ex.child) {
        m.active = true;
        m.state = 'participating';
        ex.attempts = 0;
        ex.retryTick = rt.tick;
      } else {
        const d = forward(rt, ex, p.intent);
        if (d) {
          ex.diagnostic = d;
          return null;
        }
        if (k === 'leave') {
          m.active = false;
          m.state = 'left';
          const s = readArtSharing(rt, ex.child!)!,
            dep = s.participants.find((v) => v.actor === m.actor)?.departure;
          if (dep) ex.children.push(dep);
        } else if (k === 'join') {
          m.active = true;
          m.state = 'participating';
        }
      }
    }
    return null;
  },
  step: () => ({ status: 'completed' }),
  cancel: () => ({ ok: true }),
  resumable: true,
};
export function readGalleryTour(rt: Runtime, tour: string) {
  const ex = find(rt, tour),
    record = rt.records.get(tour);
  if (!ex || !record) return;
  return structuredClone({
    tour,
    status: record.status,
    mode: ex.mode,
    index: ex.index,
    pad: ex.p.stops[ex.index]?.sharing.pad,
    members: ex.members,
    history: ex.history,
    current: ex.child ? readArtSharing(rt, ex.child) : undefined,
    departures: ex.walks,
    ownedActions: ex.children,
    retry: {
      attempts: ex.attempts,
      limit: ex.p.retryLimit ?? 20,
      nextTick: ex.retryTick,
      automatic:
        ['binding', 'waiting'].includes(ex.mode) &&
        ex.attempts < (ex.p.retryLimit ?? 20) &&
        !ex.recorded,
    },
    finished: ex.finished,
    ...(ex.diagnostic ? { diagnostic: ex.diagnostic } : {}),
  });
}
export const GALLERY_TOUR_ACTIONS: ActionDef[] = [
  galleryTour,
  galleryTourControl,
];
