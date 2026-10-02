// Bounded artifact sharing: ordinary take_slot children own every body, walk and heading.
import { z } from 'zod';
import type {
  ActionDef,
  ActionStatus,
  Diagnostic,
  StepResult,
} from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import {
  angleDelta,
  dist2,
  heading,
  rot2,
  sub2,
  type Vec2,
  type Vec3,
} from '../core/math.ts';
import { hashOf } from '../core/hash.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import type { Spatial } from '../spatial/service.ts';
import { clearanceAt, nearestBlocker } from '../spatial/grid.ts';
import { heldBy } from '../items/model.ts';
import {
  slotById,
  occupantOf,
  SLOT_CLEARANCE,
  type Slot,
} from '../social/slots.ts';
import {
  drawingIssue,
  drawingConfig,
  readDrawing,
  DRAWING_MARK_TICKS,
  DRAWING_TOTAL_TICKS,
} from '../objects/drawing.ts';
export interface ArtSharingPlace {
  actor: string;
  slot: string;
  join?: boolean;
}
export interface ArtSharingParams {
  pad: string;
  host: ArtSharingPlace;
  visitors: ArtSharingPlace[];
  duration?: number;
  turnSeconds?: number;
}
export type ArtSharingIntent =
  | { kind: 'pause' | 'resume' | 'end' }
  | { kind: 'ask' | 'answer' | 'floor' | 'join'; actor: string }
  | { kind: 'leave'; actor: string; to: Vec2 };
export interface ArtSharingControlParams {
  session: string;
  intent: ArtSharingIntent;
}
type Mode =
  | 'arriving'
  | 'sharing'
  | 'changing'
  | 'draining'
  | 'paused'
  | 'waiting'
  | 'ending'
  | 'completed';
type Member = ArtSharingPlace & {
  role: 'host' | 'visitor';
  active: boolean;
  state: 'invited' | 'participating' | 'left' | 'directed-away';
  hold?: string;
  departure?: string;
};
type Turn = {
  actor: string;
  kind: 'comment' | 'question' | 'answer';
  elapsed: number;
  replyTo?: number;
};
export interface ArtSharingEffect {
  index: number;
  pad: string;
  actor: string;
  kind: Turn['kind'];
  seconds: number;
  marks: number;
  replyTo?: number;
}
type Exec = {
  id: string;
  p: ArtSharingParams;
  mode: Mode;
  members: Member[];
  children: string[];
  expected: string[];
  binding: string;
  elapsed: number;
  turn: Turn;
  effects: ArtSharingEffect[];
  queue: Turn[];
  pendingQuestion?: number;
  error?: Diagnostic;
  ending: boolean;
  finished: boolean;
  phaseTick: number;
};
const store = (rt: Runtime): Record<string, Exec> =>
  (rt.services.artSharingSessions ??= {});
const find = (rt: Runtime, id: string): Exec | undefined =>
  (rt.services.artSharingSessions as Record<string, Exec> | undefined)?.[id];
