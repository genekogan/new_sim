// Engine Lab presets "2022 east-house: skeleton from piles" (YEAR_BUILD.md, owner feedback §7): the
// year-build phase A scenario (engine/scenarios/year-build.ts) — `mars-2022` published and forked, the
// pile yard, cutting station and a crew of six committed, the skeleton template bound — stepped live by
// SequenceRunner exactly like build-bay (advance() once, then per tick rt.step() → poll() → advance()),
// so the final state is the node rehearsal's. HYPOTHETICAL order, piles and crew.
//   year-build-2022        the first bay (the suite's tranche: 6 frames, 18 beams)
//   year-build-2022-house  the whole house (12 frames, 54 beams) — a lab option: ~2.8× the first bay
// public/engine/campus-2022.json is fetched in prepare(); the setup (publish, assembly graph, BOM, yard,
// sequence, bind) runs in build() and is timed for the HUD. Pure TS (no three.js/DOM).
import { Runtime } from '../../engine/runtime/runtime.ts';
import { SequenceRunner } from '../../engine/sequence/runner.ts';
import { runServices } from '../../engine/rehearsal/rehearse.ts';
import { campusYearUrl, type CampusYearFile } from '../../engine/campus/history.ts';
import { buildingFootprint } from '../../engine/campus/bom.ts';
import { compareToCanonical, yearBuildSetup, type YearBuildSetup } from '../../engine/scenarios/year-build.ts';
import type { SpatialScene } from '../../engine/spatial/types.ts';
import { bindRunner, sequenceOf } from './build-bay.ts';
import type { Check, Scenario } from './scenarios.ts';

export const YEAR_BUILD_YEAR = 2022;
export const YEAR_BUILD_ASSEMBLY = 'east-house';

let file: CampusYearFile | null = null;
let pending: Promise<void> | null = null;
let fetchMs = 0;

/** Fetch campus-2022.json once per page. */
export function prepareYearBuild(): Promise<void> {
  if (file) return Promise.resolve();
  pending ??= (async () => {
    const t0 = performance.now();
    const res = await fetch(campusYearUrl(YEAR_BUILD_YEAR));
    if (!res.ok) throw Error(`campus ${YEAR_BUILD_YEAR}: HTTP ${res.status} for ${res.url}`);
    file = (await res.json()) as CampusYearFile;
    fetchMs = performance.now() - t0;
  })().finally(() => (pending = null));
  return pending;
}

type Info = { setup: YearBuildSetup; bays: number | undefined; setupMs: number; fetchMs: number; centre: [number, number] };
const infos = new WeakMap<Runtime, Info>();
/** The setup behind a year-build runtime (hook / spec: plan steps, targets, unplaced, yard). */
export const yearBuildOf = (rt: Runtime) => infos.get(rt);

function need(): CampusYearFile {
  if (!file) throw Error(`year-build: campus-${YEAR_BUILD_YEAR}.json not loaded yet (await the scenario's prepare(), e.g. LabSim.loadAsync)`);
  return file;
}

/** The last setup built (scene / focus of the preset: the building's footprint centre). */
let last: Info | null = null;

export function yearBuildRuntime(bays: number | undefined): Runtime {
  const t0 = performance.now();
  const setup = yearBuildSetup(YEAR_BUILD_YEAR, YEAR_BUILD_ASSEMBLY, need(), { bays });
  const world = structuredClone(setup.history.read(setup.plan.baselineCheckpoint));
  const rt = new Runtime(world, setup.cfg.registry, runServices(world, setup.cfg), setup.cfg.invariants);
  bindRunner(rt, new SequenceRunner(rt, setup.plan.steps));
  const fp = buildingFootprint(setup.graph.nodes.filter((n) => n.assembly === YEAR_BUILD_ASSEMBLY));
  last = { setup, bays, setupMs: performance.now() - t0, fetchMs, centre: fp.c };
  infos.set(rt, last);
  return rt;
}

