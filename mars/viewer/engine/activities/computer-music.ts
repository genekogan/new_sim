// Hypothetical computer music intent. Ordinary work_at/sit children own all physics.
import { z } from 'zod';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { readWorkstation, type WorkAtParams } from '../objects/workstation.ts';
import { humanOf } from '../social/actions.ts';
import { slotById, isFree } from '../social/slots.ts';
import { dist2, angleDelta, heading, sub2 } from '../core/math.ts';
import { heldBy } from '../items/model.ts';
import { holdingDiagnostic } from '../construction/rules.ts';

export const MUSIC_SCORES = {
  gentle: [60, 64, 67, 64, 62, 65, 69, 65],
  bright: [60, 67, 72, 69, 65, 69, 72, 67],
} as const;
export type MusicScore = keyof typeof MUSIC_SCORES;
export interface MusicParams {
  performer: string;
  station: string;
  seat: string;
  listeners: { actor: string; seat: string }[];
  score: MusicScore;
  period: number;
  duration: number;
  resume?: boolean;
}
interface Listener {
  actor: string;
  seat: string;
  child?: string;
  departed: boolean;
}
interface Exec {
  id: string;
  p: MusicParams;
  work?: string;
  children: string[];
  listeners: Listener[];
  mode: 'starting' | 'performing' | 'stopping' | 'completed';
  error?: Diagnostic;
  interrupted: boolean;
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
const diagnostic = (
  code: string,
  message: string,
  subjects: string[],
): Diagnostic => ({ code: `music.${code}`, message, subjects });
const workParams = (p: MusicParams): WorkAtParams => ({
  actor: p.performer,
  station: p.station,
  seat: p.seat,
  task: `Electronic music · ${p.score}`,
  duration: p.duration,
  ...(p.resume ? { resume: true } : {}),
});

const programSchema = z.strictObject({
  score: z.enum(['gentle', 'bright']),
  period: z.number().min(0.25).max(2),
  task: z.string().min(1),
});
/** A typed optional workstation program; labels alone never create behavior. */
export function recordedMusicProgram(
  config: Record<string, string | number | boolean> | undefined,
) {
  if (
    !config ||
    config.programKind !== 'electronic-music/v1' ||
    typeof config.programData !== 'string' ||
    typeof config.programAction !== 'string'
  )
    return undefined;
  try {
    const parsed = programSchema.safeParse(JSON.parse(config.programData));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
/** Audible expression is derived from authoritative work time; no device clock enters the engine. */
export function musicStation(rt: Runtime, station: string) {
  const work = readWorkstation(rt, station);
  if ('code' in work) return work;
  const c = rt.world.entities[station].equipment?.config,
    program = recordedMusicProgram(c);
  if (
    !program ||
    program.task !== work.task ||
    (work.status === 'active' && c?.programAction !== work.action)
  )
    return undefined;
  const { score, period } = program,
    pulse = Math.floor((work.elapsed + 1e-9) / period);
  const playing =
    work.available &&
    work.status === 'active' &&
    work.phase === 'working' &&
    work.elapsed < work.duration;
  return {
    ...work,
    score,
    period,
    pulse,
    note: playing
      ? MUSIC_SCORES[score][pulse % MUSIC_SCORES[score].length]
      : null,
  };
}
function preflight(rt: Runtime, p: MusicParams): Diagnostic | null {
  const ids = [p.performer, ...p.listeners.map((l) => l.actor)],
    seats = [p.seat, ...p.listeners.map((l) => l.seat)];
  if (new Set(ids).size !== ids.length || new Set(seats).size !== seats.length)
    return diagnostic(
      'duplicate-role',
      'Music roles need distinct actors and chairs',
      [...ids, ...seats],
    );
  const workDef = rt.registry.get('work_at'),
    sitDef = rt.registry.get('sit');
  if (!workDef || !sitDef)
    return diagnostic(
      'execution-missing',
      'Computer music requires ordinary work_at and sit actions',
      [p.station],
    );
  const planned = workDef.plan(rt, workParams(p));
  if (!planned.ok) return planned.diagnostic;
  const current = readWorkstation(rt, p.station);
  if ('code' in current) return current;
  const c = rt.world.entities[p.station].equipment?.config;
  const recorded = recordedMusicProgram(c);
  if (
    p.resume &&
    (!recorded ||
      recorded.task !== current.task ||
      recorded.score !== p.score ||
      recorded.period !== p.period)
  )
    return diagnostic(
      'unfinished-program',
      `${p.station} requires the same recorded score and period to resume its music purpose`,
      [p.station, p.performer],
    );
  const target = rt.world.entities[p.station].pose.p;
  for (const l of p.listeners) {
    const actor = humanOf(rt, l.actor);
    if ('code' in actor) return actor;
    const load = holdingDiagnostic(rt.world, l.actor);
    if (load) return load;
    const items = heldBy(rt.world, l.actor).map(({ item }) => item.id);
    if (items.length)
      return diagnostic(
        'hands-occupied',
        `${l.actor} must explicitly put down ${items.join(', ')} before listening`,
        [l.actor, ...items],
      );
    const held = rt.holder(`actor:${l.actor}`);
    if (held.length)
      return diagnostic(
        'listener-busy',
        `${l.actor} remains owned by ${held.join(', ')}`,
        [l.actor, ...held],
      );
    const seat = slotById(rt, l.seat);
    if ('code' in seat) return seat;
    if (
      seat.kind !== 'seat' ||
      seat.level !== 0 ||
      !rt.world.entities[seat.owner] ||
      dist2(seat.p, [target[0], target[2]]) > 5
    )
      return diagnostic(
        'listener-seat',
        `${l.seat} must be a real ground chair within 5 m of ${p.station}`,
        [l.actor, l.seat, p.station],
      );
    if (
      Math.abs(
        angleDelta(seat.yaw, heading(sub2([target[0], target[2]], seat.p))),
      ) > 0.9
    )
      return diagnostic(
        'listener-facing',
        `${l.seat} must face the performer and computer; arrange a supported listening chair first`,
        [l.seat, p.station],
      );
    if (!isFree(rt.world, seat, new Set([l.actor])))
      return diagnostic(
        'seat-occupied',
        `${l.seat} is unavailable for ${l.actor}`,
        [l.actor, l.seat],
      );
    const plannedSeat = sitDef.plan(rt, { actor: l.actor, slot: l.seat });
    if (!plannedSeat.ok) return plannedSeat.diagnostic;
  }
  return null;
}
function stop(ex: Exec, error?: Diagnostic) {
  ex.mode = 'stopping';
  ex.error ??= error;
}
function drain(rt: Runtime, ex: Exec): StepResult {
  for (const id of ex.children)
    if (rt.records.get(id)?.parent === ex.id && rt.isActive(id)) rt.cancel(id);
  if (ex.children.some((id) => rt.isActive(id)))
    return { status: 'running', phase: 'stopping' };
  if (ex.error) return { status: 'failed', diagnostic: ex.error };
  ex.mode = 'completed';
  const work = readWorkstation(rt, ex.p.station);
  return {
    status: 'completed',
    outputs: {
      station: ex.p.station,
      score: ex.p.score,
      finished:
        !ex.interrupted && !('code' in work) && work.status === 'completed',
      playedSeconds: 'code' in work ? 0 : work.elapsed,
    },
  };
}
function publish(rt: Runtime, ex: Exec) {
  const e = rt.world.entities[ex.p.station],
    w = readWorkstation(rt, ex.p.station);
  if (
    !e?.equipment ||
    'code' in w ||
    typeof w.task !== 'string' ||
    w.task !== workParams(ex.p).task ||
    w.user !== ex.p.performer ||
    !ex.work ||
    rt.records.get(ex.work)?.parent !== ex.id ||
    (w.status === 'active' && w.action !== ex.work)
  )
    return;
  e.equipment.config.programAction = ex.work!;
  e.equipment.config.programKind = 'electronic-music/v1';
  e.equipment.config.programData = JSON.stringify({
    task: w.task,
    score: ex.p.score,
    period: ex.p.period,
  });
}
const id = z.string().min(1).max(80);
export const computerMusic: ActionDef<MusicParams, null, Exec> = {
  verb: 'computer_music',
  description:
    'Make an original bounded electronic score at a usable computer, with optional seated listeners; safely interrupt and explicitly resume the same purpose.',
  schema: z.strictObject({
    performer: id,
    station: id,
    seat: id,
    listeners: z.array(z.strictObject({ actor: id, seat: id })).max(2),
    score: z.enum(['gentle', 'bright']),
    period: z.number().min(0.25).max(2),
    duration: z.number().min(2).max(120),
    resume: z.boolean().optional(),
  }),
  // Stable logical commitments; ordinary children exclusively own physical actors/equipment.
  reservations: (_w, p) => [
    { resource: `music:${p.station}`, mode: 'exclusive' },
    ...[p.performer, ...p.listeners.map((l) => l.actor)].map((actor) => ({
      resource: `music-participant:${actor}`,
      mode: 'exclusive' as const,
    })),
  ],
  plan(rt, p) {
    const issue = preflight(rt, p);
    return issue
      ? { ok: false, diagnostic: issue }
      : { ok: true, program: null };
  },
  start(rt, p, _program, action) {
    const ex: Exec = {
      id: action,
      p: structuredClone(p),
      mode: 'starting',
      children: [],
      listeners: p.listeners.map((l) => ({ ...l, departed: false })),
      interrupted: false,
    };
    store(rt).set(action, ex);
    return ex;
  },
  onDirective(rt, ex, by, claims, ancestors) {
    if (
      ancestors.includes(ex.id) ||
      ex.mode === 'stopping' ||
      ex.mode === 'completed'
    )
      return;
    const actors = claims
      .filter((c) => c.resource.startsWith('actor:'))
      .map((c) => c.resource.slice(6));
    if (actors.includes(ex.p.performer)) {
      rt.cancel(
        ex.id,
        diagnostic(
          'directed-away',
          `${by.verb} ${by.id} takes precedence; safely stop and explicitly resume the music purpose`,
          [ex.id, by.id, ex.p.performer],
        ),
      );
    }
    for (const listener of ex.listeners)
      if (actors.includes(listener.actor)) listener.departed = true;
  },
  step(rt, ex) {
    if (ex.mode === 'stopping') return drain(rt, ex);
    if (ex.mode === 'starting') {
      const issue = preflight(rt, ex.p);
      if (issue) {
        stop(ex, issue);
        return drain(rt, ex);
      }
      const work = rt.submit('work_at', workParams(ex.p), {
        parent: ex.id,
        preempt: false,
      });
      ex.children.push(work.id);
      ex.work = work.id;
      if (work.status === 'failed') {
        stop(ex, work.diagnostic);
        return drain(rt, ex);
      }
      for (const listener of ex.listeners) {
        const child = rt.submit(
          'sit',
          { actor: listener.actor, slot: listener.seat },
          { parent: ex.id, preempt: false },
        );
        listener.child = child.id;
        ex.children.push(child.id);
        if (child.status === 'failed') {
          stop(ex, child.diagnostic);
          return drain(rt, ex);
        }
      }
      ex.mode = 'performing';
      return { status: 'running', phase: 'arriving' };
    }
    publish(rt, ex);
    for (const l of ex.listeners) {
      if (!l.child) continue;
      const child = rt.records.get(l.child)!;
      if (l.departed && rt.isActive(l.child)) rt.cancel(l.child);
      if (!rt.isActive(l.child)) l.departed = true;
      if (
        !l.departed &&
        child.phase !== 'occupied' &&
        rt.tick - child.requestedTick > 120 * 20
      ) {
        l.departed = true;
        rt.cancel(l.child);
        rt.mark('music.listener-unavailable', {
          music: ex.id,
          actor: l.actor,
          seat: l.seat,
        });
      }
    }
    const work = rt.records.get(ex.work!)!;
    if (!rt.isActive(work.id)) {
      if (work.status !== 'completed') {
        ex.interrupted = true;
        stop(
          ex,
          work.diagnostic ??
            diagnostic(
              'performance-stopped',
              `Computer work ${work.id} ended ${work.status}; bookmark retained`,
              [ex.id, work.id, ex.p.performer],
            ),
        );
      } else stop(ex);
      return drain(rt, ex);
    }
    const station = musicStation(rt, ex.p.station);
    return {
      status: 'running',
      phase:
        station && !('code' in station) && station.note !== null
          ? 'playing'
          : (work.phase ?? 'arriving'),
    };
  },
  cancel(_rt, ex) {
    ex.interrupted = true;
    stop(ex);
    return { ok: true, deferred: true };
  },
  resumable:
    'Active music session restoration is unsupported; safely stopped computer progress and its recorded program support explicit same-purpose resumption.',
};
export function readComputerMusic(rt: Runtime, action: string) {
  const ex = sessions.get(rt)?.get(action),
    rec = rt.records.get(action);
  if (!ex || !rec) return;
  const w = musicStation(rt, ex.p.station);
  return {
    action,
    status: rec.status,
    mode: ex.mode,
    phase: rec.phase,
    bindings: structuredClone(ex.p),
    ...(w && !('code' in w)
      ? {
          elapsed: w.elapsed,
          duration: w.duration,
          note: w.note,
          pulse: w.pulse,
        }
      : {}),
    listeners: ex.listeners.map((l) => ({
      actor: l.actor,
      seat: l.seat,
      child: l.child,
      // Explicit departure survives safe group interruption; cleanup is not withdrawal.
      withdrawn: l.departed,
      state:
        l.departed ||
        ex.mode === 'completed' ||
        (l.child && !rt.isActive(l.child))
          ? 'left'
          : l.child && rt.records.get(l.child)?.phase === 'occupied'
            ? 'listening'
            : 'arriving',
    })),
    ...(ex.error ? { diagnostic: structuredClone(ex.error) } : {}),
  };
}
export const COMPUTER_MUSIC_ACTIONS: ActionDef[] = [computerMusic];