const diag = (
  code: string,
  message: string,
  subjects: string[],
  cause?: Diagnostic,
): Diagnostic => ({
  code: `art_sharing.${code}`,
  message,
  subjects,
  ...(cause ? { details: { cause } } : {}),
});
const places = (p: ArtSharingParams) => [p.host, ...p.visitors];
const duration = (p: ArtSharingParams) => p.duration ?? 32;
const period = (p: ArtSharingParams) => p.turnSeconds ?? 4;
const active = (ex: Exec) => ex.members.filter((m) => m.active);
const owned = (rt: Runtime, ex: Exec, id: string) => {
  for (
    let r = rt.records.get(id);
    r;
    r = r.parent ? rt.records.get(r.parent) : undefined
  )
    if (r.id === ex.id) return true;
  return false;
};
function artifactIssue(rt: Runtime, pad: string): Diagnostic | undefined {
  const issue = drawingIssue(rt, pad);
  if (issue)
    return diag(
      'artifact',
      issue.message,
      [pad, ...(issue.subjects ?? [])],
      issue,
    );
  const c = drawingConfig(rt.world.entities[pad]),
    ticks = c.drawTicks;
  if (
    !Number.isInteger(ticks) ||
    typeof ticks !== 'number' ||
    ticks < DRAWING_MARK_TICKS ||
    ticks > DRAWING_TOTAL_TICKS ||
    !['unfinished', 'completed'].includes(String(c.status))
  )
    return diag(
      'blank-artifact',
      `${pad} needs at least one completed retained drawing mark and a safely stopped drawing task`,
      [pad],
    );
}
function artifactBinding(rt: Runtime, pad: string) {
  const e = rt.world.entities[pad],
    c = e ? drawingConfig(e) : {};
  return hashOf({
    pose: e?.pose,
    support: e?.support,
    ticks: c.drawTicks,
    task: c.task,
    pencil: c.pencil,
    user: c.user,
  });
}
/** Horizontal visibility at this bounded tabletop; ignore its actual support table only. */
function hitsSegment(
  a: Vec2,
  b: Vec2,
  obb: { c: Vec2; half: Vec2; yaw: number },
) {
  const p = rot2(sub2(a, obb.c), -obb.yaw),
    q = rot2(sub2(b, obb.c), -obb.yaw);
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 2; i++) {
    const d = q[i] - p[i];
    if (Math.abs(d) < 1e-9) {
      if (Math.abs(p[i]) > obb.half[i]) return false;
    } else {
      let t0 = (-obb.half[i] - p[i]) / d,
        t1 = (obb.half[i] - p[i]) / d;
      if (t0 > t1) [t0, t1] = [t1, t0];
      lo = Math.max(lo, t0);
      hi = Math.min(hi, t1);
      if (lo > hi) return false;
    }
  }
  return hi > 1e-6 && lo < 1 - 1e-6;
}
function placeIssue(
  rt: Runtime,
  p: ArtSharingParams,
  member: ArtSharingPlace,
  session?: Exec,
): Diagnostic | undefined {
  const a = rt.world.entities[member.actor],
    s = slotById(rt, member.slot),
    pad = rt.world.entities[p.pad];
  if (
    !a?.human ||
    a.human.level !== 0 ||
    Math.abs(a.pose.p[1]) > 0.01 ||
    a.human.grip ||
    a.human.riding ||
    a.human.on
  )
    return diag(
      'actor-ground',
      `${member.actor} must be a grounded free-handed person at ${p.pad}`,
      [member.actor, p.pad],
    );
  const held = heldBy(rt.world, member.actor);
  if (held.length)
    return diag(
      'hands',
      `${member.actor} must put down ${held.map((q) => q.item.id).join(', ')} before viewing ${p.pad}`,
      [member.actor, ...held.map((q) => q.item.id)],
    );
  if ('code' in s)
    return diag(
      'place',
      s.message,
      [member.actor, member.slot, ...(s.subjects ?? [])],
      s,
    );
  if (s.level !== 0 || !['stand', 'audience'].includes(s.kind))
    return diag(
      'standing-place',
      `${member.slot} must be a declared ground stand/audience slot`,
      [member.slot, member.actor],
    );
  const target: Vec2 = [pad.pose.p[0], pad.pose.p[2]],
    distance = dist2(s.p, target);
  if (
    distance < 0.65 ||
    distance > 1.8 ||
    Math.abs(angleDelta(s.yaw, heading(sub2(target, s.p)))) > 0.18
  )
    return diag(
      'viewing-orientation',
      `${member.slot} must face ${p.pad} from 0.65–1.8 m; distance ${distance.toFixed(2)} m`,
      [member.slot, p.pad],
    );
  const holders = rt
    .holder(`actor:${member.actor}`)
    .filter((id) => !session || !owned(rt, session, id));
  if (holders.length || (!session && a.human.activity !== 'idle'))
    return diag(
      'actor-busy',
      `${member.actor} is held by ${holders.join(', ') || a.human.activity}`,
      [member.actor, ...holders],
    );
  const claims = rt
    .holder(`slot:${member.slot}`)
    .filter((id) => !session || !owned(rt, session, id));
  const occupant = occupantOf(rt.world, s, new Set([member.actor]));
  if (claims.length || occupant)
    return diag(
      'place-occupied',
      `${member.slot} is occupied by ${occupant ?? claims.join(', ')}`,
      [member.slot, ...claims, ...(occupant ? [occupant] : [])],
    );
  const sp = rt.services.spatial as Spatial | undefined;
  if (!sp || sp.base.links.some((l) => l.usable))
    return diag(
      'ground-scene',
      `${p.pad} requires a spatial ground-only sharing setup`,
      [p.pad],
    );
  sp.sync(rt.world);
  const grid = sp.level(0),
    block = grid ? nearestBlocker(grid, s.p) : undefined;
  if (!grid || clearanceAt(grid, s.p) < SLOT_CLEARANCE)
    return diag(
      'place-blocked',
      `${member.slot} lacks ${SLOT_CLEARANCE} m clearance from ${block ?? 'ground edge'}`,
      [member.slot, ...(block ? [block] : [])],
    );
  const support = pad.support?.kind === 'resting-on' ? pad.support.on : '';
  for (const obstacle of sp.scene.obstacles)
    if (
      obstacle.id !== support &&
      obstacle.y1 > pad.pose.p[1] + 0.012 &&
      obstacle.y0 < 1.3 &&
      hitsSegment(s.p, target, obstacle.obb)
    )
      return diag(
        'view-blocked',
        `${obstacle.id} blocks ${member.actor}'s view of actual artwork ${p.pad}`,
        [member.actor, p.pad, obstacle.id],
      );
  const plan = rt.registry
    .get('take_slot')
    ?.plan(rt, { actor: member.actor, slot: member.slot, activity: 'listen' });
  if (!plan)
    return diag('missing-action', `${p.pad} requires registered take_slot`, [
      p.pad,
      'take_slot',
    ]);
  if (!plan.ok)
    return diag(
      'place-route',
      plan.diagnostic.message,
      [member.actor, member.slot, ...(plan.diagnostic.subjects ?? [])],
      plan.diagnostic,
    );
}
function setupIssue(
  rt: Runtime,
  p: ArtSharingParams,
  ex?: Exec,
): Diagnostic | undefined {
  const issue = artifactIssue(rt, p.pad);
  if (issue) return issue;
  const members = ex
    ? active(ex)
    : places(p).filter((m) => m.actor === p.host.actor || m.join !== false);
  const all = places(p);
  if (
    new Set(all.map((m) => m.actor)).size !== all.length ||
    new Set(all.map((m) => m.slot)).size !== all.length
  )
    return diag(
      'duplicate',
      `Sharing requires distinct people and declared places around ${p.pad}`,
      all.map((m) => m.actor),
    );
  const slots: Slot[] = [];
  for (const m of all) {
    const s = slotById(rt, m.slot);
    if ('code' in s) return diag('place', s.message, [m.actor, m.slot], s);
    for (const other of slots)
      if (dist2(s.p, other.p) < 2 * HUMAN_PROFILE.radius + 0.15)
        return diag(
          'places-overlap',
          `${m.slot} overlaps ${other.id} around ${p.pad}`,
          [m.slot, other.id, p.pad],
        );
    slots.push(s);
  }
  for (const m of members) {
    const error = placeIssue(rt, p, m, ex);
    if (error) return error;
  }
}
function stopHold(rt: Runtime, ex: Exec, m: Member) {
  if (m.hold && rt.isActive(m.hold)) {
    ex.expected.push(m.hold);
    rt.cancel(m.hold);
  }
  m.hold = undefined;
}
function beginDrain(rt: Runtime, ex: Exec, end = false, error?: Diagnostic) {
  ex.ending ||= end;
  ex.error = error;
  ex.mode = ex.ending ? 'ending' : 'draining';
  for (const m of ex.members) stopHold(rt, ex, m);
}
function drain(rt: Runtime, ex: Exec): StepResult {
  for (const id of ex.children) if (rt.isActive(id)) rt.cancel(id);
  if (ex.children.some((id) => rt.isActive(id)))
    return { status: 'running', phase: 'safe-release' };
  if (ex.ending) {
    ex.mode = 'completed';
    return ex.error
      ? { status: 'failed', diagnostic: ex.error }
      : {
          status: 'completed',
          outputs: {
            pad: ex.p.pad,
            finished: ex.finished,
            seconds: ex.elapsed,
            effects: structuredClone(ex.effects),
          },
        };
  }
  ex.mode = ex.error ? 'waiting' : 'paused';
  return ex.error
    ? { status: 'blocked', diagnostic: ex.error }
    : { status: 'running', phase: 'paused' };
}
function bindHold(rt: Runtime, ex: Exec, m: Member) {
  const rec = rt.submit(
    'take_slot',
    {
      actor: m.actor,
      slot: m.slot,
      activity: m.actor === ex.turn.actor ? 'talk' : 'listen',
    },
    { parent: ex.id, preempt: false },
  );
  m.hold = rec.id;
  ex.children.push(rec.id);
  if (rec.status === 'failed')
    beginDrain(
      rt,
      ex,
      false,
      diag(
        'hold-refused',
        `${m.actor} could not occupy ${m.slot}: ${rec.diagnostic?.message}`,
        [m.actor, m.slot, rec.id],
        rec.diagnostic,
      ),
    );
}
function changeTurn(rt: Runtime, ex: Exec, turn: Turn) {
  const old = ex.members.find((m) => m.actor === ex.turn.actor),
    next = ex.members.find((m) => m.actor === turn.actor && m.active);
  if (!next) return;
  if (old) stopHold(rt, ex, old);
  if (old !== next) stopHold(rt, ex, next);
  ex.turn = turn;
  ex.mode = 'changing';
  ex.phaseTick = rt.tick;
  if (old?.active) bindHold(rt, ex, old);
  if (old !== next) bindHold(rt, ex, next);
  rt.mark('art_sharing.floor', {
    session: ex.id,
    pad: ex.p.pad,
    actor: turn.actor,
    kind: turn.kind,
    replyTo: turn.replyTo,
  });
}
function completeTurn(rt: Runtime, ex: Exec) {
  if (ex.turn.elapsed <= 0) return;
  const c = drawingConfig(rt.world.entities[ex.p.pad]),
    effect: ArtSharingEffect = {
      index: ex.effects.length,
      pad: ex.p.pad,
      actor: ex.turn.actor,
      kind: ex.turn.kind,
      seconds: ex.turn.elapsed,
      marks: Math.floor(Number(c.drawTicks) / DRAWING_MARK_TICKS),
      ...(ex.turn.replyTo !== undefined ? { replyTo: ex.turn.replyTo } : {}),
    };
  ex.effects.push(effect);
  c.sharingTurns =
    (typeof c.sharingTurns === 'number' ? c.sharingTurns : 0) + 1;
  c.sharingLastSession = ex.id;
  if (effect.kind === 'question') ex.pendingQuestion = effect.index;
  else if (effect.kind === 'answer') {
    ex.pendingQuestion = undefined;
    c.sharingAnswers =
      (typeof c.sharingAnswers === 'number' ? c.sharingAnswers : 0) + 1;
  }
  rt.mark('art_sharing.contribution', { session: ex.id, ...effect });
  ex.turn.elapsed = 0;
}
function nextTurn(ex: Exec): Turn {
  while (ex.queue.length) {
    const q = ex.queue.shift()!;
    if (active(ex).some((m) => m.actor === q.actor)) return q;
  }
  if (ex.pendingQuestion !== undefined) {
    const question = ex.effects[ex.pendingQuestion],
      speaker =
        active(ex).find(
          (m) => m.role === 'host' && m.actor !== question.actor,
        ) ?? active(ex).find((m) => m.actor !== question.actor);
    if (speaker)
      return {
        actor: speaker.actor,
        kind: 'answer',
        elapsed: 0,
        replyTo: question.index,
      };
  }
  const people = active(ex),
    index = people.findIndex((m) => m.actor === ex.turn.actor);
  return {
    actor: people[(index + 1) % people.length].actor,
    kind: 'comment',
    elapsed: 0,
  };
}
const id = z.string().min(1).max(80),
  xz = z.tuple([z.number().min(-500).max(500), z.number().min(-500).max(500)]),
  place = z.strictObject({ actor: id, slot: id, join: z.boolean().optional() });
