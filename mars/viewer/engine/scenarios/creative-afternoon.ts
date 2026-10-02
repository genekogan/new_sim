// Hypothetical Drawing Klerb/Open Jacks-inspired afternoon. Actual artifacts and
// ordinary child actions connect the phases; no prerecorded actor motion.
import { Runtime } from '../runtime/runtime.ts';
import type { ActionRecord, Diagnostic } from '../actions/types.ts';
import type { WorldState } from '../world/types.ts';
import { human } from '../world/factory.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { Spatial } from '../spatial/service.ts';
import { drawingWorkScene, drawingWorkParams } from './drawing-work.ts';
import { artSharingWorld, artSharingBinding } from './art-sharing.ts';
import { readingRuntime, READING_BINDING } from './reading.ts';
import { musicGatheringRuntime } from './music-gathering.ts';
import { openJamBinding } from './open-jam.ts';
import { gardenCareWorld, gardenCareParams } from './garden-care.ts';
import { readDrawing } from '../objects/drawing.ts';
import { readLivingIntention } from '../activities/living-intention.ts';
import { readArtSharing } from '../activities/art-sharing.ts';
import { readOpenJam } from '../activities/open-jam.ts';
import { ART_SHARING_ACTIONS } from '../activities/art-sharing.ts';
export const creativeAfternoonScene = drawingWorkScene;
function append(
  w: WorldState,
  source: WorldState,
  dx: number,
  dz: number,
  omit: string[] = [],
) {
  for (const [id, entity] of Object.entries(source.entities)) {
    if (omit.includes(id)) continue;
    if (w.entities[id]) throw Error(`duplicate initial fixture ${id}`);
    const e = structuredClone(entity);
    e.pose.p[0] += dx;
    e.pose.p[2] += dz;
    w.entities[id] = e;
  }
}
export function creativeAfternoonWorld() {
  const w = artSharingWorld(false);
  append(w, readingRuntime().world, -7, 6, ['visitor']);
  append(w, musicGatheringRuntime().world, 7, 3, ['musician']);
  append(w, gardenCareWorld(), -7, -6);
  w.entities['guest-musician'] = human('guest-musician', 14, 8);
  w.base.campus = 'creative-afternoon';
  return w;
}
export function creativeAfternoonRuntime() {
  const common = createRegistry(),
    registry = createRegistry(
      ART_SHARING_ACTIONS.filter((a) => !common.has(a.verb)),
    );
  return new Runtime(
    creativeAfternoonWorld(),
    registry,
    { spatial: new Spatial(creativeAfternoonScene()) },
    ENGINE_INVARIANTS,
  );
}
export function creativeAfternoonJam() {
  const p = openJamBinding();
  p.rounds[0].actor = 'sketcher';
  for (const r of p.rounds) {
    r.exit[0] += 7;
    r.exit[1] += 3;
    r.duration = 7;
  }
  for (const d of p.dancers ?? []) {
    d.at[0] += 7;
    d.at[1] += 3;
  }
  return p;
}
type Phase =
  | 'sketch'
  | 'sharing'
  | 'music'
  | 'return'
  | 'finishing'
  | 'completed'
  | 'ending'
  | 'ended';
type Afternoon = {
  phase: Phase;
  current: string;
  children: string[];
  independent: string[];
  retryTick?: number;
  diagnostic?: Diagnostic;
};
const state = (rt: Runtime) =>
  rt.services.creativeAfternoon as Afternoon | undefined;
