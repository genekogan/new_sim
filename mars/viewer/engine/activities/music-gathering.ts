// Hypothetical bounded music gathering; ordinary work/sit/walk own movement and support.
import { z } from 'zod';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { dist2, dsin, type Vec2 } from '../core/math.ts';
import { humanOf } from '../social/actions.ts';
import { readWorkstation } from '../objects/workstation.ts';
import { heldBy } from '../items/model.ts';
import { holdingDiagnostic } from '../construction/rules.ts';
import { checkStations } from '../construction/children.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import type { Spatial } from '../spatial/service.ts';
import { clearanceAt, nearestBlocker } from '../spatial/grid.ts';
import { at, bodyFrame, restHand } from '../body/model.ts';
import { lerp3, smooth } from '../items/body.ts';
import {
  computerMusic,
  musicStation,
  readComputerMusic,
  type MusicParams,
} from './computer-music.ts';
import { createTurns, stepTurns, type TurnState } from './turns.ts';
const id = z.string().min(1).max(80);
const dancerSchema = z.strictObject({
  actor: id,
  at: z.tuple([z.number().min(-500).max(500), z.number().min(-500).max(500)]),
  face: z.number(),
  join: z.boolean().optional(),
});
export interface DancePlace {
  actor: string;
  at: Vec2;
  face: number;
  join?: boolean;
}
export interface MusicGatheringParams extends MusicParams {
  dancers: DancePlace[];
  resumeFrom?: string;
}
interface Member extends DancePlace {
  invited: boolean;
  withdrawn: boolean;
  child?: string;
}
interface GatheringExec {
  id: string;
  p: MusicGatheringParams;
  music?: string;
  members: Member[];
  mode: 'starting' | 'gathering' | 'stopping' | 'ended';
  children: string[];
  turns: TurnState;
  error?: Diagnostic;
}
const sessions = new WeakMap<Runtime, Map<string, GatheringExec>>();
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
): Diagnostic => ({ code: `music-gathering.${code}`, message, subjects });
/** Planted-body/arm envelope, not arbitrary terrain admission. */
export const DANCE_CLEARANCE = HUMAN_PROFILE.radius + 0.32;
export const DANCE_RELEASE_TIME = 0.4;
function floorIssue(rt: Runtime, p: DancePlace): Diagnostic | null {
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
      `${p.actor} requires ordinary flat ground for ${p.at.join(', ')}`,
      [p.actor],
    );
  for (const record of rt.records.values()) {
    if (record.verb !== 'grounded_dance' || !rt.isActive(record.id)) continue;
    const other = record.params as DanceParams;
    if (other.actor !== p.actor && dist2(p.at, other.at) < DANCE_CLEARANCE * 2)
      return issue(
        'floor-overlap',
        `${p.actor}'s floor envelope overlaps active dancer ${other.actor} (${record.id})`,
        [p.actor, other.actor, record.id],
      );
  }
  const load = holdingDiagnostic(rt.world, p.actor);
  if (load) return load;
  const items = heldBy(rt.world, p.actor).map(({ item }) => item.id);
  if (items.length)
    return issue(
      'hands-occupied',
      `${p.actor} must put down ${items.join(', ')} before dancing`,
      [p.actor, ...items],
    );
  const sp = rt.services.spatial as Spatial;
  sp.sync(rt.world);
  const grid = sp.level(0);
  if (!grid || clearanceAt(grid, p.at) < DANCE_CLEARANCE)
    return issue(
      'floor-clearance',
      `${p.actor}'s planted dance envelope at (${p.at.join(', ')}) needs ${DANCE_CLEARANCE.toFixed(2)} m clearance from ${grid ? (nearestBlocker(grid, p.at) ?? 'floor edge') : 'missing ground'}`,
      [p.actor],
    );
  for (const e of Object.values(rt.world.entities))
    if (
      e.human &&
      e.id !== p.actor &&
      e.human.level === 0 &&
      dist2(p.at, [e.pose.p[0], e.pose.p[2]]) <
        DANCE_CLEARANCE + HUMAN_PROFILE.radius
    )
      return issue(
        'floor-occupied',
        `${e.id} occupies ${p.actor}'s dance envelope at (${p.at.join(', ')})`,
        [p.actor, e.id],
      );
  return checkStations(rt, [{ actor: p.actor, p: p.at, level: 0 }]);
}
interface DanceParams extends DancePlace {
  station: string;
}
interface DanceExec {
  id: string;
  p: DanceParams;
  child?: string;
  mode: 'arriving' | 'dancing' | 'stopping';
  blend: number;
  error?: Diagnostic;
}
function releaseDance(rt: Runtime, ex: DanceExec): StepResult {
  if (ex.child && rt.isActive(ex.child)) rt.cancel(ex.child);
  if (ex.child && rt.isActive(ex.child))
    return { status: 'running', phase: 'stopping-walk' };
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
export const groundedDance: ActionDef<DanceParams, null, DanceExec> = {
  verb: 'grounded_dance',
  description:
    'Approach an authored clear floor place with ordinary walking, then perform planted-foot rhythmic arm movement to the computer score. Safe hand lowering precedes director handoff.',
  schema: dancerSchema.omit({ join: true }).extend({ station: id }),
  reservations: (_w, p) => [
    { resource: `actor:${p.actor}`, mode: 'exclusive' },
    {
      resource: `dance-place:${p.station}:${p.at.join(',')}`,
      mode: 'exclusive',
    },
  ],
  plan(rt, p) {
    const station = readWorkstation(rt, p.station);
    if ('code' in station) return { ok: false, diagnostic: station };
    const bad = floorIssue(rt, p);
    return bad ? { ok: false, diagnostic: bad } : { ok: true, program: null };
  },
  start(rt, p, _prog, action) {
    const ex: DanceExec = {
      id: action,
      p: structuredClone(p),
      mode: 'arriving',
      blend: 0,
    };
    const walk = rt.submit(
      'walk_to',
      { actor: p.actor, x: p.at[0], z: p.at[1], face: p.face, level: 0 },
      { parent: action, preempt: false },
    );
    ex.child = walk.id;
    if (walk.status === 'failed') {
      ex.error = walk.diagnostic;
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
          `${ex.p.actor} disappeared from dance place`,
          [ex.p.actor],
        ),
      };
    if (ex.mode === 'arriving') {
      const child = rt.records.get(ex.child!)!;
      if (rt.isActive(child.id))
        return { status: 'running', phase: 'approaching-floor' };
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
        ex.mode = 'dancing';
      }
    }
    const music = musicStation(rt, ex.p.station);
    const playing =
      ex.mode === 'dancing' &&
      music &&
      !('code' in music) &&
      music.note !== null;
    ex.blend = Math.max(
      0,
      Math.min(1, ex.blend + ((playing ? 1 : -1) * dt) / DANCE_RELEASE_TIME),
    );
    if (h.task === ex.id) {
      h.activity = playing ? 'dance' : 'listen';
      const b = bodyFrame(rt.world.entities[ex.p.actor]);
      const wave = playing ? dsin((music.elapsed * Math.PI) / music.period) : 0,
        k = smooth(ex.blend);
      // Reach-bounded palm sweeps; actor root and feet remain grounded and unchanged.
      h.hands = {
        left: lerp3(
          restHand(b, 'left'),
          at(b, 0.24 + 0.06 * wave, -0.3, 1.05 + 0.15 * wave),
          k,
        ),
        right: lerp3(
          restHand(b, 'right'),
          at(b, 0.24 - 0.06 * wave, 0.3, 1.05 - 0.15 * wave),
          k,
        ),
      };
    }
    if (ex.mode === 'stopping') return releaseDance(rt, ex);
    return { status: 'running', phase: playing ? 'dancing' : 'awaiting-score' };
  },
  cancel(_rt, ex) {
    ex.mode = 'stopping';
    return { ok: true, deferred: true };
  },
  yieldTo: (_rt, self, _holder, _actor, by) =>
    /:make-way:\d+$/.test(by.id) ? [] : [self.id],
  resumable:
    'Active grounded-dance restoration is unsupported; explicit gathering Resume uses retained computer progress.',
};
function musicParams(rt: Runtime, p: MusicGatheringParams): MusicParams {
  const prior = p.resumeFrom ? sessions.get(rt)?.get(p.resumeFrom) : undefined;
  const old = prior?.music ? readComputerMusic(rt, prior.music) : undefined;
  const listeners =
    p.resume && old
      ? p.listeners.filter(
          (l) => !old.listeners.find((m) => m.actor === l.actor)?.withdrawn,
        )
      : p.listeners;
  return {
    performer: p.performer,
    station: p.station,
    seat: p.seat,
    listeners,
    score: p.score,
    period: p.period,
    duration: p.duration,
    ...(p.resume ? { resume: true } : {}),
  };
}
function preflight(rt: Runtime, p: MusicGatheringParams): Diagnostic | null {
  const actors = [
    p.performer,
    ...p.listeners.map((l) => l.actor),
    ...p.dancers.map((d) => d.actor),
  ];
  if (new Set(actors).size !== actors.length)
    return issue(
      'duplicate-role',
      `Distinct music gathering roles required: ${actors.join(', ')}`,
      actors,
    );
  for (const verb of ['computer_music', 'grounded_dance', 'walk_to'])
    if (!rt.registry.has(verb))
      return issue('executor-missing', `Music gathering needs ${verb}`, [verb]);
  const planned = computerMusic.plan(rt, musicParams(rt, p));
  if (!planned.ok) return planned.diagnostic;
  if (p.resumeFrom && !p.resume)
    return issue(
      'resume-binding',
      `Original gathering ${p.resumeFrom} requires explicit Resume`,
      [p.resumeFrom],
    );
  if (p.resume) {
    const prior = p.resumeFrom ? store(rt).get(p.resumeFrom) : undefined;
    if (
      !prior ||
      rt.isActive(prior.id) ||
      prior.p.station !== p.station ||
      prior.p.performer !== p.performer ||
      prior.p.seat !== p.seat ||
      prior.p.duration !== p.duration ||
      JSON.stringify(prior.p.listeners) !== JSON.stringify(p.listeners) ||
      JSON.stringify(prior.p.dancers) !== JSON.stringify(p.dancers)
    )
      return issue(
        'resume-binding',
        `Resume requires the stopped original gathering and same dance places for ${p.station}`,
        [p.station, p.resumeFrom ?? 'missing original'],
      );
  }
  for (let i = 0; i < p.dancers.length; i++) {
    const d = p.dancers[i];
    if (
      dist2(d.at, [
        rt.world.entities[p.station].pose.p[0],
        rt.world.entities[p.station].pose.p[2],
      ]) > 5
    )
      return issue(
        'floor-distance',
        `${d.actor}'s floor place must be within 5 m of ${p.station}`,
        [d.actor, p.station],
      );
    for (const other of p.dancers.slice(i + 1))
      if (dist2(d.at, other.at) < DANCE_CLEARANCE * 2)
        return issue(
          'floor-overlap',
          `${d.actor} and ${other.actor} require distinct non-overlapping dance envelopes`,
          [d.actor, other.actor],
        );
    const prior = p.resumeFrom ? store(rt).get(p.resumeFrom) : undefined;
    const retained = prior?.members.find((m) => m.actor === d.actor);
    if (p.resume && retained && (!retained.invited || retained.withdrawn))
      continue;
    const bad = floorIssue(rt, d);
    if (bad) return bad;
    const held =
      d.join === false && !p.resume ? [] : rt.holder(`actor:${d.actor}`);
    if (held.length)
      return issue(
        'participant-busy',
        `${d.actor} remains owned by ${held.join(', ')}`,
        [d.actor, ...held],
      );
  }
  return null;
}
function join(
  rt: Runtime,
  ex: GatheringExec,
  member: Member,
): Diagnostic | null {
  const child = rt.submit(
    'grounded_dance',
    {
      actor: member.actor,
      at: member.at,
      face: member.face,
      station: ex.p.station,
    },
    { parent: ex.id, preempt: false },
  );
  if (child.status === 'failed') return child.diagnostic!;
  member.child = child.id;
  member.invited = true;
  member.withdrawn = false;
  ex.children.push(child.id);
  rt.mark('music-gathering.join', { gathering: ex.id, actor: member.actor });
  return null;
}
function drain(rt: Runtime, ex: GatheringExec): StepResult {
  for (const child of ex.children) if (rt.isActive(child)) rt.cancel(child);
  if (ex.children.some((child) => rt.isActive(child)))
    return { status: 'running', phase: 'safe-release' };
  ex.mode = 'ended';
  const music = musicStation(rt, ex.p.station);
  return ex.error
    ? { status: 'failed', diagnostic: ex.error }
    : {
        status: 'completed',
        outputs: {
          station: ex.p.station,
          elapsed: music && !('code' in music) ? music.elapsed : 0,
        },
      };
}
export const musicGathering: ActionDef<
  MusicGatheringParams,
  null,
  GatheringExec