/** Blocked waits and refusals so far (runtime action events), grouped by diagnostic code (HUD "refusal / blocked log"). */
export function blockedLog(rt: Runtime): { code: string; n: number; first: string }[] {
  const by = new Map<string, { code: string; n: number; first: string }>();
  for (const e of rt.events) {
    if (e.type !== 'action' || (e.status !== 'blocked' && e.status !== 'failed')) continue;
    const code = `${e.status === 'failed' ? 'FAILED ' : ''}${e.code ?? e.status}`;
    const x = by.get(code);
    if (x) x.n++;
    else by.set(code, { code, n: 1, first: `${(e.tick / 20).toFixed(1)} s ${e.id} ${e.verb}: ${e.message ?? ''}` });
  }
  return [...by.values()].sort((a, b) => b.n - a.n);
}

function preset(name: string, bays: number | undefined, title: string, maxTicks: number): Scenario {
  return {
    name,
    title,
    description:
      `HYPOTHETICAL year build phase A (engine/scenarios/year-build.ts, YEAR_BUILD.md): mars-${YEAR_BUILD_YEAR} forked, the ${YEAR_BUILD_ASSEMBLY} removed, its 16 ft frames and 12 ft beams stacked in a pile yard beside it; a crew of six takes each piece off its stack, carries and raises the frames (held from behind), hangs the low beams from the ground, climbs the bracing to take the middle beams (2.48 m) handed up, and relays the top beams (4.76 m) up through two people lower on the frames. ${bays ? `First ${bays} bay (the suite's tranche).` : 'The whole house (552 steps, ~97 simulated minutes).'} Acceptance: every sequenced frame / beam installed within 1 cm / 1° of the checkpoint.`,
    prepare: prepareYearBuild,
    scene: (): SpatialScene => {
      if (!last) throw Error('year-build: build() first (the scene comes with the setup)');
      return last.setup.scene;
    },
    humans: () => [],
    build: () => yearBuildRuntime(bays),
    start: (rt) => sequenceOf(rt)!.advance(),
    tick: (rt) => {
      const r = sequenceOf(rt)!;
      r.poll();
      r.advance();
    },
    done: (rt) => sequenceOf(rt)!.done,
    maxTicks,
    get focus(): [number, number, number, number] {
      // the building from the south-east, the pile yard (+x side) in view
      return last ? [last.centre[0] + 3, last.centre[1], 16, 35] : [0, 0, 20, 35];
    },
    expect: (rt): Check[] => {
      const r = sequenceOf(rt)!;
      const info = infos.get(rt)!;
      const bad = r.reports.filter((s) => s.status !== 'completed');
      const cmp = compareToCanonical(rt.world, info.setup.build);
      const off = cmp.filter((c) => !c.ok);
      const worst = cmp.reduce((m, c) => Math.max(m, Number.isFinite(c.dist) ? c.dist : 0), 0);
      return [
        { ok: bad.length === 0, message: bad.length ? `${bad.length} steps not completed, first: ${bad[0].id} ${bad[0].status} ${bad[0].diagnostic?.message ?? ''}` : `all ${r.reports.length} sequence steps completed` },
        { ok: rt.violations.length === 0, message: rt.violations.length ? `${rt.violations.length} violations, first: ${rt.violations[0].message}` : 'zero violations' },
        { ok: off.length === 0, message: `${cmp.length - off.length}/${cmp.length} frames + beams installed at the canonical pose (max ${(worst * 1000).toFixed(2)} mm)${off.length ? `; first off: ${off[0].node} ${off[0].phase ?? 'missing'}` : ''}` },
      ];
    },
    hud: (rt) => {
      const info = infos.get(rt);
      if (!info) return [];
      const b = info.setup.build;
      const log = blockedLog(rt);
      return [
        `campus-${YEAR_BUILD_YEAR}.json fetch ${info.fetchMs.toFixed(0)} ms · setup (publish, graph, BOM, yard, sequence, bind) ${info.setupMs.toFixed(0)} ms`,
        `${b.template.steps.length} steps · ${b.targets.length} parts to place · ${b.unplaced.length} unplaced (phase B / outside the tranche) · piles: ${b.entities.filter((e) => e.kind === 'fixture').length}`,
        log.length ? `blocked / refused: ${log.map((l) => `${l.code} ×${l.n}`).join(', ')}` : 'blocked / refused: none so far',
      ];
    },
  };
}

export const yearBuild = preset('year-build-2022', 1, '2022 east-house: skeleton from piles (first bay)', 20 * 60 * 60);
export const yearBuildHouse = preset('year-build-2022-house', undefined, '2022 east-house: skeleton from piles (whole house)', 20 * 60 * 240);