export const artSharing: ActionDef<ArtSharingParams, null, Exec> = {
  verb: 'art_sharing',
  description:
    'Share an existing marked tabletop drawing through declared physical viewing places, artifact-facing attention, bounded turns and retained discussion effects.',
  schema: z.strictObject({
    pad: id,
    host: place,
    visitors: z.array(place).min(2).max(4),
    duration: z.number().min(4).max(600).optional(),
    turnSeconds: z.number().min(1).max(20).optional(),
  }),
  reservations(w, p) {
    const pad = w.entities[p.pad],
      table = pad?.support?.kind === 'resting-on' ? pad.support.on : undefined;
    return [
      { resource: `entity:${p.pad}`, mode: 'exclusive' },
      ...(table
        ? [{ resource: `entity:${table}`, mode: 'shared' as const }]
        : []),
      ...places(p).map((m) => ({
        resource: `art-sharing:${m.actor}`,
        mode: 'exclusive' as const,
      })),
    ];
  },
  plan(rt, p) {
    const issue = setupIssue(rt, p);
    if (issue) return { ok: false, diagnostic: issue };
    if (p.visitors.filter((m) => m.join !== false).length < 2)
      return {
        ok: false,
        diagnostic: diag(
          'audience',
          `${p.pad} needs two initially participating visitors`,
          [p.pad, ...p.visitors.map((m) => m.actor)],
        ),
      };
    return { ok: true, program: null };
  },
  start(rt, p, _program, id) {
    const ex: Exec = {
      id,
      p: structuredClone(p),
      mode: 'arriving',
      members: places(p).map((m) => ({
        ...m,
        role: m.actor === p.host.actor ? 'host' : 'visitor',
        active: m.actor === p.host.actor || m.join !== false,
        state:
          m.actor === p.host.actor || m.join !== false
            ? 'participating'
            : 'invited',
      })),
      children: [],
      expected: [],
      binding: artifactBinding(rt, p.pad),
      elapsed: 0,
      turn: { actor: p.host.actor, kind: 'comment', elapsed: 0 },
      effects: [],
      queue: [],
      ending: false,
      finished: false,
      phaseTick: rt.tick,
    };
    store(rt)[id] = ex;
    return ex;
  },
  onDirective(rt, ex, by, claims, ancestors) {
    if (
      ex.ending ||
      ['paused', 'waiting', 'draining'].includes(ex.mode) ||
      ancestors.includes(ex.id) ||
      by.verb === 'art_sharing_control'
    )
      return;
    for (const m of active(ex))
      if (claims.some((c) => c.resource === `actor:${m.actor}`)) {
        stopHold(rt, ex, m);
        m.state = 'directed-away';
        if (m.role === 'host')
          beginDrain(
            rt,
            ex,
            false,
            diag(
              'host-directed',
              `${by.id} directs host ${m.actor} away; explicit sharing resume is required`,
              [by.id, m.actor, ex.id],
            ),
          );
        else {
          m.active = false;
          rt.mark('art_sharing.left', {
            session: ex.id,
            actor: m.actor,
            directive: by.id,
          });
        }
      }
  },
  step(rt, ex, dt) {
    if (ex.mode === 'draining' || ex.mode === 'ending') return drain(rt, ex);
    if (ex.mode === 'paused' || ex.mode === 'waiting')
      return ex.error
        ? { status: 'blocked', diagnostic: ex.error }
        : { status: 'running', phase: 'paused' };
    const issue = artifactIssue(rt, ex.p.pad);
    if (issue || artifactBinding(rt, ex.p.pad) !== ex.binding) {
      beginDrain(
        rt,
        ex,
        false,
        issue ??
          diag(
            'artifact-changed',
            `${ex.p.pad}'s artwork or support changed; its discussion cannot silently switch artifacts`,
            [ex.p.pad],
          ),
      );
      return drain(rt, ex);
    }
    if (active(ex).length < 2) {
      beginDrain(
        rt,
        ex,
        false,
        diag(
          'audience-left',
          `${ex.p.pad} needs the host and at least one present visitor to continue`,
          [ex.p.pad, ex.p.host.actor],
        ),
      );
      return drain(rt, ex);
    }
    for (const m of active(ex)) {
      if (!m.hold) {
        const bad = placeIssue(rt, ex.p, m, ex);
        if (bad) {
          beginDrain(rt, ex, false, bad);
          return drain(rt, ex);
        }
        bindHold(rt, ex, m);
        if ((ex.mode as Mode) === 'draining') return drain(rt, ex);
      }
      const rec = rt.records.get(m.hold!)!;
      if (!rt.isActive(rec.id) && !ex.expected.includes(rec.id)) {
        m.hold = undefined;
        if (m.role === 'host') {
          beginDrain(
            rt,
            ex,
            false,
            diag(
              'host-hold-lost',
              `${m.actor}'s artwork viewing hold ended`,
              [m.actor, rec.id],
              rec.diagnostic,
            ),
          );
          return drain(rt, ex);
        }
        m.active = false;
        m.state = 'directed-away';
        continue;
      }
      if (rec.phase === 'occupied') {
        const s = slotById(rt, m.slot);
        const a = rt.world.entities[m.actor];
        if (
          'code' in s ||
          !a?.human ||
          dist2([a.pose.p[0], a.pose.p[2]], s.p) > 0.04 ||
          Math.abs(angleDelta(a.pose.yaw, s.yaw)) > 0.05
        ) {
          beginDrain(
            rt,
            ex,
            false,
            diag(
              'place-changed',
              `${m.actor} lost its actual viewing place ${m.slot}`,
              [m.actor, m.slot],
            ),
          );
          return drain(rt, ex);
        }
      }
    }
    if (!active(ex).some((m) => m.actor === ex.turn.actor)) {
      ex.turn.elapsed = 0;
      changeTurn(rt, ex, {
        actor: ex.p.host.actor,
        kind: 'comment',
        elapsed: 0,
      });
    }
    if (
      !active(ex).every(
        (m) => m.hold && rt.records.get(m.hold)?.phase === 'occupied',
      )
    ) {
      if (rt.tick - ex.phaseTick > 2400) {
        beginDrain(
          rt,
          ex,
          false,
          diag(
            'arrival-timeout',
            `${ex.id} could not form its artwork viewing places within 120 seconds`,
            [ex.id, ex.p.pad],
          ),
        );
        return drain(rt, ex);
      }
      return {
        status: 'running',
        phase: ex.mode === 'changing' ? 'changing-floor' : 'arriving',
      };
    }
    ex.mode = 'sharing';
    ex.elapsed =
      ex.elapsed + dt >= duration(ex.p) - 1e-9
        ? duration(ex.p)
        : ex.elapsed + dt;
    ex.turn.elapsed =
      ex.turn.elapsed + dt >= period(ex.p) - 1e-9
        ? period(ex.p)
        : ex.turn.elapsed + dt;
    if (ex.turn.elapsed >= period(ex.p) - 1e-9) {
      completeTurn(rt, ex);
      changeTurn(rt, ex, nextTurn(ex));
    }
    if (ex.elapsed >= duration(ex.p) - 1e-9) {
      completeTurn(rt, ex);
      ex.finished = true;
      beginDrain(rt, ex, true);
      return drain(rt, ex);
    }
    return { status: 'running', phase: ex.turn.kind };
  },
  cancel(rt, ex) {
    beginDrain(rt, ex, true);
    return { ok: true, deferred: true };
  },
  yieldTo: (_rt, _self, holder) => [holder.id],
  resumable:
    'Same-Runtime pause/resume retains exact artifact and discussion effects; active reload remains deferred.',
};
function controlIssue(
  rt: Runtime,
  ex: Exec,
  intent: ArtSharingIntent,
): Diagnostic | undefined {
  if (intent.kind === 'end' || intent.kind === 'pause') return;
  if (intent.kind === 'resume') {
    if (!['paused', 'waiting'].includes(ex.mode))
      return diag(
        'not-paused',
        `${ex.id} must release physical children before resume`,
        [ex.id],
      );
    if (artifactBinding(rt, ex.p.pad) !== ex.binding)
      return diag(
        'artifact-changed',
        `${ex.p.pad} no longer retains the bound artwork`,
        [ex.p.pad],
      );
    return setupIssue(rt, ex.p, ex);
  }
  if (!('actor' in intent)) return;
  const m = ex.members.find((m) => m.actor === intent.actor);
  if (!m)
    return diag('participant', `${intent.actor} is not declared in ${ex.id}`, [
      intent.actor,
      ex.id,
    ]);
  if (intent.kind === 'join') {
    if (m.role === 'host' || m.active)
      return diag(
        'already-present',
        `${m.actor} is already participating in ${ex.id}`,
        [m.actor, ex.id],
      );
    if (!['arriving', 'sharing', 'changing'].includes(ex.mode))
      return diag(
        'not-running',
        `${ex.id} must run before ${m.actor} can join`,
        [ex.id, m.actor],
      );
    return placeIssue(rt, ex.p, m, ex);
  }
  if (!m.active || !['arriving', 'sharing', 'changing'].includes(ex.mode))
    return diag(
      'participant-ineligible',
      `${m.actor} cannot ${intent.kind} during ${ex.mode}`,
      [m.actor, ex.id],
    );
  if (intent.kind === 'leave') {
    if (m.role === 'host')
      return diag(
        'host-leave',
        `${m.actor} hosts ${ex.id}; pause or end before leaving`,
        [m.actor, ex.id],
      );
    const sp = rt.services.spatial as Spatial;
    const route = sp.route(
      rt.world,
      HUMAN_PROFILE,
      {
        level: 0,
        p: [
          rt.world.entities[m.actor].pose.p[0],
          rt.world.entities[m.actor].pose.p[2],
        ],
      },
      { level: 0, p: intent.to },
    );
    return route.ok
      ? undefined
      : diag(
          'departure',
          route.diagnostic.message,
          [m.actor, ...(route.diagnostic.subjects ?? [])],
          route.diagnostic,
        );
  }
  if (!m.hold || rt.records.get(m.hold)?.phase !== 'occupied')
    return diag(
      'not-viewing',
      `${m.actor} must actually occupy ${m.slot} before speaking about ${ex.p.pad}`,
      [m.actor, m.slot, ex.p.pad],
    );
  if (ex.queue.length >= 12)
    return diag('queue-full', `${ex.id} has twelve pending floor requests`, [
      ex.id,
    ]);
  if (
    intent.kind === 'ask' &&
    (ex.pendingQuestion !== undefined ||
      ex.turn.kind === 'question' ||
      ex.queue.some((q) => q.kind === 'question'))
  )
    return diag(
      'question-pending',
      `${ex.id} must finish the existing artifact question/answer before another question`,
      [ex.id, ex.p.pad],
    );
  if (
    intent.kind === 'answer' &&
    (ex.pendingQuestion === undefined ||
      ex.effects[ex.pendingQuestion].actor === m.actor)
  )
    return diag(
      'answer-ineligible',
      `${m.actor} requires another participant's completed question about ${ex.p.pad}`,
      [m.actor, ex.p.pad],
    );
}
const intentSchema = z.union([
  z.strictObject({ kind: z.enum(['pause', 'resume', 'end']) }),
  z.strictObject({
    kind: z.enum(['ask', 'answer', 'floor', 'join']),
    actor: id,
  }),
  z.strictObject({ kind: z.literal('leave'), actor: id, to: xz }),
]);
export const artSharingControl: ActionDef<ArtSharingControlParams, null, null> =
  {
    verb: 'art_sharing_control',
    description:
      'Ask, answer, request the floor, join a declared place, leave, pause, explicitly resume or end one physical artifact-sharing circle.',
    schema: z.strictObject({ session: id, intent: intentSchema }),
    reservations: () => [],
    plan(rt, p) {
      const ex = find(rt, p.session);
      if (!ex || !rt.isActive(p.session) || ex.ending)
        return {
          ok: false,
          diagnostic: diag(
            'inactive',
            `${p.session} is not accepting ${p.intent.kind}`,
            [p.session],
          ),
        };
      const issue = controlIssue(rt, ex, p.intent);
      return issue
        ? { ok: false, diagnostic: issue }
        : { ok: true, program: null };
    },
    start(rt, p) {
      const ex = find(rt, p.session)!,
        intent = p.intent;
      if (intent.kind === 'end') rt.cancel(ex.id);
      else if (intent.kind === 'pause') beginDrain(rt, ex);
      else if (intent.kind === 'resume') {
        ex.error = undefined;
        ex.mode = 'arriving';
        ex.phaseTick = rt.tick;
        for (const m of active(ex)) m.state = 'participating';
      } else if ('actor' in intent) {
        const m = ex.members.find((m) => m.actor === intent.actor)!;
        if (intent.kind === 'join') {
          m.active = true;
          m.state = 'participating';
          ex.phaseTick = rt.tick;
          bindHold(rt, ex, m);
          rt.mark('art_sharing.joined', {
            session: ex.id,
            actor: m.actor,
            pad: ex.p.pad,
          });
        } else if (intent.kind === 'leave') {
          m.active = false;
          m.state = 'left';
          stopHold(rt, ex, m);
          const r = rt.submit('walk_to', {
            actor: m.actor,
            x: intent.to[0],
            z: intent.to[1],
            level: 0,
          });
          m.departure = r.id;
          rt.mark('art_sharing.left', {
            session: ex.id,
            actor: m.actor,
            departure: r.id,
          });
        } else
          ex.queue.push({
            actor: m.actor,
            kind:
              intent.kind === 'ask'
                ? 'question'
                : intent.kind === 'answer'
                  ? 'answer'
                  : 'comment',
            elapsed: 0,
            ...(intent.kind === 'answer'
              ? { replyTo: ex.pendingQuestion }
              : {}),
          });
      }
      return null;
    },
    step: () => ({ status: 'completed' }),
    cancel: () => ({ ok: true }),
    resumable: true,
  };
