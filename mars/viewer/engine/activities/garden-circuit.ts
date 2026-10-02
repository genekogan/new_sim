// Hypothetical finite circuit. Only registered children manipulate physical objects.
import { z } from 'zod';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { hashOf } from '../core/hash.ts';
import { readGarden } from '../objects/garden.ts';
import {
  heldBy,
  reachStation,
  surfaceSlot,
  slotOccupant,
} from '../items/model.ts';

export interface GardenCircuitParams {
  actor: string;
  water: string;
  source: string;
  returnSlot: string;
  plants: [string, string, string];
}
type Mode =
  | 'running'
  | 'waiting'
  | 'pausing'
  | 'paused'
  | 'ending'
  | 'completed'
  | 'ended';
type Exec = {
  id: string;
  p: GardenCircuitParams;
  mode: Mode;
  index: number;
  child?: string;
  children: string[];
  resources: string[];
  binding: string;
  baseline: number[];
  received: number;
  diagnostic?: Diagnostic;
  finished: boolean;
  returnStopped?: boolean;
};
const store = (rt: Runtime): Record<string, Exec> =>
  (rt.services.gardenCircuits ??= {});
const find = (rt: Runtime, id: string) =>
  (rt.services.gardenCircuits as Record<string, Exec> | undefined)?.[id];
const issue = (
  code: string,
  message: string,
  subjects: string[],
): Diagnostic => ({ code: `garden_circuit.${code}`, message, subjects });
const id = z.string().min(1).max(80);
const schema = z.strictObject({
  actor: id,
  water: id,
  source: id,
  returnSlot: id,
  plants: z.tuple([id, id, id]),
});
const stamp = (rt: Runtime, p: GardenCircuitParams) =>
  hashOf({
    fixtures: [p.source, ...p.plants, p.returnSlot.split('#')[0]].map((id) => ({
      id,
      pose: rt.world.entities[id]?.pose,
      support: rt.world.entities[id]?.support,
    })),
    slot: surfaceSlot(rt.world, p.returnSlot),
  });
