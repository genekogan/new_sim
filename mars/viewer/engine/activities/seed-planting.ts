import { z } from 'zod';
import type {
  ActionDef,
  Diagnostic,
  Reservation,
  StepResult,
} from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Spatial } from '../spatial/service.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import { DT } from '../runtime/runtime.ts';
import { hashOf } from '../core/hash.ts';
import type { Vec3 } from '../core/math.ts';
import { REACH_TIME } from '../items/actions.ts';
import { bodyFrame, carryHand, lerp3, smooth } from '../items/body.ts';
import {
  BODY_REACH,
  followHand,
  heldBy,
  reachOf,
  reachStation,
  slotOccupant,
  surfaceSlot,
} from '../items/model.ts';
import { gardenTarget } from '../objects/garden.ts';
import {
  plantingIssue,
  plantingState,
  readSeedbed,
  SEED_DEPOSIT,
  SEEDS_PER_PLANTER,
  type PlantingEntity,
} from '../objects/planting.ts';

export interface SeedPlantingParams {
  actor: string;
  plant: string;
  seeds: string;
  returnSlot: string;
  resume?: boolean;
}
type Program = { binding: string; initialFraction: number };
type Exec = Program & {
  id: string;
  p: SeedPlantingParams;
  phase: string;
  child?: string;
  ticks: number;
  from?: Vec3;
  stopping: boolean;
  error?: Diagnostic;
  started: number;
};
const REACH_TICKS = Math.round(REACH_TIME / DT),
  DEPOSIT_TICKS = 20;
const diag = (
  code: string,
  message: string,
  subjects: string[],
): Diagnostic => ({ code: `seed_planting.${code}`, message, subjects });
const plantOf = (rt: Runtime, id: string) =>
  rt.world.entities[id] as PlantingEntity;
const binding = (rt: Runtime, p: SeedPlantingParams) =>
  hashOf({
    plant: {
      pose: rt.world.entities[p.plant]?.pose,
      support: rt.world.entities[p.plant]?.support,
    },
    slot: surfaceSlot(rt.world, p.returnSlot),
  });
