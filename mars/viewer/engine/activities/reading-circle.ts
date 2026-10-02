// Hypothetical shared reading: ordinary read_book and take_slot own all bodies/support.
import { z } from 'zod';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { readBook, type ReadBookParams } from '../objects/reading.ts';
import { slotById, occupantOf } from '../social/slots.ts';
import { angleDelta, dist2, heading, sub2, type Vec2 } from '../core/math.ts';
import { hashOf } from '../core/hash.ts';

export interface ReadingCirclePlace {
  actor: string;
  slot: string;
  join?: boolean;
}
export interface ReadingCircleParams {
  book: string;
  reader: string;
  seat: string;
  listeners: ReadingCirclePlace[];
  duration: number;
  interval?: number;
  turnSeconds?: number;
  task?: string;
  resume?: boolean;
}
export type ReadingCircleIntent =
  | { kind: 'pause' | 'resume' | 'end' }
  | { kind: 'join' | 'ask' | 'answer' | 'floor'; actor: string }
  | { kind: 'leave'; actor: string; to: Vec2 };
interface Member extends ReadingCirclePlace {
  active: boolean;
  hold?: string;
  departure?: string;
}
interface Turn {
  actor: string;
  kind: 'question' | 'answer' | 'comment';
  elapsed: number;
  replyTo?: number;
}
interface Effect {
  book: string;
  actor: string;
  kind: Turn['kind'];
  page: number;
  readSeconds: number;
  seconds: number;
  replyTo?: number;
}
type Mode =
  | 'reading'
  | 'read-release'
  | 'discussion'
  | 'turn-release'
  | 'pausing'
  | 'paused'
  | 'waiting'
  | 'ending'
  | 'completed';