export function readArtSharing(rt: Runtime, session: string) {
  const ex = find(rt, session),
    record = rt.records.get(session);
  if (!ex || !record) return;
  const pad = rt.world.entities[ex.p.pad],
    drawing = readDrawing(rt, ex.p.pad),
    floor =
      ex.mode === 'sharing' &&
      active(ex).some(
        (m) =>
          m.actor === ex.turn.actor &&
          m.hold &&
          rt.isActive(m.hold) &&
          rt.records.get(m.hold)?.phase === 'occupied',
      )
        ? ex.turn.actor
        : undefined;
  return {
    session,
    status: record.status as ActionStatus,
    mode: ex.mode,
    pad: ex.p.pad,
    bindings: structuredClone(ex.p),
    elapsed: ex.elapsed,
    duration: duration(ex.p),
    finished: ex.finished,
    artifact: pad
      ? {
          id: pad.id,
          pose: structuredClone(pad.pose),
          support: structuredClone(pad.support),
          marks: 'code' in drawing ? [] : drawing.completedMarks,
        }
      : undefined,
    attentionTarget:
      ['arriving', 'sharing', 'changing'].includes(ex.mode) &&
      active(ex).some(
        (m) =>
          m.hold &&
          rt.isActive(m.hold) &&
          rt.records.get(m.hold)?.phase === 'occupied',
      ) &&
      pad
        ? {
            entity: pad.id,
            point: [
              pad.pose.p[0],
              pad.pose.p[1] + 0.012,
              pad.pose.p[2],
            ] as Vec3,
          }
        : undefined,
    floorHolder: floor,
    turn: structuredClone(ex.turn),
    pendingQuestion: ex.pendingQuestion,
    effects: structuredClone(ex.effects),
    ownedActions: [...ex.children],
    participants: ex.members.map((m) => ({
      actor: m.actor,
      role: m.role,
      slot: m.slot,
      membership: m.state,
      state: !m.active
        ? m.state
        : ['paused', 'waiting', 'draining'].includes(ex.mode)
          ? 'paused'
          : floor === m.actor
            ? 'speaking'
            : m.hold &&
                rt.isActive(m.hold) &&
                rt.records.get(m.hold)?.phase === 'occupied'
              ? 'listening'
              : 'arriving',
      active: m.active,
      hold: m.hold,
      departure: m.departure,
      physicallyViewing:
        !!m.active &&
        !!m.hold &&
        rt.isActive(m.hold) &&
        rt.records.get(m.hold)?.phase === 'occupied',
      speaking: floor === m.actor,
    })),
    ...(ex.error ? { diagnostic: structuredClone(ex.error) } : {}),
  };
}
export type ArtSharingReadout = NonNullable<ReturnType<typeof readArtSharing>>;
export const ART_SHARING_ACTIONS: ActionDef[] = [artSharing, artSharingControl];