export function readCreativeAfternoon(rt: Runtime) {
  const s = state(rt);
  if (!s) return;
  return structuredClone({
    ...s,
    drawing: readDrawing(rt, 'sketch-pad'),
    intention: readLivingIntention(rt, s.current),
    sharing: readArtSharing(rt, s.current),
    jam: readOpenJam(rt, s.current),
    commitments: s.independent.map((id) => readLivingIntention(rt, id)),
  });
}
export function startCreativeAfternoon(rt: Runtime): ActionRecord | Diagnostic {
  if (state(rt))
    return {
      code: 'afternoon.already-started',
      message:
        'This afternoon already retains its artwork and commitments; Resume or Reset.',
      subjects: ['sketch-pad'],
    };
  const params = drawingWorkParams(),
    first = rt.submit('living_intention', {
      actor: params.actor,
      objectives: [
        {
          purpose: 'shelter-study',
          label: 'Begin the same shelter study',
          sliceSeconds: 3,
          alternatives: [{ verb: 'drawing_work', params }],
        },
      ],
    });
  if (first.status === 'failed') return first;
  const reader = rt.submit('living_intention', {
    actor: 'reader',
    objectives: [
      {
        purpose: 'reading',
        label: 'Independent reading block',
        sliceSeconds: 4,
        alternatives: [
          { verb: 'read_book', params: { ...READING_BINDING, duration: 20 } },
        ],
      },
      {
        purpose: 'reading-break',
        label: 'Reader takes a courtyard break',
        alternatives: [
          { verb: 'walk_to', params: { actor: 'reader', x: -12, z: 10 } },
        ],
      },
      {
        purpose: 'reading',
        label: 'Reader returns to the same unfinished book',
        alternatives: [
          { verb: 'read_book', params: { ...READING_BINDING, duration: 20 } },
        ],
      },
    ],
  });
  const carer = rt.submit('living_intention', {
    actor: 'carer',
    objectives: [
      {
        purpose: 'plant-a-care',
        label: 'Finite plant care',
        afterSeconds: 7,
        alternatives: [{ verb: 'garden_care', params: gardenCareParams() }],
      },
      {
        purpose: 'care-break',
        label: 'Carer leaves the completed plant undisturbed',
        alternatives: [
          { verb: 'walk_to', params: { actor: 'carer', x: -12, z: -12 } },
        ],
      },
    ],
  });
  rt.services.creativeAfternoon = {
    phase: 'sketch',
    current: first.id,
    children: [first.id],
    independent: [reader.id, carer.id],
  } satisfies Afternoon;
  return first;
}
export function tickCreativeAfternoon(rt: Runtime) {
  const s = state(rt);
  if (!s || ['completed', 'ended'].includes(s.phase)) return;
  if (s.phase === 'ending') {
    for (const id of [...s.children, ...s.independent])
      if (rt.isActive(id)) rt.cancel(id);
    if ([...s.children, ...s.independent].every((id) => !rt.isActive(id)))
      s.phase = 'ended';
    return;
  }
  if (s.phase === 'finishing') {
    if (s.independent.every((id) => !rt.isActive(id))) {
      const stopped = s.independent
        .map((id) => rt.records.get(id)!)
        .find((r) => r.status !== 'completed');
      if (stopped) {
        s.phase = 'ended';
        s.diagnostic = stopped.diagnostic ?? {
          code: 'afternoon.unfinished-commitment',
          message: `${stopped.id} stopped before its independent purpose finished.`,
          subjects: [stopped.id],
        };
      } else s.phase = 'completed';
    }
    return;
  }
  const r = rt.records.get(s.current)!;
  if (rt.isActive(r.id)) return;
  if (r.status !== 'completed') {
    s.diagnostic = r.diagnostic ?? {
      code: 'afternoon.interrupted',
      message: `${r.verb} stopped; retained artifacts remain. Resume the supported phase or End.`,
      subjects: [r.id],
    };
    return;
  }
  if (rt.tick < (s.retryTick ?? 0)) return;
  let verb: string, params: unknown, phase: Phase;
  if (s.phase === 'sketch') {
    const p = artSharingBinding();
    p.duration = 14;
    p.turnSeconds = 3;
    verb = 'art_sharing';
    params = p;
    phase = 'sharing';
  } else if (s.phase === 'sharing') {
    verb = 'open_jam';
    params = creativeAfternoonJam();
    phase = 'music';
  } else if (s.phase === 'music') {
    const drawing = drawingWorkParams();
    verb = 'living_intention';
    params = {
      actor: drawing.actor,
      objectives: [
        {
          purpose: 'shelter-study',
          label: 'Finish the same shelter study after sharing and music',
          alternatives: [{ verb: 'drawing_work', params: drawing }],
        },
      ],
    };
    phase = 'return';
  } else {
    s.phase = 'finishing';
    return;
  }
  const def = rt.registry.get(verb)!;
  const plan = def.plan(rt, params);
  s.retryTick = rt.tick + 20;
  if (!plan.ok) {
    s.diagnostic = plan.diagnostic;
    return;
  }
  const busy = def
    .reservations(rt.world, params)
    .find((c) => c.mode === 'exclusive' && rt.holder(c.resource).length);
  if (busy) {
    s.diagnostic = {
      code: 'afternoon.resource-busy',
      message: `${busy.resource} belongs to another activity; the existing artwork waits.`,
      subjects: [busy.resource],
    };
    return;
  }
  const next = rt.submit(verb, params, { preempt: false });
  s.phase = phase;
  s.current = next.id;
  s.children.push(next.id);
  s.diagnostic = next.status === 'failed' ? next.diagnostic : undefined;
}
export function controlCreativeAfternoon(
  rt: Runtime,
  command: 'pause' | 'resume' | 'end',
): ActionRecord | Diagnostic {
  const s = state(rt);
  if (!s || ['completed', 'ended', 'ending'].includes(s.phase))
    return {
      code: 'afternoon.inactive',
      message: 'Start an afternoon before changing its commitment.',
      subjects: [],
    };
  if (command === 'end') {
    s.phase = 'ending';
    tickCreativeAfternoon(rt);
    return rt.records.get(s.current)!;
  }
  const r = rt.records.get(s.current)!;
  if (!rt.isActive(r.id))
    return {
      code: 'afternoon.phase-ended',
      message:
        'This physical phase has already ended; advance Play or End the afternoon.',
      subjects: [r.id],
    };
  if (r.verb === 'living_intention')
    return rt.submit('living_intention_control', {
      intention: r.id,
      intent: command,
    });
  if (r.verb === 'art_sharing')
    return rt.submit('art_sharing_control', {
      session: r.id,
      intent: { kind: command },
    });
  return rt.submit('open_jam_control', { jam: r.id, command });
}