interface Exec {
  id: string;
  p: ReadingCircleParams;
  mode: Mode;
  resumeMode: 'reading' | 'discussion';
  members: Member[];
  children: string[];
  work?: string;
  readerHold?: string;
  binding: string;
  elapsed: number;
  checkpoint: number;
  turn: Turn;
  queue: Turn[];
  effects: Effect[];
  pendingQuestion?: number;
  discussionDone: boolean;
  finished: boolean;
  error?: Diagnostic;
  phaseTick: number;
}
const sessions = new WeakMap<Runtime, Map<string, Exec>>();
function store(rt: Runtime) {
  let s = sessions.get(rt);
  if (!s) {
    s = new Map();
    sessions.set(rt, s);
  }
  return s;
}
const diag = (
  code: string,
  message: string,
  subjects: string[],
): Diagnostic => ({ code: `reading_circle.${code}`, message, subjects });
const task = (p: ReadingCircleParams) => p.task ?? 'Shared reading';
const interval = (p: ReadingCircleParams) => p.interval ?? 4;
const period = (p: ReadingCircleParams) => p.turnSeconds ?? 2;
const rp = (p: ReadingCircleParams, resume: boolean): ReadBookParams => ({
  actor: p.reader,
  book: p.book,
  seat: p.seat,
  duration: p.duration,
  task: task(p),
  ...(resume ? { resume: true } : {}),
});
function binding(rt: Runtime, p: ReadingCircleParams) {
  const b = rt.world.entities[p.book];
  return hashOf({ pose: b?.pose, support: b?.support, def: b?.def });
}
function owned(rt: Runtime, ex: Exec, id: string) {
  for (
    let r = rt.records.get(id);
    r;
    r = r.parent ? rt.records.get(r.parent) : undefined
  )
    if (r.id === ex.id) return true;
  return false;
}
function placeIssue(
  rt: Runtime,
  p: ReadingCircleParams,
  m: ReadingCirclePlace,
  ex?: Exec,
): Diagnostic | undefined {
  const b = rt.world.entities[p.book],
    a = rt.world.entities[m.actor],
    s = slotById(rt, m.slot);
  if (!a?.human || a.human.level !== 0)
    return diag('actor', `${m.actor} must be a real ground listener`, [
      m.actor,
    ]);
  if ('code' in s) return s;
  if (!b) return diag('book', `${p.book} is missing`, [p.book]);
  const target: Vec2 = [b.pose.p[0], b.pose.p[2]];
  if (
    s.level !== 0 ||
    !['stand', 'audience'].includes(s.kind) ||
    dist2(s.p, target) < 0.65 ||
    dist2(s.p, target) > 2 ||
    Math.abs(angleDelta(s.yaw, heading(sub2(target, s.p)))) > 0.2
  )
    return diag(
      'listening-place',
      `${m.slot} must face ${p.book} from a declared ground place 0.65–2 m away`,
      [m.actor, m.slot, p.book],
    );
  const claims = [
    ...rt.holder(`actor:${m.actor}`),
    ...rt.holder(`slot:${m.slot}`),
  ].filter((id) => !ex || !owned(rt, ex, id));
  const occupant = occupantOf(rt.world, s, new Set([m.actor]));
  if (claims.length || occupant)
    return diag(
      'occupied',
      `${m.slot} or ${m.actor} is occupied by ${occupant ?? claims.join(', ')}`,
      [m.actor, m.slot, ...claims, ...(occupant ? [occupant] : [])],
    );
  const plan = rt.registry
    .get('take_slot')
    ?.plan(rt, { actor: m.actor, slot: m.slot, activity: 'listen' });
  if (!plan)
    return diag('action-missing', 'Reading circle requires take_slot', [
      'take_slot',
    ]);
  if (!plan.ok) return plan.diagnostic;
}
function setup(
  rt: Runtime,
  p: ReadingCircleParams,
  ex?: Exec,
): Diagnostic | undefined {
  const book = readBook(rt, p.book);
  if ('code' in book) return book;
  if (!book.available)
    return diag('unavailable', `${p.book} is unavailable`, [p.book]);
  if (ex && !ex.members.some((m) => m.active))
    return diag(
      'audience-left',
      `${p.book} requires a declared listener to Join before Resume`,
      [p.book],
    );
  if (ex && binding(rt, p) !== ex.binding)
    return diag(
      'book-changed',
      `${p.book} changed its physical support or pose`,
      [p.book],
    );
  const all = [p.reader, ...p.listeners.map((m) => m.actor)],
    slots = [p.seat, ...p.listeners.map((m) => m.slot)];
  if (new Set(all).size !== all.length || new Set(slots).size !== slots.length)
    return diag(
      'duplicate',
      'Reading roles and declared places must be distinct',
      [...all, ...slots],
    );
  const points = slots.map((s) => slotById(rt, s));
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    if ('code' in a) return a;
    for (let j = 0; j < i; j++) {
      const b = points[j];
      if (!('code' in b) && dist2(a.p, b.p) < 0.65)
        return diag('overlap', `${a.id} overlaps ${b.id}`, [a.id, b.id]);
    }
  }
  if (!ex || ex.elapsed < p.duration) {
    const plan = rt.registry
      .get('read_book')
      ?.plan(rt, rp(p, ex ? book.status === 'unfinished' : !!p.resume));
    if (!plan)
      return diag('action-missing', 'Reading circle requires read_book', [
        'read_book',
      ]);
    if (!plan.ok) return plan.diagnostic;
  }
  if (ex && ex.elapsed >= p.duration) {
    const foreign = rt
      .holder(`actor:${p.reader}`)
      .filter((id) => !owned(rt, ex, id));
    if (foreign.length)
      return diag(
        'reader-busy',
        `${p.reader} remains controlled by ${foreign.join(', ')}`,
        [p.reader, ...foreign],
      );
    const plan = rt.registry
      .get('take_slot')
      ?.plan(rt, { actor: p.reader, slot: p.seat, activity: 'listen' });
    if (!plan)
      return diag('action-missing', 'Discussion requires take_slot', [
        'take_slot',
      ]);
    if (!plan.ok) return plan.diagnostic;
  }
  for (const m of ex
    ? ex.members.filter((m) => m.active)
    : p.listeners.filter((m) => m.join !== false)) {
    const issue = placeIssue(rt, p, m, ex);
    if (issue) return issue;
  }
}
function stopChild(rt: Runtime, id?: string) {
  if (id && rt.isActive(id)) rt.cancel(id);
}
function updateProgress(rt: Runtime, ex: Exec) {
  const r = ex.work ? rt.records.get(ex.work) : undefined,
    output = r?.parent === ex.id ? r.outputs : undefined,
    b = readBook(rt, ex.p.book);
  if (typeof output?.readSeconds === 'number') ex.elapsed = output.readSeconds;
  else if (
    !('code' in b) &&
    b.action === ex.work &&
    b.user === ex.p.reader &&
    b.task === task(ex.p)
  )
    ex.elapsed = b.elapsed;
}
function release(rt: Runtime, ex: Exec, mode: Mode, error?: Diagnostic) {
  updateProgress(rt, ex);
  if (
    mode === 'pausing' &&
    !['pausing', 'paused', 'waiting'].includes(ex.mode)
  ) {
    ex.resumeMode =
      ['discussion', 'read-release', 'turn-release'].includes(ex.mode) &&
      !ex.discussionDone
        ? 'discussion'
        : 'reading';
    if (ex.mode === 'read-release')
      ex.turn = ex.queue.shift() ?? {
        actor: ex.members.find((m) => m.active)?.actor ?? ex.p.reader,
        kind: ex.members.some((m) => m.active) ? 'question' : 'comment',
        elapsed: 0,
      };
  }
  if (mode === 'read-release') ex.discussionDone = false;
  ex.mode = mode;
  ex.error = error;
  for (const id of ex.children) stopChild(rt, id);
  ex.readerHold = undefined;
  for (const m of ex.members) m.hold = undefined;
}
function draining(rt: Runtime, ex: Exec): boolean {
  updateProgress(rt, ex);
  return ex.children.some((id) => rt.isActive(id));
}
function hold(
  rt: Runtime,
  ex: Exec,
  actor: string,
  slot: string,
  activity: 'talk' | 'listen',
) {
  const r = rt.submit(
    'take_slot',
    { actor, slot, activity },
    { parent: ex.id, preempt: false },
  );
  ex.children.push(r.id);
  if (r.status === 'failed') release(rt, ex, 'pausing', r.diagnostic);
  return r.id;
}
function beginTurn(rt: Runtime, ex: Exec) {
  ex.readerHold = hold(rt, ex, ex.p.reader, ex.p.seat, 'listen');
  for (const m of ex.members.filter((m) => m.active)) {
    m.hold = hold(
      rt,
      ex,
      m.actor,
      m.slot,
      m.actor === ex.turn.actor ? 'talk' : 'listen',
    );
    if (ex.mode === 'pausing') break;
  }
  ex.phaseTick = rt.tick;
}
function effect(rt: Runtime, ex: Exec) {
  if (ex.turn.elapsed <= 0) return;
  const b = readBook(rt, ex.p.book);
  const index = ex.effects.length;
  ex.effects.push({
    book: ex.p.book,
    actor: ex.turn.actor,
    kind: ex.turn.kind,
    page: 'code' in b ? 0 : b.page,
    readSeconds: ex.elapsed,
    seconds: ex.turn.elapsed,
    ...(ex.turn.replyTo !== undefined ? { replyTo: ex.turn.replyTo } : {}),
  });
  if (ex.turn.kind === 'question') ex.pendingQuestion = index;
  else if (ex.turn.kind === 'answer') ex.pendingQuestion = undefined;
  rt.mark('reading_circle.contribution', {
    session: ex.id,
    index,
    ...ex.effects[index],
  });
  ex.turn.elapsed = 0;
}
function nextTurn(ex: Exec): Turn | undefined {
  while (ex.queue.length) {
    const q = ex.queue.shift()!;
    if (
      q.actor === ex.p.reader ||
      ex.members.some((m) => m.active && m.actor === q.actor)
    )
      return q;
  }
  if (ex.pendingQuestion !== undefined)
    return {
      actor:
        ex.effects[ex.pendingQuestion].actor !== ex.p.reader
          ? ex.p.reader
          : ex.members.find((m) => m.active)!.actor,
      kind: 'answer',
      elapsed: 0,
      replyTo: ex.pendingQuestion,
    };
}
const id = z.string().min(1).max(80),
  place = z.strictObject({ actor: id, slot: id, join: z.boolean().optional() });
