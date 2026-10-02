// Hypothetical standing wellness practice, never a historical Mars yoga reconstruction.
import { z } from 'zod';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { dist2, dsin, type Vec2 } from '../core/math.ts';
import { humanOf } from '../social/actions.ts';
import { holdingDiagnostic } from '../construction/rules.ts';
import { heldBy } from '../items/model.ts';
import { checkStations } from '../construction/children.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import type { Spatial } from '../spatial/service.ts';
import { clearanceAt, nearestBlocker } from '../spatial/grid.ts';
import { at, bodyFrame, restHand } from '../body/model.ts';
import { lerp3, smooth } from '../items/body.ts';

const id = z.string().min(1).max(80);
const point = z.tuple([
  z.number().min(-500).max(500),
  z.number().min(-500).max(500),
]);
const place = z.strictObject({
  actor: id,
  at: point,
  face: z.number(),
  join: z.boolean().optional(),
  joinAfter: z.number().min(0).max(30).optional(),
  lag: z.number().min(0).max(2).optional(),
});
export interface WarmupPlace {
  actor: string;
  at: Vec2;
  face: number;
  join?: boolean;
  joinAfter?: number;
  lag?: number;
}
export interface GroupWarmupParams {
  instructor: Pick<WarmupPlace, 'actor' | 'at' | 'face'>;
  followers: WarmupPlace[];
  phaseDuration: number;
  cycles: number;
  resumeFrom?: string;
}
interface Member extends WarmupPlace {
  child?: string;
  withdrawn: boolean;
  invited: boolean;
}
interface Session {
  id: string;
  p: GroupWarmupParams;
  elapsed: number;
  mode: 'starting' | 'practice' | 'stopping' | 'ended';
  members: Member[];
  error?: Diagnostic;
  ended: boolean;
}
interface ParticipantParams {
  warmup: string;
  actor: string;
  at: Vec2;
  face: number;
  lag: number;
}
interface Participant {
  id: string;
  p: ParticipantParams;
  child?: string;
  mode: 'arriving' | 'planted' | 'stopping';
  blend: number;
  error?: Diagnostic;
}
const sessions = new WeakMap<Runtime, Map<string, Session>>();
function store(rt: Runtime) {
  let s = sessions.get(rt);
  if (!s) {
    s = new Map();
    sessions.set(rt, s);
  }
  return s;
}
const issue = (
  code: string,
  message: string,
  subjects: string[],
): Diagnostic => ({ code: `group-warmup.${code}`, message, subjects });
export const WARMUP_CLEARANCE = HUMAN_PROFILE.radius + 0.38;
export const WARMUP_RELEASE_TIME = 0.5;
export const WARMUP_PHASES = ['settle', 'raise', 'open', 'lower'] as const;
export function warmupTiming(elapsed: number, phaseDuration: number) {
  const n = Math.max(0, elapsed) / phaseDuration,
    index = Math.floor(n) % 4;
  return {
    phase: WARMUP_PHASES[index],
    progress: n - Math.floor(n),
    cycle: Math.floor(n / 4),
  };
}
function floorIssue(
  rt: Runtime,
  p: WarmupPlace,
  claims = true,
): Diagnostic | null {
  const actor = humanOf(rt, p.actor);
  if ('code' in actor) return actor;
  if (
    actor.human!.level !== 0 ||
    actor.human!.on ||
    actor.human!.riding ||
    Math.abs(actor.pose.p[1]) > 0.03
  )
    return issue(
      'ground-required',
      `${p.actor} requires supported flat ground at (${p.at.join(', ')})`,
      [p.actor],
    );
  const load = holdingDiagnostic(rt.world, p.actor);
  if (load) return load;
  const items = heldBy(rt.world, p.actor).map(({ item }) => item.id);
  if (items.length)
    return issue(
      'hands-occupied',
      `${p.actor} must release ${items.join(', ')} before warm-up`,
      [p.actor, ...items],
    );
  const sp = rt.services.spatial as Spatial;
  sp.sync(rt.world);
  const grid = sp.level(0);
  if (!grid || clearanceAt(grid, p.at) < WARMUP_CLEARANCE)
    return issue(
      'floor-clearance',
      `${p.actor}'s standing arm envelope at (${p.at.join(', ')}) is blocked by ${grid ? (nearestBlocker(grid, p.at) ?? 'floor edge') : 'missing ground'}; needs ${WARMUP_CLEARANCE} m clearance`,
      [p.actor],
    );
  for (const e of Object.values(rt.world.entities))
    if (
      e.human &&
      e.id !== p.actor &&
      e.human.level === 0 &&
      dist2(p.at, [e.pose.p[0], e.pose.p[2]]) <
        WARMUP_CLEARANCE + HUMAN_PROFILE.radius
    )
      return issue(
        'floor-occupied',
        `${e.id} occupies ${p.actor}'s warm-up place (${p.at.join(', ')})`,
        [p.actor, e.id],
      );
  if (claims) {
    for (const r of rt.records.values()) {
      if (!rt.isActive(r.id) || r.verb !== 'warmup_participant') continue;
      const other = r.params as ParticipantParams;
      if (
        other.actor !== p.actor &&
        dist2(other.at, p.at) < 2 * WARMUP_CLEARANCE
      )
        return issue(
          'floor-overlap',
          `${p.actor}'s place overlaps reserved warm-up place of ${other.actor} (${r.id})`,
          [p.actor, other.actor, r.id],
        );
    }
    return checkStations(rt, [{ actor: p.actor, p: p.at, level: 0 }]);
  }
  return null;
}
function release(rt: Runtime, ex: Participant): StepResult {
  if (ex.child && rt.isActive(ex.child)) {
    rt.cancel(ex.child);
    return { status: 'running', phase: 'stopping-walk' };
  }
  const h = rt.world.entities[ex.p.actor]?.human;
  if (h?.task === ex.id) {
    if (ex.blend > 0) return { status: 'running', phase: 'lower-hands' };
    delete h.hands;
    h.task = undefined;
    h.activity = 'idle';
  }
  return ex.error
    ? { status: 'failed', diagnostic: ex.error }
    : { status: 'completed' };
}
export const warmupParticipant: ActionDef<
  ParticipantParams,
  null,
  Participant
