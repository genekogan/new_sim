// Hypothetical open sound practice. Existing music/work/walk actions own physics.
import { z } from 'zod';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Vec2 } from '../core/math.ts';
import { humanOf } from '../social/actions.ts';
import { readWorkstation } from '../objects/workstation.ts';
import {
  musicGathering,
  readMusicGathering,
  type MusicGatheringParams,
} from './music-gathering.ts';

const id = z.string().min(1).max(80);
const place = z.tuple([
  z.number().min(-500).max(500),
  z.number().min(-500).max(500),
]);
const roundSchema = z.strictObject({
  actor: id,
  score: z.enum(['gentle', 'bright']),
  duration: z.number().min(2).max(120),
  exit: place,
});
export interface JamRound {
  actor: string;
  score: 'gentle' | 'bright';
  duration: number;
  exit: Vec2;
}
export interface OpenJamParams {
  station: string;
  seat: string;
  listeners: MusicGatheringParams['listeners'];
  dancers: MusicGatheringParams['dancers'];
  rounds: JamRound[];
  period?: number;
}
interface JamExec {
  id: string;
  p: OpenJamParams;
  index: number;
  mode:
    | 'binding'
    | 'playing'
    | 'clearing'
    | 'paused'
    | 'stopping'
    | 'completed';
  child?: string;
  gathering?: string;
  pauseRequested: boolean;
  retryAt: number;
  waiting?: Diagnostic;
  finished: {
    actor: string;
    score: string;
    playedSeconds: number;
    gathering: string;
  }[];
  departed: string[];
}
const sessions = new WeakMap<Runtime, Map<string, JamExec>>();
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
): Diagnostic => ({
  code: `open-jam.${code}`,
  message,
  subjects,
});
function parameters(ex: JamExec, resume = false): MusicGatheringParams {
  const r = ex.p.rounds[ex.index];
  return {
    performer: r.actor,
    station: ex.p.station,
    seat: ex.p.seat,
    listeners: structuredClone(
      ex.p.listeners.filter((l) => !ex.departed.includes(l.actor)),
    ),
    dancers: ex.p.dancers.map((d) => ({
      ...structuredClone(d),
      ...(ex.departed.includes(d.actor) ? { join: false } : {}),
    })),
    score: r.score,
    duration: r.duration,
    period: ex.p.period ?? 0.5,
    ...(resume ? { resume: true, resumeFrom: ex.gathering } : {}),
  };
}
function pause(rt: Runtime, ex: JamExec, reason?: Diagnostic) {
  // A completed child's effects must be acknowledged even when Pause arrives
  // between its final tick and the coordinator's next tick.
  if (
    ex.mode === 'playing' &&
    ex.child &&
    rt.records.get(ex.child)?.status === 'completed'
  )
    finishRound(rt, ex);
  ex.pauseRequested = true;
  if (reason) ex.waiting = reason;
  if (ex.child && rt.isActive(ex.child)) rt.cancel(ex.child);
}
function finishRound(rt: Runtime, ex: JamExec) {
  const round = ex.p.rounds[ex.index],
    music = readMusicGathering(rt, ex.gathering!)?.music;
  ex.finished.push({
    actor: round.actor,
    score: round.score,
    playedSeconds: music?.elapsed ?? 0,
    gathering: ex.gathering!,
  });
  ex.mode = 'clearing';
  delete ex.child;
  rt.mark('open-jam.round-complete', {
    jam: ex.id,
    round: ex.index,
    actor: round.actor,
  });
}
function rememberDepartures(rt: Runtime, ex: JamExec) {
  const gathering = ex.gathering
    ? readMusicGathering(rt, ex.gathering)
    : undefined;
  const actors = [
    ...(gathering?.dancers.filter((d) => d.withdrawn).map((d) => d.actor) ??
      []),
    ...(gathering?.music?.listeners
      .filter((l) => l.withdrawn)
      .map((l) => l.actor) ?? []),
  ];
  for (const actor of actors)
    if (!ex.departed.includes(actor)) ex.departed.push(actor);
}
function stoppedChild(rt: Runtime, ex: JamExec): boolean {
  return !ex.child || !rt.isActive(ex.child);
}
function drain(rt: Runtime, ex: JamExec): StepResult {
  if (ex.child && rt.isActive(ex.child)) rt.cancel(ex.child);
  if (!stoppedChild(rt, ex))
    return { status: 'running', phase: 'safe-release' };
  return {
    status: 'completed',
    outputs: { finishedRounds: structuredClone(ex.finished), complete: false },
  };
}
function wait(ex: JamExec, diagnostic: Diagnostic, tick: number): StepResult {
  ex.waiting = structuredClone(diagnostic);
  ex.retryAt = tick + 20;
  return { status: 'running', phase: 'waiting-for-handoff' };
}
export const openJam: ActionDef<OpenJamParams, null, JamExec> = {
  verb: 'open_jam',
  description:
    'Take turns making original computer music at the same supported workstation. Ordinary release and exit precede the next performer; retained unfinished rounds resume explicitly after intervention.',
  schema: z.strictObject({
    station: id,
    seat: id,
    listeners: z.array(z.strictObject({ actor: id, seat: id })).max(2),
    dancers: z
      .array(
        z.strictObject({
          actor: id,
          at: place,
          face: z.number(),
          join: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(2),
    rounds: z.array(roundSchema).min(2).max(4),
    period: z.number().min(0.25).max(2).optional(),
  }),
  reservations: (_w, p) => [
    { resource: `open-jam:${p.station}`, mode: 'exclusive' },
  ],
  plan(rt, p) {
    const participants = [
      ...p.rounds.map((r) => r.actor),
      ...p.listeners.map((l) => l.actor),
      ...p.dancers.map((d) => d.actor),
    ];
    if (new Set(participants).size !== participants.length)
      return {
        ok: false,
        diagnostic: issue(
          'duplicate-role',
          'Performers, listeners and dancers must have distinct roles',
          participants,
        ),
      };
    for (const actor of participants) {
      const h = humanOf(rt, actor);
      if ('code' in h) return { ok: false, diagnostic: h };
    }
    for (const verb of ['music_gathering', 'walk_to'])
      if (!rt.registry.has(verb))
        return {
          ok: false,
          diagnostic: issue('executor-missing', `Open jam requires ${verb}`, [
            verb,
          ]),
        };
    const station = readWorkstation(rt, p.station);
    if ('code' in station) return { ok: false, diagnostic: station };
    // First admission is honest; later seats/routes are rechecked just before binding.
    const ex: JamExec = {
      id: '',
      p,
      index: 0,
      mode: 'binding',
      pauseRequested: false,
      retryAt: 0,
      finished: [],
      departed: [],
    };
    return musicGathering.plan(rt, parameters(ex));
  },
  start(rt, p, _program, action) {
    const ex: JamExec = {
      id: action,
      p: structuredClone(p),
      index: 0,
      mode: 'binding',
      pauseRequested: false,
      retryAt: 0,
      finished: [],
      departed: [],
    };
    store(rt).set(action, ex);
    return ex;
  },
  step(rt, ex) {
    if (ex.mode === 'stopping') return drain(rt, ex);
    if (ex.mode === 'playing') rememberDepartures(rt, ex);
    if (ex.pauseRequested) {
      if (ex.child && rt.isActive(ex.child)) rt.cancel(ex.child);
      if (!stoppedChild(rt, ex))
        return { status: 'running', phase: 'safe-pause' };
      ex.mode = 'paused';
      return { status: 'running', phase: 'paused-retained-round' };
    }
    if (ex.mode === 'paused')
      return { status: 'running', phase: 'paused-retained-round' };
    if (ex.mode === 'binding') {
      if (rt.tick < ex.retryAt)
        return { status: 'running', phase: 'waiting-for-handoff' };
      const prior = ex.gathering
        ? readMusicGathering(rt, ex.gathering)
        : undefined;
      const station = readWorkstation(rt, ex.p.station);
      const resume =
        !!prior?.music &&
        !('code' in station) &&
        station.status === 'unfinished';
      const p = resume
        ? { ...prior!.bindings, resume: true, resumeFrom: ex.gathering }
        : parameters(ex);
      const plan = musicGathering.plan(rt, p);
      if (!plan.ok) return wait(ex, plan.diagnostic, rt.tick);
      const child = rt.submit('music_gathering', p, {
        parent: ex.id,
        preempt: false,
      });
      if (child.status === 'failed')
        return wait(ex, child.diagnostic!, rt.tick);
      ex.child = child.id;
      ex.gathering = child.id;
      ex.mode = 'playing';
      delete ex.waiting;
      rt.mark('open-jam.performer', {
        jam: ex.id,
        round: ex.index,
        actor: p.performer,
        resumed: resume,
      });
    }
    if (ex.mode === 'playing') {
      if (!stoppedChild(rt, ex))
        return { status: 'running', phase: `performer-${ex.index + 1}` };
      const rec = rt.records.get(ex.child!)!;
      if (rec.status !== 'completed') {
        pause(
          rt,
          ex,
          rec.diagnostic ??
            issue(
              'interrupted-round',
              `${ex.p.rounds[ex.index].actor}'s unfinished round requires explicit Resume`,
              [ex.id, ex.child!],
            ),
        );
        return { status: 'running', phase: 'safe-pause' };
      }
      finishRound(rt, ex);
    }
    if (ex.mode === 'clearing') {
      const round = ex.p.rounds[ex.index];
      if (!ex.child) {
        if (rt.tick < ex.retryAt)
          return { status: 'running', phase: 'waiting-for-handoff' };
        const params = {
          actor: round.actor,
          x: round.exit[0],
          z: round.exit[1],
        };
        const plan = rt.registry.get('walk_to')!.plan(rt, params);
        if (!plan.ok) return wait(ex, plan.diagnostic, rt.tick);
        const child = rt.submit('walk_to', params, {
          parent: ex.id,
          preempt: false,
        });
        if (child.status === 'failed')
          return wait(ex, child.diagnostic!, rt.tick);
        ex.child = child.id;
        delete ex.waiting;
      }
      if (!stoppedChild(rt, ex))
        return { status: 'running', phase: 'performer-leaving-chair' };
      const rec = rt.records.get(ex.child!)!;
      if (rec.status !== 'completed') {
        pause(
          rt,
          ex,
          rec.diagnostic ??
            issue(
              'exit-interrupted',
              `${round.actor}'s chair exit requires explicit Resume`,
              [round.actor, rec.id],
            ),
        );
        return { status: 'running', phase: 'safe-pause' };
      }
      ex.index++;
      delete ex.child;
      delete ex.gathering;
      if (ex.index === ex.p.rounds.length) {
        ex.mode = 'completed';
        return {
          status: 'completed',
          outputs: {
            finishedRounds: structuredClone(ex.finished),
            complete: true,
          },
        };
      }
      ex.mode = 'binding';
      ex.retryAt = rt.tick + 10;
    }
    return { status: 'running', phase: 'preparing-next-performer' };
  },
  cancel(rt, ex) {
    ex.mode = 'stopping';
    if (ex.child && rt.isActive(ex.child)) rt.cancel(ex.child);
    return { ok: true, deferred: true };
  },
  onDirective(rt, ex, by, claims, ancestors) {
    if (
      ancestors.includes(ex.id) ||
      ex.mode === 'stopping' ||
      ex.mode === 'completed'
    )
      return;
    if (
      claims.some((c) =>
        ex.p.rounds.some((r) => c.resource === `actor:${r.actor}`),
      )
    )
      pause(
        rt,
        ex,
        issue(
          'performer-directed',
          `${by.id} takes precedence; Resume the retained round after direction ends`,
          [by.id, ex.id],
        ),
      );
  },
  resumable:
    'Explicit same-runtime Pause/Resume retains the round and completed session history; active reload restoration is unsupported.',
};
interface Control {
  jam: string;
  command: 'pause' | 'resume' | 'end';
}
export const openJamControl: ActionDef<Control, null, Control> = {
  verb: 'open_jam_control',
  description:
    'Safely pause, explicitly resume, or end a retained open-jam sequence without discarding completed rounds.',
  schema: z.strictObject({
    jam: id,
    command: z.enum(['pause', 'resume', 'end']),
  }),
  reservations: () => [],
  plan(rt, p) {
    const ex = store(rt).get(p.jam);
    if (!ex || !rt.isActive(p.jam) || ex.mode === 'stopping')
      return {
        ok: false,
        diagnostic: issue('control-target', `${p.jam} is not an active jam`, [
          p.jam,
        ]),
      };
    if (p.command === 'resume' && ex.mode !== 'paused')
      return {
        ok: false,
        diagnostic: issue(
          'not-paused',
          `${p.jam} must finish safe cleanup before Resume`,
          [p.jam],
        ),
      };
    return { ok: true, program: null };
  },
  start: (_rt, p) => p,
  step(rt, p) {
    const ex = store(rt).get(p.jam);
    if (!ex || !rt.isActive(p.jam))
      return {
        status: 'failed',
        diagnostic: issue(
          'control-target',
          `${p.jam} ended before ${p.command}`,
          [p.jam],
        ),
      };
    if (p.command === 'pause') pause(rt, ex);
    else if (p.command === 'end') rt.cancel(ex.id);
    else {
      ex.pauseRequested = false;
      ex.mode = ex.finished.length > ex.index ? 'clearing' : 'binding';
      delete ex.child;
      delete ex.waiting;
      ex.retryAt = rt.tick;
    }
    return { status: 'completed', outputs: { jam: p.jam, command: p.command } };
  },
  cancel: () => ({ ok: true }),
};
export function readOpenJam(rt: Runtime, action: string) {
  const ex = sessions.get(rt)?.get(action),
    rec = rt.records.get(action);
  if (!ex || !rec) return undefined;
  return structuredClone({
    action,
    status: rec.status,
    mode: ex.mode,
    phase: rec.phase,
    index: ex.index,
    bindings: ex.p,
    finished: ex.finished,
    departed: ex.departed,
    current: ex.gathering ? readMusicGathering(rt, ex.gathering) : undefined,
    ...(ex.waiting ? { diagnostic: ex.waiting } : {}),
  });
}
export function latestOpenJam(rt: Runtime) {
  const ex = [...(sessions.get(rt)?.values() ?? [])].at(-1);
  return ex ? readOpenJam(rt, ex.id) : undefined;
}
export const OPEN_JAM_ACTIONS: ActionDef[] = [openJam, openJamControl];