export const readingCircle: ActionDef<ReadingCircleParams, null, Exec> = {
  verb: 'reading_circle',
  description:
    'Read one supported book in intervals with actual listeners and question/answer turns; retain its same-reader bookmark on safe interruption.',
  schema: z.strictObject({
    book: id,
    reader: id,
    seat: id,
    listeners: z.array(place).min(2).max(3),
    duration: z.number().min(2).max(600),
    interval: z.number().min(1).max(60).optional(),
    turnSeconds: z.number().min(1).max(20).optional(),
    task: id.optional(),
    resume: z.boolean().optional(),
  }),
  reservations: (w, p) => {
    const support = w.entities[p.book]?.support;
    return [
      { resource: `entity:${p.book}`, mode: 'exclusive' },
      ...(support?.kind === 'resting-on'
        ? [
            {
              resource: `entity:${support.on}`,
              mode: 'shared' as const,
            },
          ]
        : []),
      { resource: `reading-circle:${p.book}`, mode: 'exclusive' },
      ...[p.reader, ...p.listeners.map((m) => m.actor)].map((actor) => ({
        resource: `reading-circle-member:${actor}`,
        mode: 'exclusive' as const,
      })),
    ];
  },
  plan(rt, p) {
    const issue = setup(rt, p);
    if (issue) return { ok: false, diagnostic: issue };
    if (p.listeners.filter((m) => m.join !== false).length < 2)
      return {
        ok: false,
        diagnostic: diag(
          'audience',
          'Two listeners must initially participate',
          [p.book],
        ),
      };
    return { ok: true, program: null };
  },
  start(rt, p, _prog, id) {
    const b = readBook(rt, p.book),
      elapsed = p.resume && !('code' in b) ? b.elapsed : 0;
    const ex: Exec = {
      id,
      p: structuredClone(p),
      mode: 'reading',
      resumeMode: 'reading',
      members: p.listeners.map((m) => ({ ...m, active: m.join !== false })),
      children: [],
      binding: binding(rt, p),
      elapsed,
      checkpoint: Math.min(p.duration, elapsed + interval(p)),
      turn: {
        actor: p.listeners.find((m) => m.join !== false)!.actor,
        kind: 'question',
        elapsed: 0,
      },
      queue: [],
      effects: [],
      discussionDone: false,
      finished: false,
      phaseTick: rt.tick,
    };
    store(rt).set(id, ex);
    return ex;
  },
  onDirective(rt, ex, by, claims, ancestors) {
    if (
      ancestors.includes(ex.id) ||
      by.verb === 'reading_circle_control' ||
      ['ending', 'completed'].includes(ex.mode)
    )
      return;
    // A released physical hold is still a declared invitation. Player direction
    // withdraws it even while paused, so Resume cannot silently re-invite anyone.
    for (const m of ex.members)
      if (m.active && claims.some((c) => c.resource === `actor:${m.actor}`)) {
        m.active = false;
        stopChild(rt, m.hold);
        m.hold = undefined;
        rt.mark('reading_circle.listener-directed', {
          session: ex.id,
          actor: m.actor,
          directive: by.id,
        });
      }
    // Reader direction while already released preserves the existing pause stage.
    // Ordinary admission will refuse Resume until that independent task releases.
    if (['pausing', 'paused', 'waiting'].includes(ex.mode)) return;
    if (claims.some((c) => c.resource === `actor:${ex.p.reader}`)) {
      release(
        rt,
        ex,
        'pausing',
        diag(
          'reader-directed',
          `${by.id} directs ${ex.p.reader}; safely release and explicitly resume`,
          [by.id, ex.p.reader, ex.p.book],
        ),
      );
    }
  },
  step(rt, ex, dt): StepResult {
    updateProgress(rt, ex);
    if (
      ['pausing', 'ending', 'read-release', 'turn-release'].includes(ex.mode)
    ) {
      if (draining(rt, ex)) return { status: 'running', phase: 'safe-release' };
      if (ex.mode === 'ending') {
        ex.mode = 'completed';
        return {
          status: 'completed',
          outputs: {
            book: ex.p.book,
            finished: ex.finished,
            readSeconds: ex.elapsed,
            effects: structuredClone(ex.effects),
          },
        };
      }
      if (ex.mode === 'pausing') {
        ex.mode = ex.error ? 'waiting' : 'paused';
        return ex.error
          ? { status: 'blocked', diagnostic: ex.error }
          : { status: 'running', phase: 'paused' };
      }
      if (ex.mode === 'read-release') {
        ex.mode = 'discussion';
        ex.discussionDone = false;
        ex.turn = ex.queue.shift() ?? {
          actor: ex.members.find((m) => m.active)!.actor,
          kind: 'question',
          elapsed: 0,
        };
      } else if (ex.discussionDone) {
        if (ex.elapsed >= ex.p.duration) {
          ex.finished = true;
          release(rt, ex, 'ending');
          return { status: 'running', phase: 'safe-release' };
        }
        ex.mode = 'reading';
        ex.work = undefined;
        ex.checkpoint = Math.min(ex.p.duration, ex.elapsed + interval(ex.p));
      } else ex.mode = 'discussion';
    }
    if (ex.mode === 'paused' || ex.mode === 'waiting')
      return ex.error
        ? { status: 'blocked', diagnostic: ex.error }
        : { status: 'running', phase: 'paused' };
    const b = readBook(rt, ex.p.book);
    if ('code' in b || !b.available || binding(rt, ex.p) !== ex.binding) {
      release(
        rt,
        ex,
        'pausing',
        'code' in b
          ? b
          : diag(
              'book-changed',
              `${ex.p.book} is unavailable or changed support`,
              [ex.p.book],
            ),
      );
      return { status: 'running', phase: 'safe-release' };
    }
    if (ex.members.filter((m) => m.active).length < 1) {
      release(
        rt,
        ex,
        'pausing',
        diag(
          'audience-left',
          `${ex.p.book} requires at least one present listener`,
          [ex.p.book],
        ),
      );
      return { status: 'running', phase: 'safe-release' };
    }
    if (ex.mode === 'reading') {
      for (const m of ex.members.filter((m) => m.active))
        if (m.hold && !rt.isActive(m.hold)) {
          m.active = false;
          m.hold = undefined;
        }
      for (const m of ex.members.filter((m) => m.active))
        if (!m.hold) {
          const issue = placeIssue(rt, ex.p, m, ex);
          if (issue) {
            release(rt, ex, 'pausing', issue);
            return { status: 'running', phase: 'safe-release' };
          }
          m.hold = hold(rt, ex, m.actor, m.slot, 'listen');
          if ((ex.mode as Mode) === 'pausing')
            return { status: 'running', phase: 'safe-release' };
        }
      if (
        !ex.work &&
        !ex.members
          .filter((m) => m.active)
          .every((m) => m.hold && rt.records.get(m.hold)?.phase === 'occupied')
      )
        return { status: 'running', phase: 'forming-listeners' };
      if (!ex.work) {
        const r = rt.submit('read_book', rp(ex.p, b.status === 'unfinished'), {
          parent: ex.id,
          preempt: false,
        });
        ex.work = r.id;
        ex.children.push(r.id);
        if (r.status === 'failed') {
          release(rt, ex, 'pausing', r.diagnostic);
          return { status: 'running', phase: 'safe-release' };
        }
      }
      const r = rt.records.get(ex.work)!;
      if (!rt.isActive(r.id) && r.status !== 'completed') {
        release(
          rt,
          ex,
          'pausing',
          r.diagnostic ??
            diag('reading-stopped', `${r.id} stopped; book bookmark retained`, [
              r.id,
              ex.p.book,
            ]),
        );
        return { status: 'running', phase: 'safe-release' };
      }
      if (ex.elapsed >= ex.checkpoint) {
        release(rt, ex, 'read-release');
        return { status: 'running', phase: 'safe-release' };
      }
      return {
        status: 'running',
        phase:
          r.phase === 'reading' ? 'reading-aloud' : (r.phase ?? 'arriving'),
      };
    }
    if (!ex.readerHold) {
      beginTurn(rt, ex);
      if ((ex.mode as Mode) === 'pausing')
        return { status: 'running', phase: 'safe-release' };
    }
    const holds = [
      ex.readerHold,
      ...ex.members.filter((m) => m.active).map((m) => m.hold),
    ];
    if (holds.some((id) => !id || !rt.isActive(id))) {
      release(
        rt,
        ex,
        'pausing',
        diag('hold-lost', `${ex.id} lost a physical discussion hold`, [ex.id]),
      );
      return { status: 'running', phase: 'safe-release' };
    }
    if (!holds.every((id) => rt.records.get(id!)?.phase === 'occupied')) {
      if (rt.tick - ex.phaseTick > 2400)
        release(
          rt,
          ex,
          'pausing',
          diag('arrival-timeout', `${ex.id} discussion places did not form`, [
            ex.id,
          ]),
        );
      return { status: 'running', phase: 'arriving-discussion' };
    }
    if (
      ex.turn.actor !== ex.p.reader &&
      !ex.members.some((m) => m.active && m.actor === ex.turn.actor)
    ) {
      ex.turn = { actor: ex.p.reader, kind: 'comment', elapsed: 0 };
      release(rt, ex, 'turn-release');
      return { status: 'running', phase: 'changing-floor' };
    }
    ex.turn.elapsed = Math.min(period(ex.p), ex.turn.elapsed + dt);
    if (ex.turn.elapsed >= period(ex.p) - 1e-9) {
      effect(rt, ex);
      const next = nextTurn(ex);
      ex.discussionDone = !next;
      if (next) ex.turn = next;
      release(rt, ex, 'turn-release');
      return { status: 'running', phase: 'changing-floor' };
    }
    return { status: 'running', phase: ex.turn.kind };
  },
  cancel(rt, ex) {
    release(rt, ex, 'ending');
    return { ok: true, deferred: true };
  },
  yieldTo: (_rt, _self, holder) => [holder.id],
  resumable:
    'Explicit same-Runtime continuation only; reader handoff and active reload are unsupported.',
};
function controlIssue(
  rt: Runtime,
  ex: Exec,
  intent: ReadingCircleIntent,
): Diagnostic | undefined {
  if (intent.kind === 'end' || intent.kind === 'pause') return;
  if (intent.kind === 'resume') {
    if (!['paused', 'waiting'].includes(ex.mode))
      return diag('not-paused', `${ex.id} must safely release before Resume`, [
        ex.id,
      ]);
    return setup(rt, ex.p, ex);
  }
  if (!('actor' in intent)) return;
  const m = ex.members.find((m) => m.actor === intent.actor);
  if (intent.actor !== ex.p.reader && !m)
    return diag('participant', `${intent.actor} is not declared`, [
      intent.actor,
      ex.id,
    ]);
  if (
    !(intent.kind === 'join' && ['paused', 'waiting'].includes(ex.mode)) &&
    !['reading', 'discussion', 'read-release', 'turn-release'].includes(ex.mode)
  )
    return diag('not-running', `${ex.id} is ${ex.mode}`, [ex.id]);
  if (intent.kind === 'join') {
    if (!m || m.active)
      return diag('already-present', `${intent.actor} cannot Join`, [
        intent.actor,
      ]);
    return placeIssue(rt, ex.p, m, ex);
  }
  if (intent.kind === 'leave') {
    if (!m || !m.active)
      return diag('reader-leave', 'Reader must Pause or End before leaving', [
        intent.actor,
      ]);
    const plan = rt.registry.get('walk_to')?.plan(rt, {
      actor: m.actor,
      x: intent.to[0],
      z: intent.to[1],
      level: 0,
    });
    if (!plan)
      return diag('action-missing', 'Leave requires walk_to', ['walk_to']);
    return plan.ok ? undefined : plan.diagnostic;
  }
  if (m && !m.active)
    return diag('absent', `${m.actor} must Join before speaking`, [m.actor]);
  if (m && (!m.hold || rt.records.get(m.hold)?.phase !== 'occupied'))
    return diag(
      'not-listening',
      `${m.actor} must occupy ${m.slot} before requesting a discussion turn`,
      [m.actor, m.slot],
    );
  if (ex.queue.length >= 8)
    return diag('queue-full', 'Eight discussion requests are pending', [ex.id]);
  if (
    intent.kind === 'ask' &&
    (ex.pendingQuestion !== undefined ||
      ex.queue.some((q) => q.kind === 'question') ||
      (ex.mode === 'discussion' && ex.turn.kind === 'question'))
  )
    return diag(
      'question-pending',
      'Finish the existing question before another',
      [ex.id],
    );
  if (
    intent.kind === 'answer' &&
    (ex.pendingQuestion === undefined ||
      ex.effects[ex.pendingQuestion].actor === intent.actor)
  )
    return diag(
      'answer-ineligible',
      'Answer requires another participant completed question',
      [intent.actor, ex.p.book],
    );
}
const intentSchema = z.union([
  z.strictObject({ kind: z.enum(['pause', 'resume', 'end']) }),
  z.strictObject({
    kind: z.enum(['join', 'ask', 'answer', 'floor']),
    actor: id,
  }),
  z.strictObject({
    kind: z.literal('leave'),
    actor: id,
    to: z.tuple([z.number().min(-500).max(500), z.number().min(-500).max(500)]),
  }),
]);
export const readingCircleControl: ActionDef<
  { session: string; intent: ReadingCircleIntent },
  null,
  null
