// Bounded authored commitments above existing actions. No competing mover or
// routine model calls: each physical child still uses the shared registry.
import { z } from 'zod';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import { DT, type Runtime } from '../runtime/runtime.ts';
import { readWorkstation } from '../objects/workstation.ts';
import { readBook } from '../objects/reading.ts';
import { readDrawing } from '../objects/drawing.ts';

const verbs = [
  'work_at',
  'read_book',
  'walk_to',
  'converse',
  'sleep',
  'garden_care',
  'drawing_work',
] as const;
export interface IntentionBinding {
  verb: (typeof verbs)[number];
  params: Record<string, unknown>;
}
export interface IntentionObjective {
  purpose: string;
  label: string;
  alternatives: IntentionBinding[];
  afterSeconds?: number;
  sliceSeconds?: number;
}
export interface LivingIntentionParams {
  actor: string;
  objectives: IntentionObjective[];
}
type Mode =
  | 'running'
  | 'waiting'
  | 'draining'
  | 'paused'
  | 'ending'
  | 'completed';
type Exec = {
  id: string;
  p: LivingIntentionParams;
  mode: Mode;
  index: number;
  startedTick: number;
  child?: string;
  children: string[];
  chosen: Record<string, IntentionBinding>;
  sliceStart: number;
  sliceIndex?: number;
  advance: boolean;
  retryTick: number;
  diagnostic?: Diagnostic;
  completed: string[];
  skipped: string[];
};
export interface LivingIntentionReadout {
  id: string;
  actor: string;
  mode: Mode;
  phase: string;
  purpose?: string;
  label?: string;
  index: number;
  child?: string;
  binding?: IntentionBinding;
  diagnostic?: Diagnostic;
  completed: string[];
  skipped: string[];
}
const store = (rt: Runtime): Record<string, Exec> =>
  (rt.services.livingIntentions ??= {});