function supported(
  rt: Runtime,
  p: GardenCircuitParams,
): Diagnostic | undefined {
  const actor = rt.world.entities[p.actor],
    water = rt.world.entities[p.water],
    source = rt.world.entities[p.source];
  if (
    new Set([
      p.actor,
      p.water,
      p.source,
      ...p.plants,
      p.returnSlot.split('#')[0],
    ]).size !== 7
  )
    return issue(
      'roles',
      'Circuit requires distinct actor, water bowl, source pot, table and three planters',
      [p.actor, p.water, p.source, ...p.plants],
    );
  if (!actor?.human || actor.human.level !== 0)
    return issue('actor', `${p.actor} must be a ground-level human`, [p.actor]);
  for (const plant of p.plants) {
    const s = readGarden(rt, plant);
    if ('code' in s) return s;
  }
  const slot = surfaceSlot(rt.world, p.returnSlot);
  if ('code' in slot) return slot;
  const table = rt.world.entities[slot.owner];
  if (
    table.def !== 'table-6ft' ||
    table.support?.kind !== 'ground' ||
    table.pose.p[1] !== 0
  )
    return issue(
      'return-support',
      `${slot.owner} must be a supported ground table`,
      [slot.owner],
    );
  if (
    !source ||
    source.def !== 'pot' ||
    source.contents?.food !== 'water' ||
    source.support?.kind !== 'resting-on' ||
    source.support.on !== slot.owner
  )
    return issue(
      'source-support',
      `${p.source} must be the actual water pot supported on ${slot.owner}`,
      [p.source, slot.owner],
    );
  const ps = surfaceSlot(
    rt.world,
    `${source.support.on}#${source.support.slot}`,
  );
  if ('code' in ps) return ps;
  if (hashOf(source.pose.p) !== hashOf(ps.p))
    return issue(
      'source-support',
      `${p.source} must remain at its supported slot`,
      [p.source],
    );
  if (
    !water ||
    water.def !== 'bowl' ||
    water.contents?.food !== 'water' ||
    !Number.isFinite(water.contents.fraction) ||
    water.contents.fraction < 0 ||
    water.contents.fraction > 1
  )
    return issue('water', `${p.water} must be the same finite water bowl`, [
      p.water,
    ]);
  if (
    !(
      water.support?.kind === 'resting-on' &&
      `${water.support.on}#${water.support.slot}` === p.returnSlot &&
      hashOf(water.pose.p) === hashOf(slot.p)
    ) &&
    !(
      water.support?.kind === 'in-hand' &&
      water.support.by === p.actor &&
      water.support.hand === 'right'
    )
  )
    return issue(
      'water-support',
      `${p.water} must be at ${p.returnSlot} or held in ${p.actor}'s right hand`,
      [p.water, p.actor],
    );
  const occupied = Object.values(rt.world.entities).find(
    (e) =>
      e.id !== p.water &&
      e.support?.kind === 'resting-on' &&
      `${e.support.on}#${e.support.slot}` === p.returnSlot,
  );
  if (occupied)
    return issue(
      'return-occupied',
      `${occupied.id} must release ${p.returnSlot}`,
      [occupied.id, p.returnSlot],
    );
  if (
    !rt.services.spatial ||
    rt.services.spatial.base.links.some((l: { usable: boolean }) => l.usable)
  )
    return issue(
      'scope',
      'Circuit requires authored flat ground with no usable level links',
      p.plants,
    );
}
function stop(
  rt: Runtime,
  ex: Exec,
  mode: 'pausing' | 'ending',
  diagnostic?: Diagnostic,
) {
  if (ex.mode === 'ending' || ex.mode === 'ended') return;
  const already = ex.mode === 'pausing';
  ex.mode = mode;
  ex.diagnostic = diagnostic;
  if (!already && ex.child && rt.isActive(ex.child)) rt.cancel(ex.child);
}
function blocked(ex: Exec, d: Diagnostic): StepResult {
  ex.mode = 'waiting';
  ex.diagnostic = d;
  return { status: 'blocked', diagnostic: d };
}
function dispatch(
  rt: Runtime,
  ex: Exec,
  verb: string,
  params: unknown,
): StepResult {
  const def = rt.registry.get(verb);
  if (!def)
    return blocked(
      ex,
      issue('action-missing', `${verb} must be registered`, [verb]),
    );
  const plan = def.plan(rt, params);
  if (!plan.ok) return blocked(ex, plan.diagnostic);
  const claims = def.reservations(rt.world, params);
  const occupied = claims.find((q) => rt.holder(q.resource).length);
  if (occupied)
    return blocked(
      ex,
      issue(
        'occupied',
        `${occupied.resource} must be released before ${verb}`,
        [occupied.resource],
      ),
    );
  ex.resources = [
    ...new Set([...ex.resources, ...claims.map((q) => q.resource)]),
  ];
  const r = rt.submit(verb, params, { parent: ex.id, preempt: false });
  ex.children.push(r.id);
  ex.child = r.id;
  if (r.status === 'failed') {
    ex.child = undefined;
    return blocked(ex, r.diagnostic!);
  }
  ex.diagnostic = undefined;
  return { status: 'running', phase: verb };
}
function foreignActor(rt: Runtime, ex: Exec) {
  return rt.holder(`actor:${ex.p.actor}`).some((h) => !ex.children.includes(h));
}
function drain(rt: Runtime, ex: Exec): StepResult {
  if (foreignActor(rt, ex))
    return {
      status: 'blocked',
      diagnostic: issue(
        'actor-directed',
        `${ex.p.actor} must finish the accepted ordinary directive before circuit release/Resume`,
        [ex.p.actor],
      ),
    };
  const water = rt.world.entities[ex.p.water],
    slot = surfaceSlot(rt.world, ex.p.returnSlot);
  if ('code' in slot) return { status: 'blocked', diagnostic: slot };
  if (water?.support?.kind === 'in-hand' && water.support.by === ex.p.actor) {
    if (ex.returnStopped)
      return {
        status: 'blocked',
        diagnostic: issue(
          'return-stopped',
          `The ordinary bowl return stopped; finish any directive, restore ${ex.p.returnSlot}, then explicitly retry ${ex.mode === 'ending' ? 'End' : 'Pause'}. Independent ordinary return also permits release.`,
          [ex.p.actor, ex.p.water, ex.p.returnSlot],
        ),
      };
    const occ = slotOccupant(rt.world, slot.owner, slot.slot);
    if (occ)
      return {
        status: 'blocked',
        diagnostic: issue(
          'return-occupied',
          `${occ.id} must release ${ex.p.returnSlot}; ${ex.p.water} remains actually held`,
          [occ.id, ex.p.returnSlot, ex.p.water],
        ),
      };
    const mode = ex.mode;
    const result = dispatch(rt, ex, 'put_item', {
      actor: ex.p.actor,
      item: ex.p.water,
      surfaceSlot: ex.p.returnSlot,
    });
    ex.mode = mode;
    return result;
  }
  if (
    water?.support?.kind !== 'resting-on' ||
    `${water.support.on}#${water.support.slot}` !== ex.p.returnSlot ||
    hashOf(water.pose.p) !== hashOf(slot.p)
  )
    return {
      status: 'blocked',
      diagnostic: issue(
        'return-support',
        `${ex.p.water} must physically return to ${ex.p.returnSlot}`,
        [ex.p.water, ex.p.returnSlot],
      ),
    };
  if (heldBy(rt.world, ex.p.actor).length)
    return {
      status: 'blocked',
      diagnostic: issue(
        'hands',
        `${ex.p.actor} has other held items; return them ordinarily before circuit release`,
        [ex.p.actor],
      ),
    };
  ex.diagnostic = undefined;
  if (ex.mode === 'ending') {
    ex.mode = 'ended';
    return { status: 'completed', outputs: { ended: true, cycles: ex.index } };
  }
  ex.mode = 'paused';
  return { status: 'running', phase: 'paused' };
}
export const gardenCircuit: ActionDef<
  GardenCircuitParams,
  { binding: string; baseline: number[]; received: number },
  Exec