> = {
  verb: 'warmup_participant',
  description:
    'Walk to a clear standing place, follow instructor timing with bounded lag, and lower hands before releasing support and actor ownership.',
  schema: place
    .pick({ actor: true, at: true, face: true })
    .extend({ warmup: id, lag: z.number().min(0).max(2) }),
  reservations: (_w, p) => [
    { resource: `actor:${p.actor}`, mode: 'exclusive' },
    { resource: `warmup-place:${p.at.join(',')}`, mode: 'exclusive' },
  ],
  plan(rt, p) {
    const s = store(rt).get(p.warmup);
    if (
      !s ||
      !rt.isActive(p.warmup) ||
      !s.members.some(
        (m) =>
          m.actor === p.actor &&
          JSON.stringify(m.at) === JSON.stringify(p.at) &&
          m.face === p.face &&
          (m.lag ?? 0) === p.lag,
      )
    )
      return {
        ok: false,
        diagnostic: issue(
          'participant-binding',
          `${p.actor} has no matching place in active warm-up ${p.warmup}`,
          [p.actor, p.warmup],
        ),
      };
    const bad = floorIssue(rt, p);
    return bad ? { ok: false, diagnostic: bad } : { ok: true, program: null };
  },
  start(rt, p, _prog, action) {
    const ex: Participant = {
      id: action,
      p: structuredClone(p),
      mode: 'arriving',
      blend: 0,
    };
    const child = rt.submit(
      'walk_to',
      { actor: p.actor, x: p.at[0], z: p.at[1], face: p.face, level: 0 },
      { parent: action, preempt: false },
    );
    ex.child = child.id;
    if (child.status === 'failed') {
      ex.error = child.diagnostic;
      ex.mode = 'stopping';
    }
    return ex;
  },
  step(rt, ex, dt) {
    const h = rt.world.entities[ex.p.actor]?.human;
    if (!h)
      return {
        status: 'failed',
        diagnostic: issue(
          'actor-missing',
          `${ex.p.actor} disappeared during warm-up`,
          [ex.p.actor],
        ),
      };
    if (ex.mode === 'arriving') {
      const child = rt.records.get(ex.child!)!;
      if (rt.isActive(child.id))
        return { status: 'running', phase: 'approaching-place' };
      if (child.status !== 'completed') {
        ex.error =
          child.diagnostic ??
          issue(
            'arrival-stopped',
            `${ex.p.actor}'s walk ${child.id} ended ${child.status}`,
            [ex.p.actor, child.id],
          );
        ex.mode = 'stopping';
      } else {
        h.task = ex.id;
        h.activity = 'listen';
        ex.mode = 'planted';
      }
    }
    const s = store(rt).get(ex.p.warmup);
    if (ex.mode === 'planted') {
      const bad = floorIssue(rt, ex.p, false);
      if (bad) {
        ex.error = bad;
        ex.mode = 'stopping';
      }
    }
    if (!s || s.mode === 'stopping' || s.mode === 'ended') ex.mode = 'stopping';
    const playing = ex.mode === 'planted' && s?.mode === 'practice';
    const time = warmupTiming(
      Math.max(0, (s?.elapsed ?? 0) - ex.p.lag),
      s?.p.phaseDuration ?? 2,
    );
    // A continuous four-phase cycle. Feet/root never move after ordinary arrival.
    const t = smooth(time.progress),
      lift =
        time.phase === 'settle'
          ? 0
          : time.phase === 'raise'
            ? t
            : time.phase === 'open'
              ? 1
              : 1 - t;
    const spread = time.phase === 'open' ? dsin(Math.PI * time.progress) : 0;
    ex.blend = Math.max(
      0,
      Math.min(1, ex.blend + (playing ? dt : -dt) / WARMUP_RELEASE_TIME),
    );
    if (h.task === ex.id) {
      h.activity = 'listen';
      const b = bodyFrame(rt.world.entities[ex.p.actor]),
        k = smooth(ex.blend);
      h.hands = {
        left: lerp3(
          restHand(b, 'left'),
          at(b, 0.02 + 0.2 * lift, -0.18 - 0.24 * spread, 0.72 + 0.7 * lift),
          k,
        ),
        right: lerp3(
          restHand(b, 'right'),
          at(b, 0.02 + 0.2 * lift, 0.18 + 0.24 * spread, 0.72 + 0.7 * lift),
          k,
        ),
      };
    }
    return ex.mode === 'stopping'
      ? release(rt, ex)
      : {
          status: 'running',
          phase: playing ? time.phase : 'awaiting-instructor',
        };
  },
  cancel(_rt, ex) {
    ex.mode = 'stopping';
    return { ok: true, deferred: true };
  },
  yieldTo: (_rt, self, _holder, _actor, by) =>
    /:make-way:\d+$/.test(by.id) ? [] : [self.id],
  resumable:
    'Active standing warm-up restoration is unsupported; same-runtime Resume uses retained instructor progress.',
};
function binding(p: GroupWarmupParams) {
  const { resumeFrom: _resume, ...rest } = p;
  return JSON.stringify(rest);
}
function preflight(rt: Runtime, p: GroupWarmupParams): Diagnostic | null {
  const old = p.resumeFrom ? store(rt).get(p.resumeFrom) : undefined;
  if (
    p.resumeFrom &&
    (!old || rt.isActive(old.id) || old.ended || binding(p) !== binding(old.p))
  )
    return issue(
      'resume-binding',
      `Resume needs a paused original warm-up with unchanged places/timing: ${p.resumeFrom}`,
      [p.resumeFrom],
    );
  const members: WarmupPlace[] = [p.instructor, ...p.followers],
    actors = members.map((m) => m.actor);
  if (new Set(actors).size !== actors.length)
    return issue(
      'duplicate-role',
      `Warm-up needs distinct instructor/followers: ${actors.join(', ')}`,
      actors,
    );
  for (const verb of ['walk_to', 'warmup_participant'])
    if (!rt.registry.has(verb))
      return issue('executor-missing', `Warm-up requires ${verb}`, [verb]);
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    if (i > 0 && dist2(m.at, p.instructor.at) > 8)
      return issue(
        'attention-distance',
        `${m.actor}'s place is beyond 8 m of instructor ${p.instructor.actor}`,
        [m.actor, p.instructor.actor],
      );
    for (const n of members.slice(i + 1))
      if (dist2(m.at, n.at) < 2 * WARMUP_CLEARANCE)
        return issue(
          'floor-overlap',
          `${m.actor} and ${n.actor} require separate planted arm envelopes`,
          [m.actor, n.actor],
        );
    if (
      i > 0 &&
      (old?.members.find((n) => n.actor === m.actor)?.withdrawn ||
        !(
          old?.members.find((n) => n.actor === m.actor)?.invited ??
          m.join !== false
        ))
    )
      continue;
    const held = rt.holder(`actor:${m.actor}`);
    if (held.length)
      return issue(
        'participant-busy',
        `${m.actor} remains owned by ${held.join(', ')}`,
        [m.actor, ...held],
      );
    const bad = floorIssue(rt, m);
    if (bad) return bad;
  }
  return null;
}
function join(rt: Runtime, s: Session, m: Member): Diagnostic | null {
  const child = rt.submit(
    'warmup_participant',
    { warmup: s.id, actor: m.actor, at: m.at, face: m.face, lag: m.lag ?? 0 },
    { parent: s.id, preempt: false },
  );
  if (child.status === 'failed') return child.diagnostic!;
  m.child = child.id;
  m.invited = true;
  m.withdrawn = false;
  return null;
}
function drain(rt: Runtime, s: Session): StepResult {
  for (const m of s.members)
    if (m.child && rt.isActive(m.child)) rt.cancel(m.child);
  if (s.members.some((m) => m.child && rt.isActive(m.child)))
    return { status: 'running', phase: 'safe-release' };
  s.mode = 'ended';
  return s.error
    ? { status: 'failed', diagnostic: s.error }
    : { status: 'completed', outputs: { elapsed: s.elapsed, ended: s.ended } };
}
export const groupWarmup: ActionDef<GroupWarmupParams, null, Session> = {
  verb: 'group_warmup',
  description:
    'Bounded hypothetical instructor-following standing warm-up with staggered independent followers, retained pause/resume timing and safe hand release.',
  schema: z.strictObject({
    instructor: place.pick({ actor: true, at: true, face: true }),
    followers: z.array(place).min(1).max(5),
    phaseDuration: z.number().min(1).max(10),
    cycles: z.number().int().min(1).max(5),
    resumeFrom: id.optional(),
  }),
  reservations: (_w, p) => [
    { resource: `warmup:${p.instructor.actor}`, mode: 'exclusive' },
  ],
  plan(rt, p) {
    const bad = preflight(rt, p);
    return bad ? { ok: false, diagnostic: bad } : { ok: true, program: null };
  },
  start(rt, p, _prog, action) {
    const old = p.resumeFrom ? store(rt).get(p.resumeFrom) : undefined;
    const members: WarmupPlace[] = [p.instructor, ...p.followers];
    const s: Session = {
      id: action,
      p: structuredClone(p),
      elapsed: old?.elapsed ?? 0,
      mode: 'starting',
      ended: false,
      members: members.map((m, i) => ({
        ...structuredClone(m),
        lag: i ? (m.lag ?? 0) : 0,
        invited:
          i === 0 ||
          (old?.members.find((n) => n.actor === m.actor)?.invited ??
            m.join !== false),
        withdrawn:
          i > 0
            ? (old?.members.find((n) => n.actor === m.actor)?.withdrawn ??
              false)
            : false,
      })),
    };
    store(rt).set(action, s);
    return s;
  },
  step(rt, s, dt) {
    if (s.mode === 'stopping') return drain(rt, s);
    if (s.mode === 'starting') {
      const bad = join(rt, s, s.members[0]);
      if (bad) {
        s.error = bad;
        s.mode = 'stopping';
        return drain(rt, s);
      }
      s.mode = 'practice';
    }
    const instructor = s.members[0];
    if (instructor.child && !rt.isActive(instructor.child)) {
      s.error =
        rt.records.get(instructor.child)?.diagnostic ??
        issue(
          'instructor-stopped',
          `${instructor.actor} stopped guiding ${s.id}`,
          [instructor.actor, s.id],
        );
      s.mode = 'stopping';
      return drain(rt, s);
    }
    const ready =
      instructor.child &&
      [...WARMUP_PHASES, 'awaiting-instructor'].includes(
        rt.records.get(instructor.child)?.phase ?? '',
      );
    if (ready) s.elapsed += dt;
    for (const m of s.members.slice(1)) {
      if (m.child && !rt.isActive(m.child)) m.withdrawn = true;
      if (
        !m.child &&
        m.invited &&
        !m.withdrawn &&
        s.elapsed >= (m.joinAfter ?? 0)
      ) {
        const bad = join(rt, s, m);
        if (bad) {
          s.error = bad;
          s.mode = 'stopping';
          return drain(rt, s);
        }
      }
    }
    if (s.elapsed >= 4 * s.p.phaseDuration * s.p.cycles) {
      s.elapsed = 4 * s.p.phaseDuration * s.p.cycles;
      s.ended = true;
      s.mode = 'stopping';
      return drain(rt, s);
    }
    return {
      status: 'running',
      phase: ready
        ? warmupTiming(s.elapsed, s.p.phaseDuration).phase
        : 'arriving-instructor',
    };
  },
  cancel(_rt, s) {
    s.mode = 'stopping';
    return { ok: true, deferred: true };
  },
  yieldTo: (_rt, _self, holder, _actor, by) =>
    /:make-way:\d+$/.test(by.id) ? [] : [holder.id],
  onDirective(rt, s, by, claims, ancestors) {
    if (ancestors.includes(s.id) || s.mode === 'stopping' || s.mode === 'ended')
      return;
    for (const m of s.members)
      if (claims.some((c) => c.resource === `actor:${m.actor}`)) {
        m.withdrawn = true;
        if (m === s.members[0])
          rt.cancel(
            s.id,
            issue(
              'instructor-directed',
              `${by.id} supersedes instructor ${m.actor}; warm-up pauses`,
              [by.id, m.actor],
            ),
          );
      }
  },
  resumable:
    'Active warm-up graph restoration is unsupported; explicit same-runtime Resume retains clock and withdrawals.',
};
export interface GroupWarmupControlParams {
  warmup: string;
  command: 'join' | 'leave' | 'pause' | 'end';
  actor?: string;
}
export const groupWarmupControl: ActionDef<
  GroupWarmupControlParams,
  null,
  GroupWarmupControlParams