> = {
  verb: 'reading_circle_control',
  description:
    'Pause, explicitly Resume, End, Join, Leave or request bounded book-focused discussion turns.',
  schema: z.strictObject({ session: id, intent: intentSchema }),
  reservations: () => [],
  plan(rt, p) {
    const ex = store(rt).get(p.session);
    if (
      !ex ||
      !rt.isActive(p.session) ||
      ['ending', 'completed'].includes(ex.mode)
    )
      return {
        ok: false,
        diagnostic: diag('inactive', `${p.session} is not accepting controls`, [
          p.session,
        ]),
      };
    const issue = controlIssue(rt, ex, p.intent);
    return issue
      ? { ok: false, diagnostic: issue }
      : { ok: true, program: null };
  },
  start(rt, p) {
    const ex = store(rt).get(p.session)!,
      i = p.intent;
    if (i.kind === 'end') rt.cancel(ex.id);
    else if (i.kind === 'pause') release(rt, ex, 'pausing');
    else if (i.kind === 'resume') {
      ex.error = undefined;
      ex.mode = ex.resumeMode;
      ex.work = undefined;
      if (ex.discussionDone) {
        if (ex.elapsed >= ex.p.duration) {
          ex.finished = true;
          release(rt, ex, 'ending');
        } else {
          ex.checkpoint = Math.min(ex.p.duration, ex.elapsed + interval(ex.p));
          ex.discussionDone = false;
        }
      }
    } else if ('actor' in i) {
      const m = ex.members.find((m) => m.actor === i.actor);
      if (i.kind === 'join') {
        m!.active = true;
        if (
          ex.mode === 'discussion' &&
          ex.readerHold &&
          rt.isActive(ex.readerHold)
        )
          m!.hold = hold(rt, ex, m!.actor, m!.slot, 'listen');
      } else if (i.kind === 'leave') {
        m!.active = false;
        stopChild(rt, m!.hold);
        m!.hold = undefined;
        const r = rt.submit('walk_to', {
          actor: i.actor,
          x: i.to[0],
          z: i.to[1],
          level: 0,
        });
        m!.departure = r.id;
      } else
        ex.queue.push({
          actor: i.actor,
          kind:
            i.kind === 'ask'
              ? 'question'
              : i.kind === 'answer'
                ? 'answer'
                : 'comment',
          elapsed: 0,
          ...(i.kind === 'answer' ? { replyTo: ex.pendingQuestion } : {}),
        });
    }
    return null;
  },
  step: () => ({ status: 'completed' }),
  cancel: () => ({ ok: true }),
  resumable: true,
};
export function readReadingCircle(rt: Runtime, session: string) {
  const ex = store(rt).get(session),
    rec = rt.records.get(session);
  if (!ex || !rec) return;
  const b = rt.world.entities[ex.p.book],
    reading = readBook(rt, ex.p.book);
  const current = ['reading', 'discussion'].includes(ex.mode);
  const discussionFormed =
    ex.mode === 'discussion' &&
    !!ex.readerHold &&
    [
      ex.readerHold,
      ...ex.members.filter((m) => m.active).map((m) => m.hold),
    ].every(
      (id) =>
        !!id && rt.isActive(id) && rt.records.get(id)?.phase === 'occupied',
    );
  return {
    session,
    status: rec.status,
    mode: ex.mode,
    bindings: structuredClone(ex.p),
    book: ex.p.book,
    elapsed: ex.elapsed,
    duration: ex.p.duration,
    finished: ex.finished,
    reading: 'code' in reading ? undefined : structuredClone(reading),
    artifact: b
      ? {
          id: b.id,
          pose: structuredClone(b.pose),
          support: structuredClone(b.support),
        }
      : undefined,
    attentionTarget:
      current && b ? { entity: b.id, point: [...b.pose.p] } : undefined,
    floorHolder: discussionFormed
      ? ex.turn.actor
      : ex.mode === 'reading' &&
          !('code' in reading) &&
          reading.action === ex.work &&
          reading.phase === 'reading'
        ? ex.p.reader
        : undefined,
    turn: structuredClone(ex.turn),
    effects: structuredClone(ex.effects),
    pendingQuestion: ex.pendingQuestion,
    reader: {
      actor: ex.p.reader,
      role: 'reader' as const,
      seat: ex.p.seat,
      action: ex.mode === 'reading' ? ex.work : ex.readerHold,
      state: ['paused', 'waiting', 'pausing'].includes(ex.mode)
        ? 'paused'
        : ex.mode === 'reading' &&
            !('code' in reading) &&
            reading.phase === 'reading'
          ? 'reading'
          : discussionFormed && ex.turn.actor === ex.p.reader
            ? 'answering'
            : discussionFormed
              ? 'listening'
              : ex.mode === 'completed'
                ? 'ended'
                : 'arriving',
    },
    participants: ex.members.map((m) => ({
      ...m,
      role: 'listener' as const,
      state: !m.active
        ? 'left'
        : ['paused', 'waiting', 'pausing'].includes(ex.mode)
          ? 'paused'
          : ex.mode === 'completed'
            ? 'ended'
            : m.hold && rt.records.get(m.hold)?.phase === 'occupied'
              ? ex.mode === 'discussion' && m.actor === ex.turn.actor
                ? 'speaking'
                : 'listening'
              : 'arriving',
    })),
    ownedActions: [...ex.children],
    ...(ex.error ? { diagnostic: structuredClone(ex.error) } : {}),
  };
}
export const READING_CIRCLE_ACTIONS: ActionDef[] = [
  readingCircle,
  readingCircleControl,
];