> = {
  verb: 'garden_circuit',
  description:
    'Finite hypothetical water-pot resupply and six ordinary care cycles; deterministic due waits, safe explicit continuation.',
  schema,
  drivesReservedHands: false,
  reservations: (_w, p) => [
    { resource: `garden-circuit:${p.water}`, mode: 'exclusive' },
  ],
  plan(rt, p) {
    const d = supported(rt, p);
    if (d) return { ok: false, diagnostic: d };
    const source = rt.world.entities[p.source],
      water = rt.world.entities[p.water];
    if (source.contents!.fraction !== 0.5 || water.contents!.fraction !== 0)
      return {
        ok: false,
        diagnostic: issue(
          'initial-material',
          `${p.source} requires .5 pot and ${p.water} must start empty; unfinished circuits resume their existing parent`,
          [p.source, p.water],
        ),
      };
    if (rt.holder(`garden-circuit:${p.water}`).length)
      return {
        ok: false,
        diagnostic: issue(
          'occupied',
          `${p.water} already belongs to an active circuit`,
          [p.water],
        ),
      };
    if (
      heldBy(rt.world, p.actor).length ||
      rt.world.entities[p.actor].human!.activity !== 'idle'
    )
      return {
        ok: false,
        diagnostic: issue(
          'actor-busy',
          `${p.actor} must start idle with free hands`,
          [p.actor],
        ),
      };
    const gardens = p.plants.map((q) => readGarden(rt, q));
    if (gardens.some((s) => 'code' in s || s.pending))
      return {
        ok: false,
        diagnostic: issue(
          'unfinished-care',
          'Finish existing planter care before starting this circuit',
          p.plants,
        ),
      };
    return {
      ok: true,
      program: {
        binding: stamp(rt, p),
        baseline: gardens.map((s) => ('code' in s ? 0 : s.cycles)),
        received: gardens.reduce(
          (n, s) => n + ('code' in s ? 0 : s.waterReceived),
          0,
        ),
      },
    };
  },
  start(rt, p, program, id) {
    const ex: Exec = {
      ...program,
      id,
      p: structuredClone(p),
      mode: 'running',
      index: 0,
      children: [],
      resources: [
        `garden-circuit:${p.water}`,
        `actor:${p.actor}`,
        `hand:${p.actor}:left`,
        `hand:${p.actor}:right`,
        `holds:${p.actor}`,
      ],
      finished: false,
    };
    store(rt)[id] = ex;
    return ex;
  },
  onDirective(rt, ex, by, claims, ancestors) {
    if (
      !ancestors.includes(ex.id) &&
      by.verb !== 'garden_circuit_control' &&
      claims.some((c) => c.resource === `actor:${ex.p.actor}`) &&
      !['ending', 'ended', 'completed'].includes(ex.mode)
    )
      stop(
        rt,
        ex,
        'pausing',
        issue(
          'directed',
          `${by.id} directs ${ex.p.actor}; explicit Resume retains the same bowl and partial care`,
          [by.id, ex.p.actor],
        ),
      );
  },
  step(rt, ex) {
    if (ex.child) {
      if (rt.isActive(ex.child))
        return {
          status: 'running',
          phase:
            ex.mode === 'pausing' || ex.mode === 'ending'
              ? ex.mode
              : rt.records.get(ex.child)?.verb,
        };
      const r = rt.records.get(ex.child)!;
      ex.child = undefined;
      if (
        r.verb === 'put_item' &&
        r.status !== 'completed' &&
        ['pausing', 'ending'].includes(ex.mode)
      )
        ex.returnStopped = true;
      if (r.status !== 'completed' && !['pausing', 'ending'].includes(ex.mode))
        return blocked(
          ex,
          r.diagnostic ??
            issue(
              'child-stopped',
              `${r.id} stopped; explicit Resume retries actual remaining work`,
              [r.id],
            ),
        );
    }
    // A final deposit can commit before a cancelled withdrawal: account actual cycles once.
    while (ex.index < 6) {
      const i = Math.floor(ex.index / 2),
        s = readGarden(rt, ex.p.plants[i]);
      if ('code' in s || s.cycles !== ex.baseline[i] + (ex.index % 2) + 1)
        break;
      ex.index++;
    }
    if (ex.mode === 'pausing' || ex.mode === 'ending') return drain(rt, ex);
    if (ex.mode === 'paused') return { status: 'running', phase: 'paused' };
    if (ex.mode === 'waiting')
      return { status: 'blocked', diagnostic: ex.diagnostic! };
    const d = supported(rt, ex.p);
    if (d) return blocked(ex, d);
    if (stamp(rt, ex.p) !== ex.binding)
      return blocked(
        ex,
        issue(
          'binding-changed',
          'Restore the original supported source/table/planter binding before explicit Resume',
          [ex.p.source, ...ex.p.plants, ex.p.returnSlot],
        ),
      );
    const water = rt.world.entities[ex.p.water],
      source = rt.world.entities[ex.p.source];
    const gardens = ex.p.plants.map((p) => readGarden(rt, p));
    const quantity =
      4 * source.contents!.fraction +
      water.contents!.fraction +
      gardens.reduce((n, s) => n + ('code' in s ? 0 : s.waterReceived), 0) -
      ex.received;
    if (quantity !== 2)
      return blocked(
        ex,
        issue(
          'material-changed',
          'Actual pot/bowl/planter quantities must retain the original finite two bowl-unit supply',
          [ex.p.source, ex.p.water, ...ex.p.plants],
        ),
      );
    if (ex.index === 6) {
      // Completed deposits are not a physical-release certificate.
      if (foreignActor(rt, ex))
        return blocked(
          ex,
          issue(
            'actor-directed',
            `${ex.p.actor} must finish the ordinary directive before circuit completion`,
            [ex.p.actor],
          ),
        );
      if (water.support?.kind === 'in-hand')
        return dispatch(rt, ex, 'put_item', {
          actor: ex.p.actor,
          item: ex.p.water,
          surfaceSlot: ex.p.returnSlot,
        });
      if (
        water.support?.kind !== 'resting-on' ||
        `${water.support.on}#${water.support.slot}` !== ex.p.returnSlot ||
        heldBy(rt.world, ex.p.actor).length
      )
        return blocked(
          ex,
          issue(
            'completion-release',
            `${ex.p.water} must physically rest at ${ex.p.returnSlot} with ${ex.p.actor}'s hands free before completion`,
            [ex.p.water, ex.p.returnSlot, ex.p.actor],
          ),
        );
      ex.finished = true;
      ex.mode = 'completed';
      return {
        status: 'completed',
        outputs: {
          cycles: 6,
          water: water.contents!.fraction,
          source: source.contents!.fraction,
        },
      };
    }
    const plant = ex.p.plants[Math.floor(ex.index / 2)],
      s = readGarden(rt, plant);
    if ('code' in s) return blocked(ex, s);
    if (!s.due)
      return {
        status: 'blocked',
        diagnostic: issue(
          'not-due',
          `${plant} becomes due in ${s.remainingTicks} ordinary ticks; world must keep running`,
          [plant],
        ),
      };
    if (water.contents!.fraction === 0) {
      if (source.contents!.fraction < 0.25)
        return blocked(
          ex,
          issue(
            'source-exhausted',
            `${ex.p.source} cannot fill ${ex.p.water}; finite contents are preserved`,
            [ex.p.source, ex.p.water],
          ),
        );
      if (water.support?.kind !== 'in-hand')
        return dispatch(rt, ex, 'take_item', {
          actor: ex.p.actor,
          item: ex.p.water,
          hand: 'right',
        });
      const st = reachStation(
        rt,
        rt.world.entities[ex.p.actor],
        source.pose.p,
        rt.world.entities[ex.p.returnSlot.split('#')[0]],
        ex.p.source,
      );
      if ('code' in st) return blocked(ex, st);
      const def = rt.registry.get('serve');
      if (!def)
        return blocked(
          ex,
          issue(
            'action-missing',
            'serve must be registered before the same empty water bowl can be filled',
            ['serve', ex.p.source, ex.p.water],
          ),
        );
      const params = { actor: ex.p.actor, pot: ex.p.source, bowl: ex.p.water };
      const plan = def.plan(rt, params);
      if (!plan.ok && plan.diagnostic.code === 'item.out-of-reach')
        return dispatch(rt, ex, 'walk_to', {
          actor: ex.p.actor,
          x: st.p[0],
          z: st.p[1],
          face: st.yaw,
        });
      return dispatch(rt, ex, 'serve', params);
    }
    return dispatch(rt, ex, 'garden_care', {
      actor: ex.p.actor,
      plant,
      water: ex.p.water,
      returnSlot: ex.p.returnSlot,
    });
  },
  cancel(rt, ex) {
    stop(rt, ex, 'ending');
    return { ok: true, deferred: true };
  },
  resumable:
    'Same-runtime explicit continuation only; active coordinator reload is outside this bounded example.',
};
export const gardenCircuitControl: ActionDef<
  { circuit: string; intent: 'pause' | 'resume' | 'end' },
  null,
  null