function clearHand(rt: Runtime, ex: Exec) {
  const a = rt.world.entities[ex.p.actor];
  if (!a?.human) return;
  if (a.human.activity === 'reach') a.human.activity = 'idle';
  if (a.human.hands) delete a.human.hands.right;
}
function stop(rt: Runtime, ex: Exec, error?: Diagnostic) {
  ex.stopping = true;
  ex.error ??= error;
  if (ex.child && rt.isActive(ex.child)) rt.cancel(ex.child);
}
function dispatch(
  rt: Runtime,
  ex: Exec,
  verb: string,
  params: unknown,
  phase: string,
) {
  const r = rt.submit(verb, params, { parent: ex.id, preempt: false });
  ex.child = r.id;
  ex.phase = phase;
  return r;
}
function point(rt: Runtime, ex: Exec, p: Vec3) {
  const a = rt.world.entities[ex.p.actor],
    w = rt.world.entities[ex.p.seeds];
  a.human!.activity = 'reach';
  a.human!.hands = { ...a.human!.hands, right: p };
  followHand(w, p, a.pose.yaw);
}
function withdrawn(rt: Runtime, ex: Exec) {
  const a = rt.world.entities[ex.p.actor],
    w = rt.world.entities[ex.p.seeds];
  if (w?.support?.kind !== 'in-hand' || w.support.by !== ex.p.actor) {
    clearHand(rt, ex);
    return true;
  }
  ex.from ??= a.human!.hands?.right ?? carryHand(bodyFrame(a), 'right');
  ex.ticks++;
  point(
    rt,
    ex,
    lerp3(
      ex.from,
      carryHand(bodyFrame(a), 'right'),
      smooth(ex.ticks / REACH_TICKS),
    ),
  );
  if (ex.ticks < REACH_TICKS) return false;
  clearHand(rt, ex);
  return true;
}
function returnSeeds(rt: Runtime, ex: Exec): StepResult {
  const w = rt.world.entities[ex.p.seeds];
  if (w?.support?.kind === 'in-hand' && w.support.by === ex.p.actor) {
    const slot = surfaceSlot(rt.world, ex.p.returnSlot);
    if ('code' in slot) return { status: 'blocked', diagnostic: slot };
    const table = rt.world.entities[slot.owner];
    if (
      !table ||
      table.support?.kind !== 'ground' ||
      table.pose.p[1] !== 0 ||
      table.def !== 'table-6ft' ||
      (table.pose.pitch ?? 0) !== 0 ||
      (table.pose.roll ?? 0) !== 0
    )
      return {
        status: 'blocked',
        diagnostic: diag(
          'return-support',
          `${ex.p.returnSlot} must belong to an upright supported ground table before releasing ${ex.p.seeds}`,
          [ex.p.returnSlot, ex.p.seeds],
        ),
      };
    const occupant = slotOccupant(rt.world, slot.owner, slot.slot);
    if (occupant)
      return {
        status: 'blocked',
        diagnostic: diag(
          'return-occupied',
          `${ex.p.seeds} must remain held until ${occupant.id} releases ${ex.p.returnSlot}`,
          [ex.p.seeds, occupant.id, ex.p.returnSlot],
        ),
      };
    const actor = rt.world.entities[ex.p.actor];
    const station = reachStation(rt, actor, slot.p, table, ex.p.returnSlot);
    if ('code' in station) return { status: 'blocked', diagnostic: station };
    const sp = rt.services.spatial as Spatial;
    const route = sp.route(
      rt.world,
      HUMAN_PROFILE,
      { level: 0, p: [actor.pose.p[0], actor.pose.p[2]] },
      { level: 0, p: station.p },
    );
    if (!route.ok)
      return {
        status: 'blocked',
        diagnostic: diag(
          'return-route',
          `${ex.p.seeds} stays held until the route to ${ex.p.returnSlot} is usable: ${route.diagnostic.message}`,
          [ex.p.seeds, ex.p.returnSlot, ...(route.diagnostic.subjects ?? [])],
        ),
      };
    const planned = rt.registry.get('put_item')?.plan(rt, {
      actor: ex.p.actor,
      item: ex.p.seeds,
      surfaceSlot: ex.p.returnSlot,
    });
    if (!planned)
      return {
        status: 'blocked',
        diagnostic: diag(
          'action-missing',
          'Safe seed return requires registered put_item',
          ['put_item', ex.p.seeds],
        ),
      };
    if (!planned.ok)
      return { status: 'blocked', diagnostic: planned.diagnostic };
    const r = dispatch(
      rt,
      ex,
      'put_item',
      { actor: ex.p.actor, item: ex.p.seeds, surfaceSlot: ex.p.returnSlot },
      'putting',
    );
    return r.status === 'failed'
      ? { status: 'blocked', diagnostic: r.diagnostic! }
      : { status: 'running', phase: 'putting' };
  }
  if (
    w?.support?.kind !== 'resting-on' ||
    `${w.support.on}#${w.support.slot}` !== ex.p.returnSlot
  )
    return {
      status: 'blocked',
      diagnostic: diag(
        'return-support',
        `${ex.p.seeds} must be supported on ${ex.p.returnSlot} before ${ex.p.actor} releases care`,
        [ex.p.seeds, ex.p.returnSlot],
      ),
    };
  clearHand(rt, ex);
  return ex.error
    ? { status: 'failed', diagnostic: ex.error }
    : {
        status: 'completed',
        outputs: {
          plant: ex.p.plant,
          partial: !plantOf(rt, ex.p.plant).planting?.completed,
          purpose: plantOf(rt, ex.p.plant).planting?.purpose,
          deposited: plantOf(rt, ex.p.plant).planting?.deposited ?? 0,
          returned: ex.p.seeds,
        },
      };
}