const diagnostic = (
  code: string,
  message: string,
  subjects: string[],
): Diagnostic => ({ code: `intention.${code}`, message, subjects });
const id = z.string().min(1).max(160);
const binding = z.strictObject({
  verb: z.enum(verbs),
  params: z.record(z.string(), z.unknown()),
});
const schema = z.strictObject({
  actor: id,
  objectives: z
    .array(
      z.strictObject({
        purpose: id,
        label: id,
        alternatives: z.array(binding).min(1).max(8),
        afterSeconds: z.number().nonnegative().max(3600).optional(),
        sliceSeconds: z.number().positive().max(3600).optional(),
      }),
    )
    .min(1)
    .max(24),
});
function participant(p: Record<string, unknown>, actor: string) {
  return (
    p.actor === actor || (Array.isArray(p.actors) && p.actors.includes(actor))
  );
}
function progress(rt: Runtime, b?: IntentionBinding): number {
  if (b?.verb === 'drawing_work') {
    const state = readDrawing(rt, String(b.params.pad));
    return 'code' in state ? 0 : state.ticks * DT;
  }
  const r =
    b?.verb === 'work_at'
      ? readWorkstation(rt, String(b.params.station))
      : b?.verb === 'read_book'
        ? readBook(rt, String(b.params.book))
        : undefined;
  return r && !('code' in r) ? r.elapsed : 0;
}
function continued(rt: Runtime, b: IntentionBinding): IntentionBinding {
  if (b.verb === 'drawing_work') {
    const state = readDrawing(rt, String(b.params.pad));
    if (
      !('code' in state) &&
      state.status === 'unfinished' &&
      state.user === b.params.actor &&
      state.task === (b.params.task ?? 'shelter-study') &&
      state.pencil === b.params.pencil
    )
      return { verb: b.verb, params: { ...b.params, resume: true } };
    return structuredClone(b);
  }
  const r =
    b.verb === 'work_at'
      ? readWorkstation(rt, String(b.params.station))
      : b.verb === 'read_book'
        ? readBook(rt, String(b.params.book))
        : undefined;
  if (
    r &&
    !('code' in r) &&
    r.status === 'unfinished' &&
    r.user === b.params.actor &&
    r.task === b.params.task &&
    r.duration === b.params.duration
  )
    return { verb: b.verb, params: { ...b.params, resume: true } };
  return structuredClone(b);
}
function drain(rt: Runtime, ex: Exec): StepResult {
  for (const c of ex.children) if (rt.isActive(c)) rt.cancel(c);
  if (ex.children.some((c) => rt.isActive(c)))
    return { status: 'running', phase: 'safe-release' };
  ex.child = undefined;
  if (ex.mode === 'ending') {
    ex.mode = 'completed';
    return {
      status: 'completed',
      outputs: { ended: true, completed: ex.completed, skipped: ex.skipped },
    };
  }
  if (ex.advance) {
    ex.index++;
    ex.advance = false;
    ex.mode = 'running';
    ex.diagnostic = undefined;
  } else ex.mode = 'paused';
  return { status: 'running', phase: ex.mode };
}
function choose(
  rt: Runtime,
  ex: Exec,
): { binding: IntentionBinding } | { diagnostic: Diagnostic } {
  const goal = ex.p.objectives[ex.index],
    fixed = ex.chosen[goal.purpose];
  let last: Diagnostic | undefined;
  for (const candidate of fixed ? [fixed] : goal.alternatives) {
    const b = continued(rt, candidate),
      def = rt.registry.get(b.verb);
    if (!def) {
      last = diagnostic(
        'unsupported',
        `${b.verb} is unavailable for ${ex.p.actor}`,
        [ex.p.actor],
      );
      continue;
    }
    const parsed = def.schema.safeParse(b.params);
    if (!parsed.success) {
      last = diagnostic(
        'invalid-binding',
        `${goal.label} has invalid ${b.verb} parameters`,
        [ex.p.actor],
      );
      continue;
    }
    const plan = def.plan(rt, parsed.data);
    if (!plan.ok) {
      last = plan.diagnostic;
      continue;
    }
    const busy = def
      .reservations(rt.world, parsed.data)
      .find((c) => rt.holder(c.resource).length);
    if (busy) {
      last = diagnostic(
        'resource-busy',
        `${ex.p.actor} waits for ${busy.resource}; its current owner keeps control`,
        [ex.p.actor, busy.resource],
      );
      continue;
    }
    return { binding: b };
  }
  return {
    diagnostic:
      last ??
      diagnostic(
        'no-binding',
        `${ex.p.actor} has no permitted binding for ${goal.label}`,
        [ex.p.actor],
      ),
  };
}
export const livingIntention: ActionDef<LivingIntentionParams, null, Exec> = {
  verb: 'living_intention',
  description:
    'Stable independent authored purposes with permitted resource alternatives, safe interruption and explicit return; ordinary child actions execute them.',
  schema,
  reservations: (_w, p) => [
    { resource: `routine:${p.actor}`, mode: 'exclusive' },
  ],
  plan(rt, p) {
    if (!rt.world.entities[p.actor]?.human)
      return {
        ok: false,
        diagnostic: diagnostic(
          'not-human',
          `${p.actor} is not an eligible person`,
          [p.actor],
        ),
      };
    for (const objective of p.objectives)
      for (const b of objective.alternatives) {
        const def = rt.registry.get(b.verb);
        if (
          !participant(b.params, p.actor) ||
          !def ||
          !def.schema.safeParse(b.params).success
        )
          return {
            ok: false,
            diagnostic: diagnostic(
              'invalid-binding',
              `${objective.label} must bind ${p.actor} to a supported ${b.verb}`,
              [p.actor],
            ),
          };
      }
    return { ok: true, program: null };
  },
  start(rt, p, _program, action) {
    const ex: Exec = {
      id: action,
      p: structuredClone(p),
      mode: 'running',
      index: 0,
      startedTick: rt.tick,
      children: [],
      chosen: {},
      sliceStart: 0,
      advance: false,
      retryTick: rt.tick,
      completed: [],
      skipped: [],
    };
    store(rt)[action] = ex;
    return ex;
  },
  onDirective(_rt, ex, by, claims, ancestors) {
    if (
      ancestors.includes(ex.id) ||
      by.verb === 'living_intention_control' ||
      !['running', 'waiting'].includes(ex.mode)
    )
      return;
    if (claims.some((c) => c.resource === `actor:${ex.p.actor}`)) {
      ex.mode = 'draining';
      ex.advance = false;
      ex.diagnostic = diagnostic(
        'directed-away',
        `${by.verb} ${by.id} takes priority; ${ex.p.actor} retains ${ex.p.objectives[ex.index]?.label ?? 'the intention'} until explicit Resume`,
        [by.id, ex.p.actor],
      );
    }
  },
  step(rt, ex) {
    if (ex.mode === 'draining' || ex.mode === 'ending') return drain(rt, ex);
    if (ex.mode === 'paused') return { status: 'running', phase: 'paused' };
    const goal = ex.p.objectives[ex.index];
    if (!goal) {
      ex.mode = 'completed';
      return {
        status: 'completed',
        outputs: { completed: ex.completed, skipped: ex.skipped },
      };
    }
    if (ex.child) {
      const c = rt.records.get(ex.child)!;
      if (rt.isActive(c.id)) {
        if (
          goal.sliceSeconds !== undefined &&
          progress(rt, ex.chosen[goal.purpose]) - ex.sliceStart >=
            goal.sliceSeconds - 1e-9
        ) {
          ex.completed.push(goal.label);
          ex.advance = true;
          ex.mode = 'draining';
          return drain(rt, ex);
        }
        return c.status === 'blocked' && c.diagnostic
          ? { status: 'blocked', diagnostic: c.diagnostic }
          : { status: 'running', phase: c.phase ?? goal.label };
      }
      ex.child = undefined;
      if (c.status === 'completed') {
        ex.completed.push(goal.label);
        ex.index++;
        ex.retryTick = rt.tick;
        return { status: 'running', phase: 'between-purposes' };
      }
      ex.mode = 'paused';
      ex.diagnostic =
        c.diagnostic ??
        diagnostic(
          'interrupted-child',
          `${c.verb} ${c.id} stopped before ${goal.label}; explicit Resume preserves unfinished effects`,
          [c.id, ex.p.actor],
        );
      return { status: 'running', phase: 'paused' };
    }
    if (rt.tick < ex.startedTick + (goal.afterSeconds ?? 0) / DT)
      return { status: 'running', phase: 'committed-wait' };
    if (rt.tick < ex.retryTick)
      return ex.diagnostic
        ? { status: 'blocked', diagnostic: ex.diagnostic }
        : { status: 'running', phase: 'waiting' };
    const result = choose(rt, ex);
    ex.retryTick = rt.tick + 1 / DT;
    if ('diagnostic' in result) {
      ex.mode = 'waiting';
      ex.diagnostic = result.diagnostic;
      return { status: 'blocked', diagnostic: result.diagnostic };
    }
    const b = result.binding;
    ex.chosen[goal.purpose] ??= structuredClone(b);
    if (ex.sliceIndex !== ex.index) {
      ex.sliceStart = progress(rt, b);
      ex.sliceIndex = ex.index;
    }
    const child = rt.submit(b.verb, b.params, {
      parent: ex.id,
      preempt: false,
    });
    ex.children.push(child.id);
    ex.child = child.id;
    ex.mode = 'running';
    ex.diagnostic = undefined;
    return { status: 'running', phase: 'starting-purpose' };
  },
  cancel(_rt, ex) {
    ex.mode = 'ending';
    ex.advance = false;
    return { ok: true, deferred: true };
  },
  resumable:
    'Independent intentions preserve live progress; active save/load is explicitly deferred.',
};
export const livingIntentionControl: ActionDef<
  { intention: string; intent: 'pause' | 'resume' | 'end' | 'skip' },
  null,
  null
