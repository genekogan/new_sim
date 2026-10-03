// Hypothetical retained reading purpose; ordinary children own every physical effect.
import { z } from 'zod';
import type { ActionDef, Diagnostic, Reservation } from '../actions/types.ts';
import { DT, type Runtime } from '../runtime/runtime.ts';
import { readBook } from '../objects/reading.ts';
import { surfaceSlot } from '../items/model.ts';
import { slotById } from '../social/slots.ts';
import { CATALOG } from '../world/catalog.ts';
import { angleDelta, dist2, heading, sub2 } from '../core/math.ts';
import { hashOf } from '../core/hash.ts';
export interface LibraryReadingParams {
  actor: string;
  book: string;
  sourceSeat: string;
  destSeat: string;
  from: string;
  to: string;
  task: string;
  duration: number;
  transferAfter: number;
}
export type LibraryReadingIntent = 'pause' | 'resume' | 'end';
type Stage =
  | 'source-reading'
  | 'read-release'
  | 'transfer'
  | 'destination-reading';
type Mode =
  | 'running'
  | 'draining'
  | 'paused'
  | 'waiting'
  | 'ending'
  | 'completed';
interface Exec {
  id: string;
  p: LibraryReadingParams;
  stage: Stage;
  mode: Mode;
  children: string[];
  child?: string;
  elapsed: number;
  bookmark: boolean;
  binding: string;
  error?: Diagnostic;
  finished: boolean;
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
): Diagnostic => ({ code: `library_reading.${code}`, message, subjects });
function at(rt: Runtime, ex: Exec, id: string) {
  const b = rt.world.entities[ex.p.book],
    s = surfaceSlot(rt.world, id);
  return (
    !('code' in s) &&
    b?.support?.kind === 'resting-on' &&
    b.support.on === s.owner &&
    b.support.slot === s.slot &&
    b.pose.p.every((v, i) => v === s.p[i])
  );
}
function geometry(rt: Runtime, p: LibraryReadingParams) {
  return hashOf(
    [p.from, p.to, p.sourceSeat, p.destSeat].map((id) => {
      const owner = id.split('#')[0],
        e = rt.world.entities[owner];
      return { id, def: e?.def, pose: e?.pose, support: e?.support };
    }),
  );
}
function declared(
  rt: Runtime,
  p: LibraryReadingParams,
): Diagnostic | undefined {
  if (p.transferAfter >= p.duration)
    return diag('interval', 'Transfer must occur before reading completes', [
      p.book,
    ]);
  // Match read_book's fixed-DT accumulation and existing completion boundary.
  // The parent must observe a threshold tick while that receipt is unfinished.
  // Repeated addition preserves supported exact-tick thresholds despite IEEE rounding.
  let thresholdSeconds = 0;
  while (thresholdSeconds < p.transferAfter) {
    thresholdSeconds += DT;
    if (thresholdSeconds >= p.duration - 1e-9)
      return diag(
        'interval',
        `Transfer threshold ${p.transferAfter}s is reached only when the ${p.duration}s reading child has already completed; choose an earlier fixed-tick threshold`,
        [p.book],
      );
  }
  if (
    p.from.split('#')[0] === p.to.split('#')[0] ||
    p.sourceSeat === p.destSeat
  )
    return diag(
      'distinct-places',
      'Declare two different grounded tables and prepared seats',
      [p.from, p.to, p.sourceSeat, p.destSeat],
    );
  const book = rt.world.entities[p.book],
    cap = book && CATALOG[book.def]?.capabilities?.readable;
  if (!cap)
    return diag('book', `${p.book} must be an existing readable book`, [
      p.book,
    ]);
  for (const [surface, seat] of [
    [p.from, p.sourceSeat],
    [p.to, p.destSeat],
  ]) {
    const s = surfaceSlot(rt.world, surface),
      chair = slotById(rt, seat);
    if ('code' in s) return s;
    if ('code' in chair) return chair;
    const table = rt.world.entities[s.owner],
      e = rt.world.entities[chair.owner];
    if (
      table.kind !== 'fixture' ||
      table.support?.kind !== 'ground' ||
      table.pose.p[1] !== 0 ||
      (table.pose.pitch ?? 0) !== 0 ||
      (table.pose.roll ?? 0) !== 0 ||
      ['carried', 'raising'].includes(table.phase ?? '') ||
      !e ||
      e.support?.kind !== 'ground' ||
      chair.kind !== 'seat' ||
      chair.level !== 0
    )
      return diag(
        'support',
        `${surface} and ${seat} must be ordinary supported ground fixtures`,
        [surface, seat],
      );
    const target: [number, number] = [s.p[0], s.p[2]],
      distance = dist2(chair.p, target);
    if (
      distance < 0.35 ||
      distance > cap.maxSeatDistance ||
      Math.abs(angleDelta(chair.yaw, heading(sub2(target, chair.p)))) > 0.35
    )
      return diag(
        'seat-incompatible',
        `${seat} must face ${surface} within the book's supported reading distance`,
        [seat, surface],
      );
  }
  for (const verb of ['read_book', 'tidy_table_transfer'])
    if (!rt.registry.has(verb))
      return diag('action-missing', `Library reading requires ${verb}`, [verb]);
}
function readingParams(ex: Exec) {
  return {
    actor: ex.p.actor,
    book: ex.p.book,
    seat: ex.stage === 'destination-reading' ? ex.p.destSeat : ex.p.sourceSeat,
    task: ex.p.task,
    duration: ex.p.duration,
    ...(ex.bookmark ? { resume: true } : {}),
  };
}
function update(rt: Runtime, ex: Exec) {
  const b = rt.world.entities[ex.p.book],
    c = b?.equipment?.kind === 'reading' ? b.equipment.config : undefined;
  if (
    c?.user === ex.p.actor &&
    c.task === ex.p.task &&
    c.durationSeconds === ex.p.duration &&
    typeof c.readSeconds === 'number' &&
    ((typeof c.action === 'string' && ex.children.includes(c.action)) ||
      (ex.child && rt.records.get(ex.child)?.verb === 'read_book'))
  ) {
    ex.elapsed = c.readSeconds;
    ex.bookmark = true;
  }
}
function stop(rt: Runtime, ex: Exec, end = false, error?: Diagnostic) {
  update(rt, ex);
  ex.mode = end || ex.mode === 'ending' ? 'ending' : 'draining';
  ex.error = error;
  if (ex.child && rt.isActive(ex.child)) rt.cancel(ex.child);
}
function receipt(rt: Runtime, ex: Exec): Diagnostic | undefined {
  const b = readBook(rt, ex.p.book);
  if ('code' in b) return b;
  const permitted =
    ex.stage === 'destination-reading'
      ? at(rt, ex, ex.p.to)
      : ex.stage === 'transfer'
        ? at(rt, ex, ex.p.from) || at(rt, ex, ex.p.to)
        : at(rt, ex, ex.p.from);
  if (!permitted)
    return diag(
      'stage-support',
      `${ex.p.book} must retain the declared support for ${ex.stage}; restore it before Resume`,
      [ex.p.book, ex.p.from, ex.p.to],
    );
  if (!b.available)
    return diag(
      'unavailable',
      `${ex.p.book} is unavailable; restore it before explicit Resume`,
      [ex.p.book],
    );
  if (
    ex.bookmark &&
    (b.task !== ex.p.task ||
      b.user !== ex.p.actor ||
      b.duration !== ex.p.duration ||
      b.elapsed !== ex.elapsed ||
      b.status !== 'unfinished')
  )
    return diag(
      'bookmark-changed',
      `${ex.p.book} no longer retains this actor's exact unfinished task and bookmark`,
      [ex.p.actor, ex.p.book],
    );
  if (ex.bookmark) {
    const last = [...rt.records.values()]
      .filter(
        (r) =>
          r.verb === 'read_book' &&
          (r.params as { book?: string }).book === ex.p.book &&
          r.history.some((h) => h.status === 'executing'),
      )
      .at(-1);
    if (last && !ex.children.includes(last.id))
      return diag(
        'receipt-replaced',
        `${ex.p.book} was used by external reading ${last.id}; this purpose cannot adopt that receipt`,
        [ex.p.book, last.id],
      );
  }
  if (geometry(rt, ex.p) !== ex.binding)
    return diag(
      'binding-changed',
      'Declared table/seat bindings changed; restore them before explicit Resume',
      [ex.p.from, ex.p.to, ex.p.sourceSeat, ex.p.destSeat],
    );
  return declared(rt, ex.p);
}
function nextStage(rt: Runtime, ex: Exec) {
  if (ex.stage === 'read-release') ex.stage = 'transfer';
  if (ex.stage === 'transfer' && at(rt, ex, ex.p.to))
    ex.stage = 'destination-reading';
}
function ready(rt: Runtime, ex: Exec): Diagnostic | undefined {
  const issue = receipt(rt, ex);
  if (issue) return issue;
  const stage = ex.stage === 'read-release' ? 'transfer' : ex.stage;
  const verb =
    stage === 'transfer' && !at(rt, ex, ex.p.to)
      ? 'tidy_table_transfer'
      : 'read_book';
  const params =
    verb === 'tidy_table_transfer'
      ? { actor: ex.p.actor, item: ex.p.book, from: ex.p.from, to: ex.p.to }
      : {
          ...readingParams(ex),
          seat: at(rt, ex, ex.p.to) ? ex.p.destSeat : ex.p.sourceSeat,
        };
  const plan = rt.registry.get(verb)!.plan(rt, params);
  return plan.ok ? undefined : plan.diagnostic;
}
const id = z.string().min(1).max(80);
export const libraryReading: ActionDef<LibraryReadingParams, null, Exec> = {
  verb: 'library_reading',
  description:
    'Read one hypothetical book, safely transfer it between prepared tables, and finish the same retained reading purpose.',
  schema: z.strictObject({
    actor: id,
    book: id,
    sourceSeat: id,
    destSeat: id,
    from: id,
    to: id,
    task: id,
    duration: z.number().min(2).max(600),
    transferAfter: z.number().min(1).max(599),
  }),
  reservations: (_w, p) => [
    { resource: `library-purpose:${p.actor}`, mode: 'exclusive' },
    { resource: `library-book:${p.book}`, mode: 'exclusive' },
  ],
  plan(rt, p) {
    const issue = declared(rt, p);
    if (issue) return { ok: false, diagnostic: issue };
    const ex: Exec = {
      id: '',
      p,
      stage: 'source-reading',
      mode: 'running',
      children: [],
      elapsed: 0,
      bookmark: false,
      binding: geometry(rt, p),
      finished: false,
    };
    if (!at(rt, ex, p.from))
      return {
        ok: false,
        diagnostic: diag(
          'source',
          `${p.book} must actually rest at ${p.from}`,
          [p.book, p.from],
        ),
      };
    const b = readBook(rt, p.book);
    if ('code' in b) return { ok: false, diagnostic: b };
    if (b.status !== 'idle')
      return {
        ok: false,
        diagnostic: diag(
          'existing-purpose',
          `${p.book} already retains a reading purpose; do not restart it`,
          [p.book],
        ),
      };
    const plan = rt.registry.get('read_book')!.plan(rt, readingParams(ex));
    return plan.ok ? { ok: true, program: null } : plan;
  },
  start(rt, p, _program, id) {
    const ex: Exec = {
      id,
      p: structuredClone(p),
      stage: 'source-reading',
      mode: 'running',
      children: [],
      elapsed: 0,
      bookmark: false,
      binding: geometry(rt, p),
      finished: false,
    };
    store(rt).set(id, ex);
    return ex;
  },
  step(rt, ex) {
    update(rt, ex);
    if (ex.mode === 'ending' || ex.mode === 'draining') {
      if (ex.child && rt.isActive(ex.child))
        return { status: 'running', phase: ex.mode };
      ex.child = undefined;
      nextStage(rt, ex);
      if (ex.mode === 'ending') {
        ex.mode = 'completed';
        return {
          status: 'completed',
          outputs: {
            finished: ex.finished,
            readSeconds: ex.elapsed,
            book: ex.p.book,
          },
        };
      }
      ex.mode = ex.error ? 'waiting' : 'paused';
    }
    if (ex.mode === 'paused' || ex.mode === 'waiting')
      return { status: 'running', phase: ex.mode };
    if (ex.child) {
      const r = rt.records.get(ex.child)!;
      if (rt.isActive(r.id)) {
        if (ex.stage === 'source-reading' && ex.elapsed >= ex.p.transferAfter) {
          ex.stage = 'read-release';
          rt.cancel(r.id);
        }
        return { status: 'running', phase: ex.stage };
      }
      ex.child = undefined;
      if (ex.stage === 'read-release' && r.status === 'cancelled')
        nextStage(rt, ex);
      else if (r.status !== 'completed') {
        stop(
          rt,
          ex,
          false,
          r.diagnostic ??
            diag(
              'child-stopped',
              `${r.verb} stopped; explicit Resume is required`,
              [r.id],
            ),
        );
        return { status: 'running', phase: ex.mode };
      } else if (ex.stage === 'transfer') nextStage(rt, ex);
      else if (ex.stage === 'destination-reading') {
        ex.finished = true;
        stop(rt, ex, true);
        return { status: 'running', phase: 'ending' };
      }
    }
    const issue = receipt(rt, ex);
    if (issue) {
      stop(rt, ex, false, issue);
      return { status: 'running', phase: ex.mode };
    }
    const verb = ex.stage === 'transfer' ? 'tidy_table_transfer' : 'read_book';
    const params =
      verb === 'read_book'
        ? readingParams(ex)
        : { actor: ex.p.actor, item: ex.p.book, from: ex.p.from, to: ex.p.to };
    const r = rt.submit(verb, params, { parent: ex.id, preempt: false });
    ex.children.push(r.id);
    ex.child = r.id;
    if (r.status === 'failed') stop(rt, ex, false, r.diagnostic);
    return {
      status: 'running',
      phase: ex.mode === 'running' ? ex.stage : ex.mode,
    };
  },
  cancel(rt, ex) {
    stop(rt, ex, true);
    return { ok: true, deferred: true };
  },
  yieldTo: () => [],
  onDirective(rt, ex, by, claims: Reservation[], ancestors) {
    if (
      !ancestors.includes(ex.id) &&
      claims.some((c) => c.resource === `actor:${ex.p.actor}`)
    )
      stop(
        rt,
        ex,
        false,
        diag(
          'directed',
          `${by.verb} ${by.id} takes precedence; explicit Resume is required`,
          [ex.p.actor, by.id],
        ),
      );
  },
  resumable:
    'Same-Runtime purpose continuation only; active reload is deferred.',
};
export const libraryReadingControl: ActionDef<
  { session: string; intent: LibraryReadingIntent },
  null,
  null