> = {
  verb: 'music_gathering',
  description:
    'An original computer-music gathering with seated listening, independently joining grounded dancers and rotating floor attention. Pause safely releases physical resources; Resume preserves the same score.',
  schema: z.strictObject({
    performer: id,
    station: id,
    seat: id,
    listeners: z.array(z.strictObject({ actor: id, seat: id })).max(2),
    score: z.enum(['gentle', 'bright']),
    period: z.number().min(0.25).max(2),
    duration: z.number().min(2).max(120),
    resume: z.boolean().optional(),
    dancers: z.array(dancerSchema).min(1).max(2),
    resumeFrom: id.optional(),
  }),
  reservations: (_w, p) => [
    { resource: `music-gathering:${p.station}`, mode: 'exclusive' },
  ],
  plan(rt, p) {
    const bad = preflight(rt, p);
    return bad ? { ok: false, diagnostic: bad } : { ok: true, program: null };
  },
  start(rt, p, _prog, action) {
    const prior = p.resumeFrom ? store(rt).get(p.resumeFrom) : undefined;
    const ex: GatheringExec = {
      id: action,
      p: structuredClone(p),
      mode: 'starting',
      children: [],
      turns: prior ? structuredClone(prior.turns) : createTurns(0),
      members: p.dancers.map((d) => ({
        ...structuredClone(d),
        invited: d.join !== false,
        withdrawn: false,
      })),
    };
    if (prior)
      for (const member of ex.members) {
        const old = prior.members.find((m) => m.actor === member.actor)!;
        member.invited = old.invited;
        member.withdrawn = old.withdrawn;
      }
    store(rt).set(action, ex);
    return ex;
  },
  step(rt, ex, dt) {
    if (ex.mode === 'stopping') return drain(rt, ex);
    if (ex.mode === 'starting') {
      const bad = preflight(rt, ex.p);
      if (bad) {
        ex.error = bad;
        ex.mode = 'stopping';
        return drain(rt, ex);
      }
      const music = rt.submit('computer_music', musicParams(rt, ex.p), {
        parent: ex.id,
        preempt: false,
      });
      ex.music = music.id;
      ex.children.push(music.id);
      if (music.status === 'failed') {
        ex.error = music.diagnostic;
        ex.mode = 'stopping';
        return drain(rt, ex);
      }
      for (const member of ex.members)
        if (member.invited && !member.withdrawn) {
          const bad = join(rt, ex, member);
          if (bad) {
            ex.error = bad;
            ex.mode = 'stopping';
            return drain(rt, ex);
          }
        }
      ex.mode = 'gathering';
    }
    for (const member of ex.members)
      if (member.child && !rt.isActive(member.child)) member.withdrawn = true;
    const music = rt.records.get(ex.music!)!;
    if (!rt.isActive(music.id)) {
      if (music.status !== 'completed') ex.error = music.diagnostic;
      ex.mode = 'stopping';
      return drain(rt, ex);
    }
    const current = musicStation(rt, ex.p.station);
    const dancing = ex.members
      .filter(
        (m) =>
          m.child &&
          rt.isActive(m.child) &&
          rt.records.get(m.child)?.phase === 'dancing',
      )
      .map((m) => m.actor);
    stepTurns(
      ex.turns,
      [ex.p.performer, ...dancing],
      !!current && !('code' in current) && current.note !== null,
      dt,
    );
    return {
      status: 'running',
      phase: dancing.length ? 'music-and-dance' : 'gathering',
    };
  },
  cancel(_rt, ex) {
    ex.mode = 'stopping';
    return { ok: true, deferred: true };
  },
  yieldTo: (_rt, _self, holder, _actor, by) =>
    /:make-way:\d+$/.test(by.id) ? [] : [holder.id],
  onDirective(rt, ex, by, claims, ancestors) {
    if (
      ancestors.includes(ex.id) ||
      ex.mode === 'stopping' ||
      ex.mode === 'ended'
    )
      return;
    for (const member of ex.members)
      if (claims.some((c) => c.resource === `actor:${member.actor}`))
        member.withdrawn = true;
    if (claims.some((c) => c.resource === `actor:${ex.p.performer}`))
      rt.cancel(
        ex.id,
        issue(
          'performer-directed',
          `${by.id} takes precedence over gathering ${ex.id}; unfinished score retained`,
          [by.id, ex.p.performer],
        ),
      );
  },
  resumable:
    'Active music-gathering restoration is unsupported; explicit same-runtime Resume retains the computer score and participant withdrawals.',
};
export interface MusicGatheringControlParams {
  gathering: string;
  actor: string;
  command: 'join' | 'leave';
}
export const musicGatheringControl: ActionDef<
  MusicGatheringControlParams,
  null,
  MusicGatheringControlParams