> = {
  verb: 'living_intention_control',
  description:
    'Safely pause, return to, end or explicitly skip one independent purpose without affecting other commitments.',
  schema: z.strictObject({
    intention: id,
    intent: z.enum(['pause', 'resume', 'end', 'skip']),
  }),
  reservations: () => [],
  plan(rt, p) {
    const ex = store(rt)[p.intention];
    if (!ex || !rt.isActive(ex.id) || ex.mode === 'ending')
      return {
        ok: false,
        diagnostic: diagnostic(
          'inactive',
          `${p.intention} cannot accept ${p.intent}`,
          [p.intention],
        ),
      };
    if (p.intent === 'resume' && !['paused', 'waiting'].includes(ex.mode))
      return {
        ok: false,
        diagnostic: diagnostic(
          'not-paused',
          `${p.intention} must finish physical release before Resume`,
          [p.intention],
        ),
      };
    return { ok: true, program: null };
  },
  start(rt, p) {
    const ex = store(rt)[p.intention];
    if (p.intent === 'end') rt.cancel(ex.id);
    else if (p.intent === 'resume') {
      ex.mode = 'running';
      ex.diagnostic = undefined;
      ex.retryTick = rt.tick;
    } else {
      ex.mode = 'draining';
      ex.advance = p.intent === 'skip';
      if (ex.advance)
        ex.skipped.push(ex.p.objectives[ex.index]?.label ?? 'finished');
    }
    return null;
  },
  step: () => ({ status: 'completed' }),
  cancel: () => ({ ok: true }),
  resumable: true,
};
export function readLivingIntention(
  rt: Runtime,
  action: string,
): LivingIntentionReadout | undefined {
  const ex = (
    rt.services.livingIntentions as Record<string, Exec> | undefined
  )?.[action];
  if (!ex) return;
  const goal = ex.p.objectives[ex.index];
  return structuredClone({
    id: ex.id,
    actor: ex.p.actor,
    mode: ex.mode,
    phase: ex.child ? (rt.records.get(ex.child)?.phase ?? 'arriving') : ex.mode,
    purpose: goal?.purpose,
    label: goal?.label,
    index: ex.index,
    child: ex.child,
    binding: goal ? ex.chosen[goal.purpose] : undefined,
    diagnostic: ex.diagnostic,
    completed: ex.completed,
    skipped: ex.skipped,
  });
}
export const LIVING_INTENTION_ACTIONS: ActionDef[] = [
  livingIntention,
  livingIntentionControl,
];
