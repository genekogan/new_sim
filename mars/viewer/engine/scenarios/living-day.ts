import { readMusicGathering } from '../activities/music-gathering.ts';
import { readPurposefulRoutine } from '../activities/purposeful-routine.ts';
import { musicGatheringBinding } from './music-gathering.ts';
// Hypothetical linked intentions; ordinary actions retain all physical authority.
import type { Runtime } from '../runtime/runtime.ts';
import type { ActionRecord, Diagnostic } from '../actions/types.ts';
import type { Entity } from '../world/types.ts';
import { human } from '../world/factory.ts';
import { itemEntity, surfaceSlot, placeOnSlot } from '../items/model.ts';
import {
  preparedDayWorld,
  preparedDayScene,
  preparedDayBindings,
} from './prepared-day.ts';
import { designStudioBindings } from './design-studio.ts';
import { WORK_BREAK_BINDING } from './work-break.ts';
import { classroomParams } from './classroom.ts';
import { readClassroom } from '../activities/classroom.ts';
import { readLivingIntention } from '../activities/living-intention.ts';
import { gardenState } from '../objects/garden.ts';
import type { GardenEntity } from '../objects/garden.ts';
import { pairedMealWalk } from './paired-meal-walk.ts';
import type { PurposefulRoutineParams } from '../activities/purposeful-routine.ts';
export type LivingDayName = 'living-day-4' | 'living-day-studio';
export type LivingDayOptions = {
  worker: 'original' | 'assistant';
  workstation: 'preferred' | 'alternative';
};
export const livingDayBase = (name: LivingDayName) =>
  name === 'living-day-studio'
    ? ('prepared-day-studio' as const)
    : ('prepared-day-4' as const);
export const livingDayScene = (name: LivingDayName) =>
  preparedDayScene(livingDayBase(name));