> = {
  verb: 'group_warmup_control',
  description:
    'Join/leave one follower or pause/end the bounded warm-up with safe physical release.',
  schema: z.strictObject({
    warmup: id,
    command: z.enum(['join', 'leave', 'pause', 'end']),
    actor: id.optional(),
  }),
  reservations: () => [],
  plan(rt, p) {
    const s = store(rt).get(p.warmup);
    if (!s || !rt.isActive(s.id) || s.mode !== 'practice')
      return {
        ok: false,
        diagnostic: issue('control-target', `No active warm-up ${p.warmup}`, [
          p.warmup,
        ]),
      };
    if (p.command === 'join' || p.command === 'leave') {
      const m = s.members.slice(1).find((m) => m.actor === p.actor);
      if (!m)
        return {
          ok: false,
          diagnostic: issue(
            'follower-required',
            `${p.actor ?? 'missing actor'} is no follower of ${p.warmup}`,
            [p.warmup, p.actor ?? 'missing actor'],
          ),
        };
      if (p.command === 'join') {
        if (m.child && rt.isActive(m.child))
          return {
            ok: false,
            diagnostic: issue(
              'already-present',
              `${m.actor} is still arriving, practising or lowering hands`,
              [m.actor],
            ),
          };
        const held = rt.holder(`actor:${m.actor}`),
          bad = held.length
            ? issue(
                'participant-busy',
                `${m.actor} remains owned by ${held.join(', ')}`,
                [m.actor, ...held],
              )
            : floorIssue(rt, m);
        if (bad) return { ok: false, diagnostic: bad };
      }
    }
    return { ok: true, program: null };
  },
  start(rt, p) {
    const s = store(rt).get(p.warmup)!;
    // Accepted intent is immediate; the ordinary participants still lower hands
    // and release their physical ownership through subsequent fixed ticks.
    if (p.command === 'pause' || p.command === 'end') {
      s.ended = p.command === 'end';
      rt.cancel(s.id);
    } else if (p.command === 'leave') {
      const m = s.members.find(m => m.actor === p.actor)!;
      m.withdrawn = true;
      if (m.child && rt.isActive(m.child)) rt.cancel(m.child);
    }
    return p;
  },
  step(rt, p) {
    if (p.command === 'join') {
      const s = store(rt).get(p.warmup);
      if (!s || !rt.isActive(s.id) || s.mode !== 'practice') return {
        status: 'failed', diagnostic: issue('control-target', `${p.warmup} stopped before ${p.actor} could join`, [p.warmup, p.actor ?? 'missing actor']),
      };
      const m = s.members.find((m) => m.actor === p.actor)!;
      const bad = join(rt, s, m);
      if (bad) return { status: 'failed', diagnostic: bad };
    }
    return {
      status: 'completed',
      outputs: { command: p.command, actor: p.actor },
    };
  },
  cancel: () => ({ ok: true }),
};
export function groupWarmupAttention(
  rt: Runtime,
  action: string,
): Record<string, Vec2> {
  const s = sessions.get(rt)?.get(action);
  if (!s || s.mode !== 'practice' || !rt.isActive(action)) return {};
  const instructor = rt.world.entities[s.p.instructor.actor];
  if (!instructor) return {};
  const out: Record<string, Vec2> = {};
  for (const m of s.members.slice(1))
    if (
      m.child &&
      rt.isActive(m.child) &&
      !m.withdrawn &&
      rt.records.get(m.child)?.phase !== 'approaching-place'
    )
      out[m.actor] = [instructor.pose.p[0], instructor.pose.p[2]];
  return out;
}
export function readGroupWarmup(rt: Runtime, action: string) {
  const s = sessions.get(rt)?.get(action),
    r = rt.records.get(action);
  if (!s || !r) return undefined;
  const attention = groupWarmupAttention(rt, action);
  return {
    action,
    status: r.status,
    mode: s.mode,
    phase: r.phase,
    elapsed: s.elapsed,
    ended: s.ended,
    timing: warmupTiming(s.elapsed, s.p.phaseDuration),
    bindings: structuredClone(s.p),
    participants: s.members.map((m, i) => ({
      actor: m.actor,
      role: i === 0 ? 'instructor' : 'follower',
      at: [...m.at],
      child: m.child,
      invited: m.invited,
      withdrawn: m.withdrawn,
      state:
        m.child && rt.isActive(m.child)
          ? (rt.records.get(m.child)?.phase ?? 'approaching-place')
          : m.withdrawn
            ? 'left'
            : s.mode === 'ended'
              ? 'released'
              : 'waiting',
      timing: warmupTiming(
        Math.max(0, s.elapsed - (m.lag ?? 0)),
        s.p.phaseDuration,
      ),
      attention: attention[m.actor],
      hands: structuredClone(rt.world.entities[m.actor]?.human?.hands),
      diagnostic: m.child
        ? structuredClone(rt.records.get(m.child)?.diagnostic)
        : undefined,
    })),
    ...(s.error ? { diagnostic: structuredClone(s.error) } : {}),
  };
}
export function latestGroupWarmup(rt: Runtime) {
  for (const r of [...rt.records.values()].reverse())
    if (r.verb === 'group_warmup') {
      const s = readGroupWarmup(rt, r.id);
      if (s) return s;
    }
  return undefined;
}
export const GROUP_WARMUP_ACTIONS: ActionDef[] = [
  groupWarmup,
  warmupParticipant,
  groupWarmupControl,
];