> = {
  verb: 'library_reading_control',
  description:
    'Pause safely, explicitly Resume the exact retained purpose, or End monotonically.',
  schema: z.strictObject({
    session: id,
    intent: z.enum(['pause', 'resume', 'end']),
  }),
  reservations: () => [],
  plan(rt, p) {
    const ex = store(rt).get(p.session);
    if (!ex || !rt.isActive(ex.id))
      return {
        ok: false,
        diagnostic: diag('inactive', `${p.session} is no longer active`, [
          p.session,
        ]),
      };
    if (ex.mode === 'ending' && p.intent !== 'end')
      return {
        ok: false,
        diagnostic: diag(
          'ending',
          `${p.session} is ending and accepts no other controls`,
          [p.session],
        ),
      };
    if (p.intent === 'resume') {
      if (!['paused', 'waiting'].includes(ex.mode))
        return {
          ok: false,
          diagnostic: diag(
            'not-paused',
            'Wait for safe cleanup before Resume',
            [ex.id],
          ),
        };
      const issue = ready(rt, ex);
      if (issue) return { ok: false, diagnostic: issue };
    }
    return { ok: true, program: null };
  },
  start(rt, p) {
    const ex = store(rt).get(p.session)!;
    if (p.intent === 'end') rt.cancel(ex.id);
    else if (p.intent === 'pause') stop(rt, ex);
    else {
      nextStage(rt, ex);
      ex.error = undefined;
      ex.mode = 'running';
    }
    return null;
  },
  step: () => ({ status: 'completed' }),
  cancel: () => ({ ok: true }),
};
export function libraryReadingReadout(rt: Runtime, id: string) {
  const authoritative = store(rt).get(id);
  if (!authoritative) return undefined;
  // Live child progress is observational; only step/control update the owned exec.
  const ex = { ...authoritative };
  update(rt, ex);
  return structuredClone({
    id: ex.id,
    params: ex.p,
    mode: ex.mode,
    stage: ex.stage,
    elapsed: ex.elapsed,
    finished: ex.finished,
    support: rt.world.entities[ex.p.book]?.support,
    children: ex.children.map((id) => {
      const r = rt.records.get(id)!;
      return {
        id,
        verb: r.verb,
        status: r.status,
        phase: r.phase,
        diagnostic: r.diagnostic,
        history: r.history,
      };
    }),
    ...(ex.error ? { diagnostic: ex.error } : {}),
  });
}

export const LIBRARY_READING_ACTIONS = [libraryReading, libraryReadingControl];