export function livingDayBindings(name: LivingDayName) {
  const studio = name === 'living-day-studio',
    base = studio ? designStudioBindings() : undefined;
  return {
    workBreak: base?.workBreak ?? structuredClone(WORK_BREAK_BINDING),
    session: base?.session ?? classroomParams(4),
    rest: base?.rest ?? { seat: 'seat8#seat', seconds: 5 },
    departure: base?.departure ?? ([10, 12] as [number, number]),
  };
}
export function livingDayWorld(name: LivingDayName) {
  const w = preparedDayWorld(livingDayBase(name));
  const fixture = (id: string, def: string, x: number, z: number): Entity => ({
    id,
    def,
    kind: 'fixture',
    pose: { p: [x, 0, z], yaw: 0 },
    support: { kind: 'ground' },
    provenance: {
      origin: 'test-fixture',
      confidence: 'hypothetical',
      note: 'Living-day hypothetical activity equipment',
    },
  });
  for (const e of [
    fixture('aux-computer', 'computer-workstation', 12, -1),
    fixture('aux-chair', 'camp-chair', 12, -2.2),
    fixture('reading-table', 'table-6ft', 7, 13),
    fixture('reading-chair', 'camp-chair', 6.85, 12.15),
    fixture('water-table', 'table-6ft', -9, 13),
    human('day-editor', 14, 7),
    human('reader', 9, 12),
    human('day-neighbour', 14, 12),
    fixture('music-computer', 'computer-workstation', 12, 9),
    fixture('music-chair', 'camp-chair', 12, 7.8),
    fixture('listener-chair', 'camp-chair', 14, 9),
    human('musician', 15, 12),
    human('listener', 15, 6),
    human('dancer-a', 8, 11),
    human('dancer-b', 12, 13),
    human('carer', -12, 11),
  ])
    w.entities[e.id] = e;
  w.entities['listener-chair'].pose.yaw = Math.PI / 2;
  for (const [id, x] of [
    ['plant-a', -6],
    ['plant-b', -4],
  ] as const) {
    const e = fixture(id, 'garden-planter', x, 13) as GardenEntity;
    e.gardenCare = gardenState();
    w.entities[id] = e;
  }
  for (const [id, def, slot] of [
    ['book', 'reading-book', 'reading-table#r0c2'],
    ['water-bowl', 'bowl', 'water-table#r0c2'],
  ]) {
    const e = itemEntity(
      id,
      def,
      [0, 0, 0],
      0,
      id === 'water-bowl' ? { contents: { food: 'water', fraction: 1 } } : {},
    );
    w.entities[id] = e;
    const s = surfaceSlot(w, slot);
    if ('code' in s) throw Error(s.message);
    placeOnSlot(e, s, 0);
  }
  return w;
}
type Day = {
  name: LivingDayName;
  options: LivingDayOptions;
  phase:
    | 'initial-work'
    | 'gathering'
    | 'connected-routine'
    | 'completed'
    | 'ended'
    | 'waiting';
  initial: string;
  session?: string;
  routine?: string;
  music?: string;
  musicReady?: boolean;
  musicRetryTick?: number;
  independent: string[];
  diagnostic?: Diagnostic;
};
const state = (rt: Runtime) => rt.services.livingDay as Day | undefined;
export function readLivingDay(rt: Runtime) {
  const d = state(rt);
  return d
    ? structuredClone({
        ...d,
        musicState: d.music ? readMusicGathering(rt, d.music) : undefined,
        intentions: d.independent.map((id) => readLivingIntention(rt, id)),
      })
    : undefined;
}
export function startLivingDay(
  rt: Runtime,
  name: LivingDayName,
  options: LivingDayOptions,
): ActionRecord | Diagnostic {
  if (state(rt))
    return {
      code: 'day.already-started',
      message:
        'This day already has retained commitments; resume them or Reset for another casting.',
      subjects: [],
    };
  const b = livingDayBindings(name),
    actor =
      options.worker === 'assistant' ? 'day-editor' : b.workBreak.work.actor;
  const original = { ...b.workBreak.work, actor };
  const alternate = {
    ...original,
    station: 'aux-computer',
    seat: 'aux-chair#seat',
  };
  const choices =
    options.workstation === 'preferred'
      ? [original, alternate]
      : [alternate, original];
  const initial = rt.submit(
    'living_intention',
    {
      actor,
      objectives: [
        {
          purpose: 'project-notes',
          label: 'First notes block before the gathering',
          sliceSeconds: 4,
          alternatives: choices.map((params) => ({ verb: 'work_at', params })),
        },
      ],
    },
    { preempt: false },
  );
  if (initial.status === 'failed') return initial;
  const independent = [
    rt.submit(
      'living_intention',
      {
        actor: 'reader',
        objectives: [
          {
            purpose: 'reading',
            label: 'Read before a courtyard break',
            sliceSeconds: 6,
            alternatives: [
              {
                verb: 'read_book',
                params: {
                  actor: 'reader',
                  book: 'book',
                  seat: 'reading-chair#seat',
                  task: 'Reading notes',
                  duration: 24,
                },
              },
            ],
          },
          {
            purpose: 'courtyard',
            label: 'Independent walk and pause',
            afterSeconds: 35,
            alternatives: [
              { verb: 'walk_to', params: { actor: 'reader', x: 9, z: 7 } },
            ],
          },
          {
            purpose: 'conversation',
            label: 'A separate courtyard conversation',
            alternatives: [
              {
                verb: 'converse',
                params: {
                  actors: ['reader', 'day-neighbour'],
                  at: [10, 7],
                  duration: 8,
                },
              },
            ],
          },
          {
            purpose: 'reading',
            label: 'Return to the same unfinished reading',
            alternatives: [
              {
                verb: 'read_book',
                params: {
                  actor: 'reader',
                  book: 'book',
                  seat: 'reading-chair#seat',
                  task: 'Reading notes',
                  duration: 24,
                },
              },
            ],
          },
        ],
      },
      { preempt: false },
    ),
    rt.submit(
      'living_intention',
      {
        actor: 'carer',
        objectives: [
          {
            purpose: 'plant-a',
            label: 'Water the first plant',
            afterSeconds: 9,
            alternatives: [
              {
                verb: 'garden_care',
                params: {
                  actor: 'carer',
                  plant: 'plant-a',
                  water: 'water-bowl',
                  returnSlot: 'water-table#r0c2',
                },
              },
            ],
          },
          {
            purpose: 'plant-b',
            label: 'Care for the other plant',
            afterSeconds: 50,
            alternatives: [
              {
                verb: 'garden_care',
                params: {
                  actor: 'carer',
                  plant: 'plant-b',
                  water: 'water-bowl',
                  returnSlot: 'water-table#r0c2',
                },
              },
            ],
          },
          {
            purpose: 'return-care',
            label: 'Return to recurring first-plant care',
            afterSeconds: 100,
            alternatives: [
              {
                verb: 'garden_care',
                params: {
                  actor: 'carer',
                  plant: 'plant-a',
                  water: 'water-bowl',
                  returnSlot: 'water-table#r0c2',
                },
              },
            ],
          },
        ],
      },
      { preempt: false },
    ),
  ];
  rt.services.livingDay = {
    name,
    options: structuredClone(options),
    phase: 'initial-work',
    initial: initial.id,
    independent: independent.map((r) => r.id),
  } satisfies Day;
  return initial;
}
export function adoptLivingDayMusic(rt: Runtime, id: string) {
  const d = state(rt),
    r = rt.records.get(id),
    p = r?.params as { resumeFrom?: string } | undefined;
  if (
    d &&
    r?.verb === 'music_gathering' &&
    rt.isActive(id) &&
    p?.resumeFrom === d.music
  )
    d.music = id;
}
export function retryLivingDay(rt: Runtime) {
  const d = state(rt);
  if (!d || d.phase !== 'waiting')
    return {
      code: 'day.not-waiting',
      message:
        'Only a refused day transition can be retried; use individual Resume for retained activities.',
      subjects: [],
    };
  if (d.routine && d.session && !rt.isActive(d.session)) {
    d.phase = 'ended';
    d.diagnostic = {
      code: 'day.gathering-ended',
      message:
        'The gathering ended before this refused commitment could join. Retained work and independent activities remain; Reset to stage another day.',
      subjects: [d.session, d.routine],
    };
    return d.diagnostic;
  }
  d.diagnostic = undefined;
  d.phase = d.routine ? 'gathering' : 'initial-work';
  tickLivingDay(rt);
  return d.diagnostic ?? null;
}
export function tickLivingDay(rt: Runtime) {
  const d = state(rt);
  if (!d || ['completed', 'ended', 'waiting'].includes(d.phase)) return;
  const initial = rt.records.get(d.initial)!;
  const ended = (id: string) => {
    const r = rt.records.get(id);
    return (
      !!r &&
      (r.outputs?.ended === true || ['cancelled', 'failed'].includes(r.status))
    );
  };
  const stop = (ids: string[]) => {
    d.phase = 'ended';
    d.diagnostic = {
      code: 'day.commitment-ended',
      message:
        'A required commitment ended before its purpose was completed. Retained effects and other running commitments remain; Reset to stage another day.',
      subjects: ids,
    };
  };
  if (
    ended(d.initial) ||
    (d.phase === 'connected-routine' && d.routine && ended(d.routine))
  ) {
    stop([d.routine && ended(d.routine) ? d.routine : d.initial]);
    return;
  }
  if (d.phase === 'initial-work' && initial.status === 'completed') {
    const session = rt.submit(
      'classroom_session',
      livingDayBindings(d.name).session,
      { preempt: false },
    );
    d.session = session.id;
    if (session.diagnostic) {
      d.phase = 'waiting';
      d.diagnostic = session.diagnostic;
    } else d.phase = 'gathering';
  }
  if (
    d.phase === 'gathering' &&
    d.session &&
    ['presenting', 'question'].includes(
      readClassroom(rt, d.session)?.phase ?? '',
    )
  ) {
    const work = [...rt.records.values()].find(
      (r) => r.parent === d.initial && r.verb === 'work_at',
    )?.params as
      | {
          actor: string;
          station: string;
          seat: string;
          task: string;
          duration: number;
        }
      | undefined;
    if (!work) return;
    const b = livingDayBindings(d.name),
      prepared = preparedDayBindings(livingDayBase(d.name))!,
      actor = work.actor;
    const food = {
      pot: b.workBreak.pot,
      participants: [
        { ...b.workBreak.people[0], actor },
        b.workBreak.people[1],
      ] as PurposefulRoutineParams['food']['participants'],
      at: b.workBreak.conversation.at,
    };
    const params: PurposefulRoutineParams = {
      actor,
      session: d.session,
      work: {
        station: work.station,
        seat: work.seat,
        task: work.task,
        duration: work.duration,
      },
      food,
      rest: b.rest,
      departure: b.departure,
      trip: pairedMealWalk(
        actor,
        b.workBreak.people[1].actor,
        d.name === 'living-day-studio' ? -9 : -8,
      ),
      preparation: { ...prepared.preparation, actor },
      sleep: { ...prepared.sleep, actor },
    };
    const r = rt.submit('purposeful_routine', params, { preempt: false });
    d.routine = r.id;
    if (r.diagnostic) {
      d.phase = 'waiting';
      d.diagnostic = r.diagnostic;
    } else d.phase = 'connected-routine';
  }
  if (
    d.routine &&
    (readPurposefulRoutine(rt, d.routine)?.sleep?.elapsed ?? 0) > 0
  )
    d.musicReady = true;
  if (
    d.phase === 'connected-routine' &&
    d.musicReady &&
    !d.music &&
    rt.tick >= (d.musicRetryTick ?? 0)
  ) {
    d.musicRetryTick = rt.tick + 20;
    const def = rt.registry.get('music_gathering')!;
    for (const points of [
      [
        [10, 10],
        [10, 12],
      ],
      [
        [14, 11],
        [14, 13],
      ],
    ] as [number, number][][]) {
      const music = musicGatheringBinding();
      music.dancers = points.map((at, i) => ({
        actor: i === 0 ? 'dancer-a' : 'dancer-b',
        at,
        face: 0,
      }));
      const p = def.schema.parse(music),
        plan = def.plan(rt, p);
      if (!plan.ok) {
        d.diagnostic = plan.diagnostic;
        continue;
      }
      const busy = def
        .reservations(rt.world, p)
        .find((c) => rt.holder(c.resource).length);
      if (busy) {
        d.diagnostic = {
          code: 'day.music-reserved',
          message: `Music waits for ${busy.resource}; its owner retains control.`,
          subjects: [busy.resource],
        };
        continue;
      }
      const r = rt.submit('music_gathering', music, { preempt: false });
      if (r.diagnostic) {
        d.diagnostic = r.diagnostic;
        break;
      }
      d.music = r.id;
      d.diagnostic = undefined;
      break;
    }
  }
  if (
    d.phase === 'connected-routine' &&
    d.routine &&
    rt.records.get(d.routine)?.status === 'completed' &&
    !!d.music &&
    rt.records.get(d.music)?.status === 'completed' &&
    d.independent.every(
      (id) => rt.records.get(id)?.status === 'completed' || ended(id),
    )
  ) {
    const partial = d.independent.filter(ended);
    if (partial.length) stop(partial);
    else d.phase = 'completed';
  }
}
