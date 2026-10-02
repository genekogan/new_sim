// Hypothetical anonymous gardening and reading; all motion belongs to ordinary leaves.
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { Spatial } from '../spatial/service.ts';
import { rot2 } from '../core/math.ts';
import {
  seedPlantingWorld,
  seedPlantingScene,
  seedPlantingBinding,
} from './seed-planting.ts';
import { readingRuntime, READING_BINDING } from './reading.ts';
import { itemEntity, placeOnSlot, surfaceSlot } from '../items/model.ts';
import { readSeedbed } from '../objects/planting.ts';
import { readGarden } from '../objects/garden.ts';
import { readBook } from '../objects/reading.ts';
import { readSeedPlanting } from '../activities/seed-planting.ts';
import {
  readLivingIntention,
  type LivingIntentionParams,
} from '../activities/living-intention.ts';
import type { Diagnostic, ActionRecord } from '../actions/types.ts';
export type GardenAfternoonBranch = 'gardener' | 'reader';
export const gardenAfternoonScene = seedPlantingScene;
export function gardenAfternoonWorld(angle = 0) {
  const w = seedPlantingWorld(angle);
  for (const source of Object.values(readingRuntime().world.entities)) {
    if (source.id === 'visitor') continue;
    const e = structuredClone(source),
      p = rot2([e.pose.p[0] + 6, e.pose.p[2] + 5], angle);
    e.pose.p = [p[0], e.pose.p[1], p[1]];
    e.pose.yaw += angle;
    w.entities[e.id] = e;
  }
  const water = itemEntity('water-bowl', 'bowl', [0, 0, 0], angle, {
      contents: { food: 'water', fraction: 0.5 },
      label: 'Hypothetical finite water bowl',
    }),
    slot = surfaceSlot(w, 'seed-table#r0c1');
  if ('code' in slot) throw Error(slot.message);
  placeOnSlot(water, slot, angle);
  w.entities[water.id] = water;
  w.base.campus = 'garden-afternoon';
  return w;
}
export function gardenAfternoonRuntime(angle = 0) {
  return new Runtime(
    gardenAfternoonWorld(angle),
    createRegistry(),
    { spatial: new Spatial(gardenAfternoonScene()) },
    ENGINE_INVARIANTS,
  );
}
export function gardenAfternoonDirection(
  branch: GardenAfternoonBranch,
  angle = 0,
) {
  const p = rot2(branch === 'gardener' ? [-5, 3] : [4, 8], angle);
  return {
    actor: branch === 'gardener' ? 'planter' : 'reader',
    x: p[0],
    z: p[1],
  };
}
export function gardenAfternoonBindings(
  angle = 0,
): Record<GardenAfternoonBranch, LivingIntentionParams> {
  const book = {
    ...READING_BINDING,
    task: 'Hypothetical garden reading',
    duration: 24,
  };
  return {
    gardener: {
      actor: 'planter',
      objectives: [
        {
          purpose: 'sowing',
          label: 'Plant the retained finite seeds',
          alternatives: [
            {
              verb: 'seed_planting',
              params: { ...seedPlantingBinding(angle) },
            },
          ],
        },
        {
          purpose: 'garden-break',
          label: 'Gardener takes an ordinary courtyard walk',
          alternatives: [
            {
              verb: 'walk_to',
              params: gardenAfternoonDirection('gardener', angle),
            },
          ],
        },
        {
          purpose: 'water-care',
          label: 'Water the same planted bed',
          alternatives: [
            {
              verb: 'garden_care',
              params: {
                actor: 'planter',
                plant: 'planter-a',
                water: 'water-bowl',
                returnSlot: 'seed-table#r0c1',
              },
            },
          ],
        },
      ],
    },
    reader: {
      actor: 'reader',
      objectives: [
        {
          purpose: 'book',
          label: 'Begin the same book',
          sliceSeconds: 4,
          alternatives: [{ verb: 'read_book', params: book }],
        },
        {
          purpose: 'reading-break',
          label: 'Reader takes an independent courtyard walk',
          alternatives: [
            {
              verb: 'walk_to',
              params: gardenAfternoonDirection('reader', angle),
            },
          ],
        },
        {
          purpose: 'book',
          label: 'Finish the same unfinished book',
          alternatives: [{ verb: 'read_book', params: book }],
        },
      ],
    },
  };
}
type Afternoon = { angle: number; gardener: string; reader: string };
const state = (rt: Runtime) =>
  rt.services.gardenAfternoon as Afternoon | undefined;
export function readGardenAfternoon(rt: Runtime) {
  const s = state(rt);
  if (!s) return;
  const branch = (name: GardenAfternoonBranch) => {
    const id = s[name],
      r = rt.records.get(id)!,
      intention = readLivingIntention(rt, id),
      child = intention?.child ? rt.records.get(intention.child) : undefined,
      planting =
        child?.verb === 'seed_planting'
          ? readSeedPlanting(rt, child.id)
          : undefined;
    return {
      id,
      status: r.status,
      active: rt.isActive(id),
      intention,
      planting,
      diagnostic:
        planting?.diagnostic ??
        child?.diagnostic ??
        intention?.diagnostic ??
        r.diagnostic,
    };
  };
  const gardener = branch('gardener'),
    reader = branch('reader');
  return structuredClone({
    ...s,
    branches: { gardener, reader },
    phase:
      gardener.active || reader.active
        ? 'active'
        : [gardener, reader].every(
              (b) =>
                b.status === 'completed' && b.intention?.mode === 'completed',
            )
          ? 'completed'
          : 'ended',
    seedbed: readSeedbed(rt, 'planter-a'),
    garden: readGarden(rt, 'planter-a'),
    book: readBook(rt, 'book'),
    bookEntity: rt.world.entities.book,
    seeds: rt.world.entities['seed-bowl'],
    water: rt.world.entities['water-bowl'],
  });
}
export function startGardenAfternoon(
  rt: Runtime,
  angle = 0,
): ActionRecord | Diagnostic {
  if (state(rt))
    return {
      code: 'garden-afternoon.already-started',
      message:
        'Retained branches already exist. Resume a paused branch, or Reset for a new hypothetical afternoon.',
      subjects: [],
    };
  const bindings = gardenAfternoonBindings(angle),
    def = rt.registry.get('living_intention')!;
  // Validate both fixed authored branches before starting either. Leaf refusals remain bounded intention waits.
  for (const b of Object.values(bindings)) {
    const plan = def.plan(rt, b);
    if (!plan.ok) return plan.diagnostic;
    const busy = def
      .reservations(rt.world, b)
      .find((c) => c.mode === 'exclusive' && rt.holder(c.resource).length);
    if (busy)
      return {
        code: 'garden-afternoon.occupied',
        message: `The afternoon waits for ${busy.resource}.`,
        subjects: [busy.resource],
      };
  }
  const gardener = rt.submit('living_intention', bindings.gardener, {
      preempt: false,
    }),
    reader = rt.submit('living_intention', bindings.reader, { preempt: false });
  rt.services.gardenAfternoon = {
    angle,
    gardener: gardener.id,
    reader: reader.id,
  } satisfies Afternoon;
  return gardener;
}
export function controlGardenAfternoon(
  rt: Runtime,
  branch: GardenAfternoonBranch,
  intent: 'pause' | 'resume' | 'end',
): ActionRecord | Diagnostic {
  const s = state(rt);
  if (!s)
    return {
      code: 'garden-afternoon.not-started',
      message: 'Start the afternoon before controlling a branch.',
      subjects: [],
    };
  return rt.submit('living_intention_control', {
    intention: s[branch],
    intent,
  });
}