> = {
  verb: 'music_gathering_control',
  description:
    'Join or leave one authored dancer place without interrupting the score or other participants.',
  schema: z.strictObject({
    gathering: id,
    actor: id,
    command: z.enum(['join', 'leave']),
  }),
  reservations: () => [],
  plan(rt, p) {
    const ex = store(rt).get(p.gathering),
      member = ex?.members.find((m) => m.actor === p.actor);
    if (!ex || !rt.isActive(ex.id) || ex.mode !== 'gathering' || !member)
      return {
        ok: false,
        diagnostic: issue(
          'control-target',
          `${p.gathering} has no active authored dancer ${p.actor}`,
          [p.gathering, p.actor],
        ),
      };
    if (p.command === 'join') {
      if (member.child && rt.isActive(member.child))
        return {
          ok: false,
          diagnostic: issue(
            'already-present',
            `${p.actor} is still approaching, dancing or safely leaving ${p.gathering}`,
            [p.actor, p.gathering],
          ),
        };
      const held = rt.holder(`actor:${p.actor}`),
        bad = held.length
          ? issue(
              'participant-busy',
              `${p.actor} remains owned by ${held.join(', ')}`,
              [p.actor, ...held],
            )
          : floorIssue(rt, member);
      if (bad) return { ok: false, diagnostic: bad };
    }
    return { ok: true, program: null };
  },
  start: (_rt, p) => p,
  step(rt, p) {
    const ex = store(rt).get(p.gathering),
      member = ex?.members.find((m) => m.actor === p.actor);
    if (!ex || !member || !rt.isActive(ex.id) || ex.mode !== 'gathering')
      return {
        status: 'failed',
        diagnostic: issue(
          'control-target',
          `${p.gathering} stopped before ${p.actor} could ${p.command}`,
          [p.gathering, p.actor],
        ),
      };
    if (p.command === 'join') {
      const bad = join(rt, ex, member);
      if (bad) return { status: 'failed', diagnostic: bad };
    } else {
      member.withdrawn = true;
      member.invited = false;
      if (member.child && rt.isActive(member.child)) rt.cancel(member.child);
      rt.mark('music-gathering.leave', {
        gathering: ex.id,
        actor: member.actor,
      });
    }
    return {
      status: 'completed',
      outputs: { actor: p.actor, command: p.command },
    };
  },
  cancel: () => ({ ok: true }),
};
export function readMusicGathering(rt: Runtime, action: string) {
  const ex = sessions.get(rt)?.get(action),
    rec = rt.records.get(action);
  if (!ex || !rec) return undefined;
  return {
    action,
    status: rec.status,
    mode: ex.mode,
    phase: rec.phase,
    bindings: structuredClone(ex.p),
    floorHolder: ex.turns.floorHolder,
    music: ex.music ? readComputerMusic(rt, ex.music) : undefined,
    dancers: ex.members.map((m) => ({
      actor: m.actor,
      at: [...m.at],
      child: m.child,
      invited: m.invited,
      withdrawn: m.withdrawn,
      state:
        m.child && rt.isActive(m.child)
          ? (rt.records.get(m.child)!.phase ?? 'approaching-floor')
          : m.withdrawn
            ? 'left'
            : 'invited',
    })),
    ...(ex.error ? { diagnostic: structuredClone(ex.error) } : {}),
  };
}
export function musicGatheringAttention(
  rt: Runtime,
  action: string,
): Record<string, Vec2> {
  const ex = sessions.get(rt)?.get(action);
  if (!ex || !rt.isActive(action) || ex.mode !== 'gathering') return {};
  const target =
    ex.turns.floorHolder && rt.world.entities[ex.turns.floorHolder];
  if (!target) return {};
  const out: Record<string, Vec2> = {},
    listeners = ex.music
      ? (readComputerMusic(rt, ex.music)
          ?.listeners.filter((l) => l.state === 'listening')
          .map((l) => l.actor) ?? [])
      : [];
  for (const actor of [
    ex.p.performer,
    ...listeners,
    ...ex.members
      .filter((m) => m.child && rt.isActive(m.child) && !m.withdrawn)
      .map((m) => m.actor),
  ])
    if (actor !== target.id) out[actor] = [target.pose.p[0], target.pose.p[2]];
  return out;
}
export const MUSIC_GATHERING_ACTIONS: ActionDef[] = [
  musicGathering,
  musicGatheringControl,
  groundedDance,
];