> = {
  verb: 'garden_circuit_control',
  description:
    'Explicit safe Pause/Resume/End of retained finite garden circuit.',
  schema: z.strictObject({
    circuit: id,
    intent: z.enum(['pause', 'resume', 'end']),
  }),
  drivesReservedHands: false,
  reservations: () => [],
  plan(rt, p) {
    const ex = find(rt, p.circuit);
    if (!ex || !rt.isActive(p.circuit))
      return {
        ok: false,
        diagnostic: issue('inactive', `${p.circuit} is not an active circuit`, [
          p.circuit,
        ]),
      };
    if (
      p.intent === 'resume' &&
      (!['paused', 'waiting'].includes(ex.mode) ||
        ex.child ||
        foreignActor(rt, ex))
    )
      return {
        ok: false,
        diagnostic: issue(
          'resume-busy',
          `${p.circuit} must finish safe release and accepted directives before explicit Resume`,
          [p.circuit, ex.p.actor],
        ),
      };
    return { ok: true, program: null };
  },
  start(rt, p) {
    const ex = find(rt, p.circuit)!;
    if (p.intent === 'resume') {
      ex.mode = 'running';
      ex.diagnostic = undefined;
    } else {
      if (!ex.child || !rt.isActive(ex.child)) ex.returnStopped = false;
      stop(rt, ex, p.intent === 'end' ? 'ending' : 'pausing');
    }
    return null;
  },
  step: () => ({ status: 'completed' }),
  cancel: () => ({ ok: true }),
  resumable: true,
};
export const GARDEN_CIRCUIT_ACTIONS: ActionDef[] = [
  gardenCircuit,
  gardenCircuitControl,
];
export function readGardenCircuit(rt: Runtime, circuit: string) {
  const ex = find(rt, circuit),
    rec = rt.records.get(circuit);
  if (!ex || !rec) return;
  return structuredClone({
    circuit,
    status: rec.status,
    mode: ex.mode,
    index: ex.index,
    nextPlant: ex.index < 6 ? ex.p.plants[Math.floor(ex.index / 2)] : undefined,
    history: ex.children.map((id) => rt.records.get(id)),
    finished: ex.finished,
    bindings: ex.p,
    current: ex.child ? rt.records.get(ex.child) : undefined,
    ownedActions: ex.children,
    plants: ex.p.plants.map((p) => readGarden(rt, p)),
    source: rt.world.entities[ex.p.source],
    water: rt.world.entities[ex.p.water],
    held: heldBy(rt.world, ex.p.actor).map((q) => ({
      item: q.item.id,
      hand: q.hand,
    })),
    claims: ex.resources.map((resource) => ({
      resource,
      holders: rt.holder(resource),
    })),
    returnRetryRequired: !!ex.returnStopped,
    diagnostic: ex.diagnostic ?? rec.diagnostic,
  });
}