const id = z.string().min(1).max(80);
export const seedPlanting: ActionDef<SeedPlantingParams, Program, Exec> = {
  verb: 'seed_planting',
  description:
    'Carry one finite seed bowl to a grounded planter, deposit conserved seed fractions at its soil target, and return the same bowl; explicit continuation retains its planting purpose, with no refill or growth.',
  schema: z.strictObject({
    actor: id,
    plant: id,
    seeds: id,
    returnSlot: id,
    resume: z.boolean().optional(),
  }),
  drivesReservedHands: (rec) =>
    ['reaching', 'sowing', 'withdrawing'].includes(rec.phase ?? ''),
  reservations(w, p) {
    const owner = p.returnSlot.split('#')[0];
    return [
      `actor:${p.actor}`,
      `hand:${p.actor}:right`,
      `entity:${p.plant}`,
      `entity:${p.seeds}`,
      `entity:${owner}`,
      `surface:${p.returnSlot}`,
    ].map((resource) => ({ resource, mode: 'exclusive' }) as Reservation);
  },
  yieldTo: (_rt, self) => [self.id],
  plan(rt, p) {
    const fail = (code: string, message: string, subjects: string[]) => ({
      ok: false as const,
      diagnostic: diag(code, message, subjects),
    });
    const issue = plantingIssue(rt, p.plant);
    if (issue) return { ok: false, diagnostic: issue };
    const a = rt.world.entities[p.actor],
      w = rt.world.entities[p.seeds],
      plant = plantOf(rt, p.plant),
      s = plant.planting ?? plantingState();
    if (
      new Set([p.actor, p.plant, p.seeds, p.returnSlot.split('#')[0]]).size !==
      4
    )
      return fail(
        'roles',
        'Planting requires distinct actor, planter, seed bowl and return table',
        [p.actor, p.plant, p.seeds],
      );
    if (
      !a?.human ||
      a.human.level !== 0 ||
      a.human.activity !== 'idle' ||
      a.human.grip
    )
      return fail(
        'actor',
        `${p.actor} must stand idle on ground for ${p.plant}`,
        [p.actor, p.plant],
      );
    if (
      heldBy(rt.world, p.actor).some(
        (q) => q.item.id !== p.seeds || q.hand !== 'right',
      )
    )
      return fail(
        'hands',
        `${p.actor} needs free hands or only ${p.seeds} in the right hand`,
        [p.actor, p.seeds],
      );
    if (
      !w ||
      w.def !== 'bowl' ||
      w.contents?.food !== 'seeds' ||
      !Number.isFinite(w.contents.fraction) ||
      w.contents.fraction < SEEDS_PER_PLANTER - s.deposited ||
      w.contents.fraction > 1
    )
      return fail(
        'seeds-unavailable',
        `${p.seeds} needs ${SEEDS_PER_PLANTER - s.deposited} finite seeds for ${p.plant}; no refill is automatic`,
        [p.seeds, p.plant],
      );
    const committed = Object.values(rt.world.entities).find(
      (e) =>
        e.id !== p.plant &&
        (e as PlantingEntity).planting?.purpose &&
        !(e as PlantingEntity).planting?.completed &&
        (e as PlantingEntity).planting?.source === p.seeds,
    );
    if (committed)
      return fail(
        'source-committed',
        `${p.seeds} retains unfinished planting at ${committed.id}; explicitly continue that purpose first`,
        [p.seeds, committed.id, p.plant],
      );
    if (s.purpose && s.source !== p.seeds)
      return fail(
        'source-changed',
        `${p.plant}'s partial purpose uses ${s.source}, not ${p.seeds}`,
        [p.plant, s.source!, p.seeds],
      );
    if (s.completed)
      return fail(
        'already-planted',
        `${p.plant} has completed ${s.purpose}; planting never repeats silently`,
        [p.plant],
      );
    if (
      s.purpose &&
      (!p.resume || s.actor !== p.actor || s.returnSlot !== p.returnSlot)
    )
      return fail(
        'unfinished-purpose',
        `${p.plant} requires explicit continuation by ${s.actor} with ${s.source} and ${s.returnSlot}`,
        [p.plant, p.actor, p.seeds, p.returnSlot],
      );
    if (p.resume && !s.purpose)
      return fail(
        'nothing-to-resume',
        `${p.plant} has no retained planting purpose`,
        [p.plant],
      );
    if (
      s.purpose &&
      (s.binding !== binding(rt, p) ||
        s.initialFraction !== w.contents!.fraction + s.deposited)
    )
      return fail(
        'source-changed',
        `${p.seeds} or ${p.plant}'s original binding changed; conserved continuation cannot reset or refill seeds`,
        [p.plant, p.seeds, p.returnSlot],
      );
    const slot = surfaceSlot(rt.world, p.returnSlot);
    if ('code' in slot) return { ok: false, diagnostic: slot };
    const table = rt.world.entities[slot.owner];
    if (
      table.support?.kind !== 'ground' ||
      table.pose.p[1] !== 0 ||
      table.def !== 'table-6ft' ||
      (table.pose.pitch ?? 0) !== 0 ||
      (table.pose.roll ?? 0) !== 0
    )
      return fail(
        'return-scope',
        `${slot.owner} must be a supported ground table`,
        [slot.owner],
      );
    const occ = Object.values(rt.world.entities).find(
      (e) =>
        e.id !== p.seeds &&
        e.support?.kind === 'resting-on' &&
        e.support.on === slot.owner &&
        e.support.slot === slot.slot,
    );
    if (occ && occ.id !== p.seeds)
      return fail('return-occupied', `${occ.id} occupies ${p.returnSlot}`, [
        occ.id,
        p.returnSlot,
      ]);
    if (
      !(
        w.support?.kind === 'resting-on' &&
        `${w.support.on}#${w.support.slot}` === p.returnSlot &&
        hashOf(w.pose.p) === hashOf(slot.p)
      ) &&
      !(
        w.support?.kind === 'in-hand' &&
        w.support.by === p.actor &&
        w.support.hand === 'right'
      )
    )
      return fail(
        'seed-support',
        `${p.seeds} must rest at ${p.returnSlot} or be held by ${p.actor}`,
        [p.seeds, p.actor, p.returnSlot],
      );
    if (
      !rt.services.spatial ||
      rt.services.spatial.base.links.some((l: { usable: boolean }) => l.usable)
    )
      return fail('scope', `${p.plant} requires a ground-only authored scene`, [
        p.plant,
      ]);
    const station = reachStation(
      rt,
      a,
      gardenTarget(rt, p.plant),
      plant,
      p.plant,
    );
    if ('code' in station) return { ok: false, diagnostic: station };
    for (const verb of ['take_item', 'walk_to', 'put_item'])
      if (!rt.registry.has(verb))
        return fail('action-missing', `Planting requires registered ${verb}`, [
          verb,
          p.seeds,
        ]);
    if (w.support?.kind !== 'in-hand') {
      const take = rt.registry
        .get('take_item')!
        .plan(rt, { actor: p.actor, item: p.seeds, hand: 'right' });
      if (!take.ok) return take;
    }
    const returning = reachStation(rt, a, slot.p, table, p.returnSlot);
    if ('code' in returning) return { ok: false, diagnostic: returning };
    const sp = rt.services.spatial as Spatial;
    for (const [from, to] of [
      [
        { level: 0, p: [a.pose.p[0], a.pose.p[2]] as [number, number] },
        { level: 0, p: returning.p },
      ],
      [
        { level: 0, p: returning.p },
        { level: 0, p: station.p },
      ],
      [
        { level: 0, p: station.p },
        { level: 0, p: returning.p },
      ],
    ]) {
      const route = sp.route(rt.world, HUMAN_PROFILE, from, to);
      if (!route.ok)
        return fail(
          'route',
          `${p.actor} cannot route ${p.seeds} between ${p.returnSlot} and ${p.plant}: ${route.diagnostic.message}`,
          [
            p.actor,
            p.seeds,
            p.returnSlot,
            p.plant,
            ...(route.diagnostic.subjects ?? []),
          ],
        );
    }
    for (const q of seedPlanting.reservations(rt.world, p))
      if (rt.holder(q.resource).length)
        return fail(
          'occupied',
          `${q.resource} is held by ${rt.holder(q.resource).join(', ')}`,
          [q.resource],
        );
    return {
      ok: true,
      program: {
        binding: binding(rt, p),
        initialFraction: s.initialFraction ?? w.contents!.fraction,
      },
    };
  },
  start: (_rt, p, program, id) => ({
    ...program,
    id,
    p,
    phase: 'starting',
    ticks: 0,
    stopping: false,
    started: _rt.tick,
  }),
  step(rt, ex) {
    if (!ex.stopping) {
      const issue = plantingIssue(rt, ex.p.plant);
      if (issue) stop(rt, ex, issue);
      else if (binding(rt, ex.p) !== ex.binding)
        stop(
          rt,
          ex,
          diag(
            'support-changed',
            `${ex.p.plant} or ${ex.p.returnSlot} moved during planting`,
            [ex.p.plant, ex.p.returnSlot],
          ),
        );
      else if (
        rt.world.entities[ex.p.seeds]?.id !== ex.p.seeds ||
        rt.world.entities[ex.p.seeds]?.def !== 'bowl' ||
        rt.world.entities[ex.p.seeds]?.contents?.food !== 'seeds' ||
        rt.world.entities[ex.p.seeds]?.contents?.fraction !==
          ex.initialFraction -
            (plantOf(rt, ex.p.plant).planting?.deposited ?? 0)
      )
        stop(
          rt,
          ex,
          diag(
            'source-changed',
            `${ex.p.seeds} changed during ${ex.id}; committed seed fractions remain`,
            [ex.p.seeds, ex.p.plant],
          ),
        );
      else if (rt.tick - ex.started > 2400)
        stop(
          rt,
          ex,
          diag('timeout', `${ex.p.actor}'s planting exceeded 120 seconds`, [
            ex.p.actor,
            ex.p.plant,
          ]),
        );
    }
    if (ex.child) {
      if (rt.isActive(ex.child))
        return {
          status: 'running',
          phase: ex.stopping ? 'stopping' : ex.phase,
        };
      const child = rt.records.get(ex.child)!;
      ex.child = undefined;
      if (child.status !== 'completed' && !ex.stopping)
        stop(
          rt,
          ex,
          child.diagnostic ??
            diag('child', `${child.verb} stopped before care could continue`, [
              child.id,
            ]),
        );
      if (ex.phase === 'taking' && !ex.stopping) ex.phase = 'approaching';
      else if (ex.phase === 'walking' && !ex.stopping) {
        ex.phase = 'reaching';
        ex.ticks = 0;
        ex.from = carryHand(bodyFrame(rt.world.entities[ex.p.actor]), 'right');
      } else if (ex.phase === 'putting') ex.phase = 'returning';
    }
    if (ex.stopping && ex.phase !== 'withdrawing' && ex.phase !== 'returning') {
      ex.phase = 'withdrawing';
      ex.ticks = 0;
      ex.from = undefined;
    }
    if (ex.phase === 'withdrawing') {
      if (!withdrawn(rt, ex)) return { status: 'running', phase: ex.phase };
      ex.phase = 'returning';
    }
    if (ex.phase === 'returning') return returnSeeds(rt, ex);
    if (ex.phase === 'starting') {
      const plant = plantOf(rt, ex.p.plant);
      plant.planting ??= plantingState();
      const s = plant.planting;
      if (!s.purpose)
        Object.assign(s, {
          purpose: ex.id,
          actor: ex.p.actor,
          source: ex.p.seeds,
          returnSlot: ex.p.returnSlot,
          initialFraction: rt.world.entities[ex.p.seeds].contents!.fraction,
          binding: ex.binding,
        });
      if (rt.world.entities[ex.p.seeds].support?.kind !== 'in-hand')
        dispatch(
          rt,
          ex,
          'take_item',
          { actor: ex.p.actor, item: ex.p.seeds, hand: 'right' },
          'taking',
        );
      else ex.phase = 'approaching';
      return { status: 'running', phase: ex.phase };
    }
    if (ex.phase === 'approaching') {
      const station = reachStation(
        rt,
        rt.world.entities[ex.p.actor],
        gardenTarget(rt, ex.p.plant),
        plantOf(rt, ex.p.plant),
        ex.p.plant,
      );
      if ('code' in station) stop(rt, ex, station);
      else
        dispatch(
          rt,
          ex,
          'walk_to',
          {
            actor: ex.p.actor,
            x: station.p[0],
            z: station.p[1],
            face: station.yaw,
          },
          'walking',
        );
      return { status: 'running', phase: ex.phase };
    }
    const a = rt.world.entities[ex.p.actor],
      w = rt.world.entities[ex.p.seeds],
      target = gardenTarget(rt, ex.p.plant),
      s = plantOf(rt, ex.p.plant).planting!;
    if (
      w.support?.kind !== 'in-hand' ||
      w.support.by !== ex.p.actor ||
      w.support.hand !== 'right' ||
      reachOf(a, target) > BODY_REACH
    ) {
      stop(
        rt,
        ex,
        diag(
          'reach-lost',
          `${ex.p.actor} must hold ${ex.p.seeds} within reach of ${ex.p.plant}`,
          [ex.p.actor, ex.p.seeds, ex.p.plant],
        ),
      );
      return { status: 'running', phase: 'stopping' };
    }
    ex.ticks++;
    if (ex.phase === 'reaching') {
      point(
        rt,
        ex,
        lerp3(
          ex.from!,
          [target[0], target[1] + 0.1, target[2]],
          smooth(ex.ticks / REACH_TICKS),
        ),
      );
      if (ex.ticks === REACH_TICKS) {
        ex.phase = 'sowing';
        ex.ticks = 0;
      }
    } else if (ex.phase === 'sowing') {
      point(rt, ex, [target[0], target[1] + 0.1, target[2]]);
      if (ex.ticks % DEPOSIT_TICKS === 0) {
        if (w.contents!.fraction < SEED_DEPOSIT) {
          stop(
            rt,
            ex,
            diag(
              'seeds-empty',
              `${ex.p.seeds} became empty; ${ex.p.plant}'s committed deposits remain`,
              [ex.p.seeds, ex.p.plant],
            ),
          );
          return { status: 'running', phase: 'stopping' };
        }
        w.contents!.fraction -= SEED_DEPOSIT;
        s.deposited += SEED_DEPOSIT;
        rt.mark('seed_planting.deposit', {
          purpose: s.purpose,
          plant: ex.p.plant,
          seeds: ex.p.seeds,
          quantity: SEED_DEPOSIT,
        });
        if (s.deposited === SEEDS_PER_PLANTER) {
          s.completed = true;
          ex.phase = 'withdrawing';
          ex.ticks = 0;
          ex.from = undefined;
        }
      }
    }
    return { status: 'running', phase: ex.phase };
  },
  cancel(rt, ex) {
    stop(rt, ex);
    return { ok: true, deferred: true };
  },
  resumable:
    'Explicit safely stopped same-source continuation is supported; active reload is outside this bounded example.',
};

export const SEED_PLANTING_ACTIONS: ActionDef[] = [seedPlanting];
export function readSeedPlanting(rt: Runtime, action: string) {
  const rec = rt.records.get(action);
  if (!rec || rec.verb !== 'seed_planting') return;
  const p = rec.params as SeedPlantingParams,
    bowl = rt.world.entities[p.seeds],
    actor = rt.world.entities[p.actor];
  return {
    action,
    status: rec.status,
    phase: rec.phase,
    bindings: structuredClone(p),
    seedbed: readSeedbed(rt, p.plant),
    source: bowl
      ? {
          id: bowl.id,
          pose: structuredClone(bowl.pose),
          support: structuredClone(bowl.support),
          contents: structuredClone(bowl.contents),
        }
      : undefined,
    hand: actor?.human?.hands?.right ? [...actor.human.hands.right] : undefined,
    ...(rec.diagnostic ? { diagnostic: structuredClone(rec.diagnostic) } : {}),
  };
}
