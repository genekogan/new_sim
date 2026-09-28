#!/usr/bin/env node
// Record an engine build as a replayable take plus an engine-planned camera track, for the studio's
// "Replay take" mode.
//   node deploy/record-campus-take.mjs                                # the flagship (default)
//   node deploy/record-campus-take.mjs --scenario build-bay-v3        # flagship v3 on the same campus site
//   node deploy/record-campus-take.mjs --scenario year-build-2022     # 2022 east-house, first bay (year scene)
//   node deploy/record-campus-take.mjs --all                          # every scenario, in manifest order
//   node deploy/record-campus-take.mjs --scenario year-build-2022-house  # 2022 east-house, whole skeleton (opt-in)
//   ... --all --full                                                  # --all plus the opt-in whole-house take(s)
//   node deploy/record-campus-take.mjs --scenario year-build-2022-ab  # 2022 east-house A+B (explicit only; over budget)
//   ... --check                                                       # re-record and compare with the manifest (no writes)
// Writes public/engine/takes/<file> and merges the scenario's entry into public/engine/takes/manifest.json.
// `takes` lists what the 2026 studio can replay (flagship first: the studio e2e uses takes[0]); takes recorded
// in another year's frame go to `otherYears` — the studio (app/studio/take-panel.tsx) lists every `takes` entry
// on the 2026 scene and does not filter by `year`, so a 2022 take there would be drawn on the wrong campus.
//
// flagship: same recipe as engine/test/campus-flagship.test.ts — fork canonical Mars 2026, stage the build-bay
//   inventory + crew at the centre of `staging-east`, rehearse the 43-step plan (TakeRecorder inside runPlan).
// build-bay-v3: engine/scenarios/build-bay-v3.ts (deck handed up to people on the beams, s2 off the forklift,
//   stair, campfire) at the same site and crop. build-bay-v3.test.ts pins v3 on OPEN GROUND at the origin; this
//   campus placement is its own run (own hash), checked here for completion and 0 violations only (v3 is
//   origin-independent since W27: the test also runs it at staging-east's origin on open ground).
// year-build-2022: engine/scenarios/year-build.ts phase A, first bay (the suite's tranche; year-build.test.ts
//   PIN_BAY1) on the 2022 year scene cropped round the house, ground at the Kit datum y = 0.
// All HYPOTHETICAL: engine demonstrations, not documented historical builds (spec §4).
import { gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashOf } from '../engine/core/hash.ts';
import { WorldHistory } from '../engine/history/store.ts';
import { Spatial, entityFootprint } from '../engine/spatial/service.ts';
import { bindTemplate } from '../engine/sequence/bind.ts';
import { rehearse } from '../engine/rehearsal/rehearse.ts';
import { blockedWaits, expandEvents, replayFinalState, sampleTake, takeDuration } from '../engine/take/replay.ts';
import { datan2, dcos, dsin } from '../engine/core/math.ts';
import { TakeLibrary } from '../engine/take/store.ts';
import { readCampus2026File } from '../engine/campus/node.ts';
import { loadCampusFile } from '../engine/campus/history-node.ts';
import { buildingFootprint } from '../engine/campus/bom.ts';
import { cropScene } from '../engine/campus/load.ts';
import { CAMPUS_ID, loadCampus2026 } from '../engine/campus/world.ts';
import { RULES_VERSION } from '../engine/construction/rules.ts';
import { DEFAULT_CAMERA_POLICY } from '../engine/camera/geom.ts';
import { planShotList } from '../engine/camera/shotlist.ts';
import { takeSampler } from '../engine/camera/take-sampler.ts';
import { fileCameras, toCameraTrack } from '../engine/camera/track.ts';
import { buildBayEntities, buildBayTemplate, buildBayBindings, buildBayRegistry, BUILD_BAY_INVARIANTS, BUILD_BAY_CONTRIBUTORS } from '../engine/scenarios/build-bay.ts';
import { buildBayV3Entities, buildBayV3Regions, buildBayV3Template, buildBayV3Bindings, buildBayV3Registry, BUILD_BAY_V3_INVARIANTS, BUILD_BAY_V3_CONTRIBUTORS } from '../engine/scenarios/build-bay-v3.ts';
import { yearBuildSetup } from '../engine/scenarios/year-build.ts';
import { chapterContinuity, rehearseChapters, sectionBounds } from '../engine/take/chapters.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public/engine/takes');
const MANIFEST = join(OUT_DIR, 'manifest.json');
// The studio's replay bar (app/studio/take-panel.tsx, .take-panel in studio.css: 36 px inset + ~90 px panel)
// covers the bottom ~130 px of an 800 px viewport; subject framing keeps important points above it.
// Coupling: restyling that bar means re-planning with a matching fraction (the track stores it as data.safeArea).
const SAFE_BOTTOM = 0.17;
const MB = 1024 * 1024;
const NE = -Math.PI / 4, SE = Math.PI / 4, SW = (3 * Math.PI) / 4, DEG = Math.PI / 180;
const argOf = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const check = process.argv.includes('--check');

/** Step timeline (seconds) from the take's own lifecycle events; `T(id, 'start'|'end')`. */
function timeline(take, plan) {
  const steps = [];
  const byId = new Map();
  for (const e of expandEvents(take.events)) { // mars-take/4 folds same-tick lifecycles: expand them back
    if (e.type !== 'action' || !e.id.startsWith('step:')) continue;
    const id = e.id.slice(5);
    let s = byId.get(id);
    if (!s) byId.set(id, (s = { id, verb: e.verb, start: null, end: null }));
    if (e.status === 'executing' && s.start === null) s.start = e.t * take.dt;
    if (['completed', 'failed', 'cancelled'].includes(e.status)) { s.end = e.t * take.dt; s.status = e.status; }
  }
  for (const s of byId.values()) steps.push(s);
  const labels = Object.fromEntries(plan.steps.map((s) => [s.id, s.label]));
  for (const s of steps) if (labels[s.id]) s.label = labels[s.id];
  const T = (id, k) => {
    const s = byId.get(id);
    if (!s || s[k] === null) throw new Error(`step ${id} has no ${k} time`);
    return s[k];
  };
  return { steps, byId, T };
}

function mustBeClean(reh, what) {
  if (reh.report.status !== 'completed' || reh.report.violations.length) {
    const bad = reh.report.steps.filter((s) => s.status !== 'completed').slice(0, 3);
    throw new Error(`${what} rehearsal did not complete cleanly: ${reh.report.status}, ${reh.report.violations.length} violations ${JSON.stringify(bad).slice(0, 400)}`);
  }
}

/** Installed parts of the final state as collision-only solids for the camera planner. */
const buildSolids = (final) => Object.values(final.entities)
  .filter((e) => e.kind === 'component' && e.phase === 'installed')
  .map((e) => ({ id: `take:${e.id}`, kind: 'component', label: `hypothetical ${e.def} ${e.id}`, ...entityFootprint(e) }));

/** Build site at the centre of the 2026 `staging-east` clearing, and the 80 m crop the runs use. */
function stagingEast() {
  const file = readCampus2026File();
  const { base, world } = loadCampus2026(file, { flagshipInventory: false });
  const st = world.regions['staging-east'];
  if (!st) throw new Error('campus scene has no staging-east region');
  const xs = st.polygon.map((p) => p[0]), zs = st.polygon.map((p) => p[1]);
  const site = { origin: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2], yaw: 0, groundY: base.meta.groundY };
  const local = cropScene(base, [site.origin[0] - 40, site.origin[1] - 40, site.origin[0] + 40, site.origin[1] + 40]);
  return { file, base, world, site, local };
}

const SCENARIOS = {
  flagship: {
    file: 'flagship-campus-2026.json',
    list: 'takes',
    year: 2026,
    label: 'Flagship rack bay at staging-east (HYPOTHETICAL build scenario — not historical)',
    note: 'Engine demonstration on a fork of canonical Mars 2026 (workspace mars-2026 untouched). Build site = centre of the algorithmic staging-east clearing east of Chiba; people are generic, not attendees.',
    // 2 MB raw (was 1.5): the camera track stores its scored subject ids + points per sample (~1.2 MB, gzips well)
    limit: 2 * MB,
    hz: 10,
    run() {
      // identical recipe to the campus flagship test
      const { file, world, site, local } = stagingEast();
      const h = new WorldHistory(`mars-campus-flagship/1+${RULES_VERSION}`);
      h.publishCanonical(CAMPUS_ID, 'Mars 2026 (canonical)', world, 'record-campus-take');
      h.fork(CAMPUS_ID, 'build', 'flagship build (hypothetical)');
      const w = h.read('build');
      for (const e of buildBayEntities(site)) w.entities[e.id] = e;
      h.commit('build', w, { kind: 'design-edit', note: 'flagship piles + crew at staging-east (hypothetical)' });
      const registry = buildBayRegistry();
      const plan = bindTemplate(buildBayTemplate(site), buildBayBindings, { history: h, baseline: 'build', registry });
      const cfg = {
        registry,
        invariants: BUILD_BAY_INVARIANTS,
        services: () => ({ spatial: new Spatial(local, { contributors: BUILD_BAY_CONTRIBUTORS, baseId: file.contentHash }) }),
      };
      const reh = rehearse(h, 'build', plan, cfg);
      mustBeClean(reh, 'flagship');
      return { reh, exact: () => rehearse(h, 'build', plan, { ...cfg, trackTol: 1 }).take, plan, site, scene: local, campus: CAMPUS_ID };
    },
    shots({ site, final, T, duration }) {
      const bay = [site.origin[0], site.groundY, (final.entities.A.pose.p[2] + final.entities.B.pose.p[2]) / 2];
      const b1x = final.entities.b1.pose.p[0];
      const outsideB1 = b1x < bay[0] ? Math.PI : 0; // look at the first seated beam from outside its column
      return [
        { label: 'establishing wide from the north-east', t1: 10,
          spec: { kind: 'establishing', region: { min: [site.origin[0] - 13, site.origin[1] - 9], max: [site.origin[0] + 8, site.origin[1] + 8], y: site.groundY }, azimuth: NE, elevation: 28 * DEG } },
        { label: 'follow the first upright carry', t1: T('carryA', 'end'),
          spec: { kind: 'follow', subject: 'p1', offset: [4, 4.2, 6], frame: 'world', lookHeight: 0.9, damping: 1.0, subjects: ['p1', 'p2', 'A'] } },
        { label: 'beams carried to the bay', t1: T('raiseA', 'start'),
          spec: { kind: 'frameGroup', subjects: ['p5', 'p6'], padding: 2.5, azimuth: NE, elevation: 24 * DEG } },
        { label: 'orbit the raise', t1: T('raiseB', 'end') + 2,
          // subjects: the upright being raised + its raise crew (a lying frame is sized by its extent now). p3/p4 fetch B
          // from the pile 12 m west during this window, so requiring them would pull the orbit out until everyone is tiny.
          spec: { kind: 'orbit', center: bay, radius: 10, height: 4, period: 90, phase: NE, lookHeight: 1.5, subjects: ['A', 'p1', 'p2'] } },
        { label: 'close-up: first beam seating, from outside the bay', t1: T('seat_b1', 'end'),
          spec: { kind: 'frameGroup', subjects: ['b1', 'p5', 'p6'], padding: 0.4, azimuth: outsideB1, elevation: 14 * DEG } },
        { label: 'beams, release and joist carries', t1: T('fix_j1', 'start'),
          spec: { kind: 'orbit', center: bay, radius: 13, height: 6, period: 160, phase: outsideB1 + Math.PI / 2, lookHeight: 1.5, subjects: ['A', 'B'] } },
        { label: 'joists fixed on the upper beams', t1: T('deck_s1', 'start'),
          spec: { kind: 'frameGroup', subjects: ['p5', 'A', 'B'], padding: 1.5, azimuth: SE, elevation: 30 * DEG } },
        { label: 'wide on the deck', t1: T('deck_s2', 'end') + 2,
          spec: { kind: 'frameGroup', subjects: ['s1', 's2', 'p3', 'p4'], padding: 2, azimuth: NE, elevation: 35 * DEG } },
        { label: 'stair flight and treads', t1: T('visit', 'start'),
          spec: { kind: 'frameGroup', subjects: ['st', 'p1', 'p2', 'p6'], padding: 1.5, azimuth: SE, elevation: 24 * DEG } },
        { label: 'follow the visitor up the stair', t1: duration,
          spec: { kind: 'follow', subject: 'visitor', offset: [-3.4, 2.1, 1.9], lookHeight: 1.2, damping: 0.7, subjects: ['visitor'] } },
      ];
    },
    moments: ({ T, g, duration }) => ({
      carry: g(T('carryA', 'start') + (T('carryA', 'end') - T('carryA', 'start')) / 2),
      held: g(T('raiseB', 'end') + 1),
      deck: g(T('deck_s2', 'end') + 1.5),
      visitor: Math.floor(duration * 10) / 10, // last grid point inside the take (the scrubber max is the duration)
    }),
  },

  'build-bay-v3': {
    file: 'build-bay-v3-campus-2026.json',
    list: 'takes',
    year: 2026,
    label: 'Flagship v3: hand-up + forklift deck, at staging-east (HYPOTHETICAL build scenario — not historical)',
    note: 'Engine demonstration (flagship v3: joists and s1 handed up to two people on the beams, s2 taken off the forklift forks, stair, spare tread, campfire) on a fork of canonical Mars 2026 at the centre of the algorithmic staging-east clearing. The v3 pin (build-bay-v3.test.ts) is on open ground; this campus placement is its own run. People are generic, not attendees.',
    limit: 3 * MB,
    hz: 10,
    run() {
      const { file, world, site, local } = stagingEast();
      const h = new WorldHistory(`mars-campus-v3/1+${RULES_VERSION}`);
      h.publishCanonical(CAMPUS_ID, 'Mars 2026 (canonical)', world, 'record-campus-take');
      h.fork(CAMPUS_ID, 'build', 'flagship v3 build (hypothetical)');
      const w = h.read('build');
      for (const e of buildBayV3Entities(site)) w.entities[e.id] = e;
      for (const r of buildBayV3Regions(site)) w.regions[r.id] = r;
      h.commit('build', w, { kind: 'design-edit', note: 'flagship v3 piles, forklift, campfire + people at staging-east (hypothetical)' });
      const registry = buildBayV3Registry();
      const plan = bindTemplate(buildBayV3Template(site), buildBayV3Bindings, { history: h, baseline: 'build', registry });
      const cfg = {
        registry,
        invariants: BUILD_BAY_V3_INVARIANTS,
        services: () => ({ spatial: new Spatial(local, { contributors: BUILD_BAY_V3_CONTRIBUTORS, baseId: file.contentHash }) }),
      };
      const reh = rehearse(h, 'build', plan, cfg);
      mustBeClean(reh, 'flagship v3');
      return { reh, exact: () => rehearse(h, 'build', plan, { ...cfg, trackTol: 1 }).take, plan, site, scene: local, campus: CAMPUS_ID };
    },
    shots({ site, final, initial, T, duration }) {
      const bay = [site.origin[0], site.groundY, (final.entities.A.pose.p[2] + final.entities.B.pose.p[2]) / 2];
      const box = boundsOf(initial, 2);
      return [
        { label: 'establishing wide from the north-east', t1: 10,
          spec: { kind: 'establishing', region: { ...box, y: site.groundY }, azimuth: NE, elevation: 30 * DEG } },
        { label: 'follow the first frame carry', t1: T('carryA', 'end'),
          spec: { kind: 'follow', subject: 'p1', offset: [4, 4.2, 6], frame: 'world', lookHeight: 0.9, damping: 1.0, subjects: ['p1', 'p2', 'A'] } },
        { label: 'orbit the raise', t1: T('raiseB', 'end') + 2,
          spec: { kind: 'orbit', center: bay, radius: 10, height: 4, period: 90, phase: NE, lookHeight: 1.5, subjects: ['A', 'p1', 'p2'] } },
        { label: 's1 handed up to the two on the beams', t1: T('deck_s1', 'end'),
          spec: { kind: 'frameGroup', subjects: ['s1', 'p5', 'p6'], padding: 1.5, azimuth: SE, elevation: 22 * DEG } },
        { label: 'forklift presents s2 at deck height', t1: T('deck_s2', 'end') + 2,
          spec: { kind: 'frameGroup', subjects: ['fk', 's2', 'p5', 'p6'], padding: 1.5, azimuth: NE, elevation: 28 * DEG } },
        { label: 'stair flight and treads', t1: T('visit', 'start'),
          spec: { kind: 'frameGroup', subjects: ['st', 'p1', 'p2'], padding: 1.5, azimuth: SE, elevation: 24 * DEG } },
        { label: 'follow the visitor up the stair', t1: T('visit', 'end'),
          spec: { kind: 'follow', subject: 'visitor', offset: [-3.4, 2.1, 1.9], lookHeight: 1.2, damping: 0.7, subjects: ['visitor'] } },
        { label: 'campfire', t1: duration,
          spec: { kind: 'establishing', region: { ...box, y: site.groundY }, azimuth: SW, elevation: 32 * DEG } },
      ];
    },
    moments: ({ T, g, duration }) => ({
      carry: g(T('carryA', 'start') + (T('carryA', 'end') - T('carryA', 'start')) / 2),
      held: g(T('raiseB', 'end') + 1),
      handup: g(T('up_s1', 'start') + (T('up_s1', 'end') - T('up_s1', 'start')) / 2),
      deck: g(T('deck_s2', 'end') + 1.5),
      visitor: g(T('visit', 'end')),
      campfire: Math.floor(duration * 10) / 10,
    }),
  },

  'year-build-2022': {
    file: 'year-build-2022-east-house-bay1.json',
    list: 'otherYears',
    kind: 'year-build',
    year: 2022,
    label: '2022 east-house skeleton, first bay, from the piles (HYPOTHETICAL build scenario — not historical)',
    note: 'Year build phase A (YEAR_BUILD.md): a fork of protected mars-2022, the east-house removed and rebuilt from a hypothetical pile yard by a generic crew of six; first bay = the suite tranche (6 frames, 18 beams), every part checked against the checkpoint pose. Coordinates are the 2022 year frame with ground at the Kit datum y = 0 (the year files draw ground at -0.16 m). Order, piles and crew are hypothetical.',
    limit: 3 * MB,
    // a 34 min take: 0.5 Hz keeps the planned camera ~1/20 of 10 Hz (~300 B/sample: scored subject points) — fine for
    // these slow orbits / wides (<= 4° of orbit per sample), wrong for follows. The take itself is ~2.4 MB, ~0.9 MB of
    // it mars-take/2 `hands` changes (hand points while hanging beams: a recorder thinning question, not the camera's)
    hz: 0.5,
    pin: { ticks: 41317, finalStateHash: '251a44c5422990d351698865a9ab4fa53db784cf85004d71275a79eea314c96f' }, // year-build.test.ts PIN_BAY1
    run() {
      const s = yearBuildSetup(2022, 'east-house', loadCampusFile(2022), { bays: 1 });
      const reh = rehearse(s.history, s.workspace, s.plan, s.cfg);
      mustBeClean(reh, 'year build 2022 bay 1');
      const fp = buildingFootprint(s.graph.nodes.filter((n) => n.assembly === 'east-house'));
      const site = { origin: fp.c, yaw: fp.yaw ?? 0, groundY: s.build.groundY, half: fp.half };
      return { reh, exact: () => rehearse(s.history, s.workspace, s.plan, { ...s.cfg, trackTol: 1 }).take, plan: s.plan, site, scene: s.scene, campus: 'mars-2022', crew: s.build.bindings.crew };
    },
    shots({ site, initial, plan, T, duration, crew }) {
      const c = [site.origin[0], site.groundY, site.origin[1]];
      const box = boundsOf(initial, 2);
      const r = Math.hypot(...(site.half ?? [6, 6]));
      const first = (verb) => plan.steps.find((s) => s.verb === verb)?.id;
      const raise1 = first('raise_upright'), hang1 = first('hang_beam');
      const upright1 = plan.steps.find((s) => s.id === raise1)?.params?.upright ?? plan.steps.find((s) => s.id === raise1)?.params?.entity;
      return [
        { label: 'establishing: yard and site from the south-east', t1: 15,
          spec: { kind: 'establishing', region: { ...box, y: site.groundY }, azimuth: SE, elevation: 32 * DEG } },
        { label: 'orbit while the crew carries the first frame', t1: T(raise1, 'start'),
          spec: { kind: 'orbit', center: c, radius: r + 10, height: 7, period: 240, phase: NE, lookHeight: 1.2, subjects: crew } },
        { label: 'first frame raised', t1: T(raise1, 'end') + 2,
          spec: { kind: 'frameGroup', subjects: [...(upright1 ? [upright1] : []), ...crew.slice(0, 4)], padding: 1.5, azimuth: NE, elevation: 20 * DEG } },
        { label: 'first beam hung', t1: T(hang1, 'end') + 2,
          spec: { kind: 'orbit', center: c, radius: r + 8, height: 6, period: 180, phase: SE, lookHeight: 2, subjects: crew } },
        // high enough to look over the neighbouring 2022 decks (at 9 m they hid the crew for minutes at a time)
        { label: 'frames and beams, slow high orbit', t1: duration - 20,
          spec: { kind: 'orbit', center: c, radius: r + 12, height: 16, period: 600, phase: SW, lookHeight: 1.5, subjects: crew } },
        { label: 'first bay standing', t1: duration,
          spec: { kind: 'establishing', region: { min: [site.origin[0] - r - 2, site.origin[1] - r - 2], max: [site.origin[0] + r + 2, site.origin[1] + r + 2], y: site.groundY }, azimuth: NE, elevation: 30 * DEG } },
      ];
    },
    moments: ({ plan, T, g, duration }) => {
      const first = (verb) => plan.steps.find((s) => s.verb === verb)?.id;
      const c = first('carry');
      return {
        carry: g(T(c, 'start') + (T(c, 'end') - T(c, 'start')) / 2),
        held: g(T(first('raise_upright'), 'end') + 1),
        beam: g(T(first('hang_beam'), 'end') + 1),
        bay: Math.floor(duration / 2) * 2,
      };
    },
  },
};

// The whole 2022 east-house skeleton, phase A (12 frames + 54 beams; year-build.test.ts PIN_FULL, YEAR_BUILD_FULL): opt-in
// (`--full` or `--scenario year-build-2022-house`), ≈ 1 min of rehearsal. Phase A + B: `year-build-2022-ab` below.
SCENARIOS['year-build-2022-house'] = {
  ...SCENARIOS['year-build-2022'],
  file: 'year-build-2022-east-house.json',
  optIn: true,
  label: '2022 east-house skeleton, the whole house, from the piles (HYPOTHETICAL build scenario — not historical)',
  note: 'Year build phase A (YEAR_BUILD.md): a fork of protected mars-2022, the east-house removed and its whole skeleton (12 frames, 54 beams) rebuilt from a hypothetical pile yard by a generic crew of six, every part checked against the checkpoint pose. Coordinates are the 2022 year frame with ground at the Kit datum y = 0. Order, piles and crew are hypothetical.',
  limit: 6 * MB,
  pin: { ticks: 117277, finalStateHash: 'd382e4614e8ae157ad971ab7a4cb2b922c4737197006b39b4a209dc0db040617' }, // year-build.test.ts PIN_FULL
  run() {
    const s = yearBuildSetup(2022, 'east-house', loadCampusFile(2022));
    const reh = rehearse(s.history, s.workspace, s.plan, s.cfg);
    mustBeClean(reh, 'year build 2022 east-house skeleton');
    const fp = buildingFootprint(s.graph.nodes.filter((n) => n.assembly === 'east-house'));
    const site = { origin: fp.c, yaw: fp.yaw ?? 0, groundY: s.build.groundY, half: fp.half };
    return { reh, exact: () => rehearse(s.history, s.workspace, s.plan, { ...s.cfg, trackTol: 1 }).take, plan: s.plan, site, scene: s.scene, campus: 'mars-2022', crew: s.build.bindings.crew };
  },
  shots(ctx) {
    const l = SCENARIOS['year-build-2022'].shots(ctx);
    l[l.length - 1] = { ...l[l.length - 1], label: 'the east-house skeleton standing' };
    return l;
  },
};

// The whole 2022 east-house, phase A + B (skeleton, decks, stair, walls, solar; year-build-b.test.ts PIN_FULL_AB,
// YEAR_BUILD_FULL): explicit only (`--scenario year-build-2022-ab`; not in `--all --full`), ≈ 30 min (two 13-min
// rehearsals: the take and the exact take). ≈ 8.3 h simulated; the planned camera runs at 0.1 Hz (0.5 Hz alone would be
// ≈ 4.5 MB). NOT RECORDED (W27, 2026-09-29): the payload is 12 029 291 B (take 10.47 MB — tracks 4.74, changes 3.66,
// events 1.75 — camera 1.03 MB; gzip 2.02 MB), 5 737 835 B over the 6 MB limit; the lead decides (thin the take,
// raise the limit, or split it per section). Its final state equals the pin (take 53a180fd…).
SCENARIOS['year-build-2022-ab'] = {
  ...SCENARIOS['year-build-2022'],
  file: 'year-build-2022-east-house-ab.json',
  optIn: 'explicit',
  label: '2022 east-house: skeleton, decks, stair, walls, solar — from the piles (HYPOTHETICAL build scenario — not historical)',
  note: 'Year build phases A + B (YEAR_BUILD.md): a fork of protected mars-2022, the east-house removed and rebuilt from a hypothetical pile yard by a generic crew of six — skeleton (12 frames, 54 beams), ground / first-floor / roof decks (27 strips, 81 pieces cut at the station), the Kit stair, 25 plywood wall panels and 3 solar modules on rails — every sequenced part checked against the checkpoint through the provisional material rules. Coordinates are the 2022 year frame with ground at the Kit datum y = 0. Order, piles, crew and rules are hypothetical.',
  limit: 6 * MB,
  hz: 0.1,
  pin: { ticks: 600599, finalStateHash: 'ddb634d6e73d99e679421ceecaaec20a0936643d25dc33845082dd6a4ecdf30a' }, // year-build-b.test.ts PIN_FULL_AB
  run() {
    const s = yearBuildSetup(2022, 'east-house', loadCampusFile(2022), { phaseB: {} });
    const reh = rehearse(s.history, s.workspace, s.plan, s.cfg);
    mustBeClean(reh, 'year build 2022 east-house A+B');
    const fp = buildingFootprint(s.graph.nodes.filter((n) => n.assembly === 'east-house'));
    const site = { origin: fp.c, yaw: fp.yaw ?? 0, groundY: s.build.groundY, half: fp.half };
    return { reh, exact: () => rehearse(s.history, s.workspace, s.plan, { ...s.cfg, trackTol: 1 }).take, plan: s.plan, site, scene: s.scene, campus: 'mars-2022', crew: s.build.bindings.crew };
  },
  shots(ctx) {
    const l = SCENARIOS['year-build-2022'].shots(ctx);
    l[l.length - 1] = { ...l[l.length - 1], label: 'the east-house finished: decks, stair, walls, solar' };
    return l;
  },
};

// The whole 2022 east-house A + B as CHAPTERS (W31, lead decision: the single A+B take is 12.0 MB, over the 6 MB budget):
// ONE run of the pinned A+B plan (year-build-b.test.ts PIN_FULL_AB) cut at sequence-b's section barriers (A, D0, D1, D2,
// S, W, P with END folded in; engine/take/chapters.ts) into seven takes, each with its own camera plan, played back to back
// (manifest `chapterSets`). Chapter k's first frame is chapter k−1's final state; the last one ends at the pin. Explicit only
// (`--scenario year-build-2022-ab-chapters`), ≈ 30 min: two 13-min rehearsals (the takes and the exact re-run for the cameras).
// The skeleton chapter is not the whole-skeleton take above: the A+B yard has ten more piles (the phase-B stock), so that
// take's final state is not where D0 starts.
const YARD_VERBS = new Set(['take_from_bundle', 'carry', 'cut', 'stack_offcut', 'walk_to']);
/**
 * Per-section shot list: an establishing wide, then one frameGroup per stretch of work at the house (steps other than the
 * yard verbs), cut at those steps' starts (≥ minWin, ≤ maxWin s). A stretch frames the people who do that work AND stay at
 * the house (within its footprint + `near` m for ≥ `stay` of the stretch, sampled every 10 s) — a giver who spends most
 * of it fetching from the yard would stretch the frame until nobody is readable — from outside the house on their side
 * (alternately ±30°), low for people on the ground (10°: under the decks a steep camera sees plywood), higher on the decks.
 * A stretch with nobody working at the house frames whoever stays longest in one place; the chapter ends on a wide.
 */
function workShots(ctx, { what, minWin = 90, maxWin = 300, padding = 1.8, open = 15, close = 20, near = 2.5, stay = 0.7 }) {
  const { site, initial, plan, duration, crew, steps, take } = ctx;
  const params = new Map(plan.steps.map((s) => [s.id, JSON.stringify(s.params ?? {})]));
  const actors = (id) => crew.filter((c) => params.get(id)?.includes(`"${c}"`));
  const done = steps.filter((s) => s.start !== null && s.end !== null);
  const work = done.filter((s) => !YARD_VERBS.has(s.verb));
  const end = duration - close;
  const starts = [...new Set(work.map((s) => s.start))].filter((t) => t > open + minWin / 2 && t < end - minWin / 2).sort((a, b) => a - b);
  const cuts = [open];
  for (const t of starts) if (t - cuts[cuts.length - 1] >= minWin) cuts.push(t);
  cuts.push(end);
  const wins = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i], b = cuts[i + 1], k = Math.ceil((b - a) / maxWin);
    for (let j = 0; j < k; j++) wins.push([a + ((b - a) * j) / k, a + ((b - a) * (j + 1)) / k]);
  }
  const c = [site.origin[0], site.groundY, site.origin[1]];
  const half = site.half ?? [6, 6], yaw = site.yaw ?? 0;
  const r = Math.hypot(...half);
  const box = boundsOf(initial, 2);
  const cy = dcos(yaw), sy = dsin(yaw);
  const inHouse = (p) => { const dx = p[0] - c[0], dz = p[2] - c[2]; const u = dx * cy + dz * sy, v = -dx * sy + dz * cy; return Math.abs(u) <= half[0] + near && Math.abs(v) <= half[1] + near; };
  const shots = [{ label: `establishing: ${what}`, t1: open, spec: { kind: 'establishing', region: { ...box, y: site.groundY }, azimuth: SE, elevation: 32 * DEG } }];
  for (const [i, [a, b]] of wins.entries()) {
    const ts = [];
    for (let t = a; t < b; t += 10) ts.push(t);
    const frames = ts.map((t) => sampleTake(take, t).entities);
    const atHouse = (p) => frames.filter((f) => f[p] && inHouse(f[p].p)).length / frames.length;
    const workers = new Set(work.filter((s) => Math.min(b, s.end) > Math.max(a, s.start)).flatMap((s) => actors(s.id)));
    let subjects = crew.filter((p) => workers.has(p) && atHouse(p) >= stay);
    let where = '';
    if (!subjects.length) subjects = crew.filter((p) => atHouse(p) >= stay), where = 'at the house, ';
    if (!subjects.length) {
      // nobody at the house: the one who moves least (a cutter at the station, a stack), framed where they are
      const still = crew.map((p) => { const ps = frames.map((f) => f[p]?.p).filter(Boolean); const m = ps.length ? Math.max(...ps.map((q) => Math.hypot(q[0] - ps[0][0], q[2] - ps[0][2]))) : Infinity; return [p, m]; }).sort((x, y) => x[1] - y[1]);
      subjects = [still[0][0]];
      where = 'yard, ';
    }
    const f = frames[Math.floor(frames.length / 2)];
    const ps = subjects.map((s) => f[s]?.p).filter(Boolean);
    const m = [ps.reduce((x, p) => x + p[0], 0) / ps.length, ps.reduce((x, p) => x + p[1], 0) / ps.length, ps.reduce((x, p) => x + p[2], 0) / ps.length];
    const d = [m[0] - c[0], m[2] - c[2]];
    const az = (Math.hypot(d[0], d[1]) > 0.5 ? datan2(d[1], d[0]) : NE) + (i % 2 ? 30 : -30) * DEG;
    const elevation = (m[1] < 1 ? 10 : m[1] < 3.5 ? 22 : 30) * DEG;
    shots.push({ label: `${what}: ${where}${subjects.join(' ')}`, t1: b, spec: { kind: 'frameGroup', subjects, padding, azimuth: az, elevation } });
  }
  shots.push({ label: `${what}: done`, t1: duration, spec: { kind: 'establishing', region: { min: [site.origin[0] - r - 2, site.origin[1] - r - 2], max: [site.origin[0] + r + 2, site.origin[1] + r + 2], y: site.groundY }, azimuth: NE, elevation: 30 * DEG } });
  return shots;
}
/** Chapter moments: the first work step at the house, the middle of the chapter, the end. */
const workMoments = ({ steps, g, duration }) => {
  const w = steps.filter((s) => s.start !== null && !YARD_VERBS.has(s.verb)).sort((a, b) => a.start - b.start)[0];
  return { ...(w ? { work: g(w.start + 1) } : {}), middle: g(duration / 2), done: Math.floor(duration / 2) * 2 };
};
const chapterSpec = (label, note, what, opts = {}) => ({ label, note, shots: (ctx) => workShots(ctx, { what, ...opts }), moments: workMoments });
SCENARIOS['year-build-2022-ab-chapters'] = {
  ...SCENARIOS['year-build-2022'],
  chapters: true,
  optIn: 'explicit',
  kind: 'year-build-chapter',
  limit: 6 * MB,
  hz: 0.5,
  pin: { ticks: 600599, finalStateHash: 'ddb634d6e73d99e679421ceecaaec20a0936643d25dc33845082dd6a4ecdf30a' }, // year-build-b.test.ts PIN_FULL_AB
  set: {
    key: 'year-build-2022-east-house-ab',
    label: 'Watch it being built: 2022 east-house (A+B) (HYPOTHETICAL build scenario — not historical)',
    short: '2022 east-house A+B',
    note: 'Year build phases A + B (YEAR_BUILD.md): a fork of protected mars-2022, the east-house removed and rebuilt from a hypothetical pile yard by a generic crew of six — skeleton, three decks, the Kit stair, plywood walls, solar — every sequenced part checked against the checkpoint through the provisional material rules. Coordinates are the 2022 year frame with ground at the Kit datum y = 0. Order, piles, crew and rules are hypothetical.',
  },
  chapterFile: (id) => `year-build-2022-east-house-ab-${id.toLowerCase()}.json`,
  // chapter ids = engine/take/chapters.ts sectionBounds(build, ['END']), in order
  chapter: {
    A: chapterSpec('the skeleton — 12 frames, 54 beams', 'Phase A: frames off the stacks, raised and held, beams hung from the ground, handed up, and through a relay to 4.757 m.', 'the skeleton'),
    D0: chapterSpec('ground-floor deck — 27 pieces cut, notched and pushed in', 'Section D0: each strip\'s pieces cut (and notched) at the station, offcuts stacked, pushed in over the 0.22 m edge beams and screwed.', 'the ground-floor deck'),
    D1: chapterSpec('first-floor deck — from the stair end, received kneeling', 'Section D1: the first strip received by four who climbed the end frames onto the beams, later strips by people kneeling on the strip before.', 'the first-floor deck'),
    D2: chapterSpec('roof deck — through a relay at the first-floor edge', 'Section D2: a relay kneeling at the first-floor deck edge takes each piece from the ground givers and raises it to the receivers up top.', 'the roof deck'),
    S: chapterSpec('the Kit stair — stringers, treads, posts, handrails', 'Section S: six 2x12 stringers bolted to the end frame, 2x10 + 2x8 treads bottom to top (the top ones set from the treads below), posts and handrails.', 'the stair'),
    W: chapterSpec('plywood walls — 25 panels', 'Section W: ground panels stood by two and screwed from the ground and the first-floor deck; the upper wall raised to a crew on the deck.', 'the walls'),
    P: chapterSpec('solar rails and panels, then everyone down', 'Sections P + END: rails and panels passed up through the relay onto the roof deck, rails fastened, 3 panels tilted and fastened; then everyone down by the stair and along the roof beams.', 'solar'),
  },
  run() {
    const s = yearBuildSetup(2022, 'east-house', loadCampusFile(2022), { phaseB: {} });
    const bounds = sectionBounds(s.build, ['END']);
    const reh = rehearseChapters(s.history, s.workspace, s.plan, s.cfg, bounds);
    mustBeClean(reh, 'year build 2022 east-house A+B (chapters)');
    const fp = buildingFootprint(s.graph.nodes.filter((n) => n.assembly === 'east-house'));
    const site = { origin: fp.c, yaw: fp.yaw ?? 0, groundY: s.build.groundY, half: fp.half };
    const exactTakes = () => rehearseChapters(s.history, s.workspace, s.plan, { ...s.cfg, trackTol: 1 }, bounds).takes;
    return { reh, exactTakes, plan: s.plan, site, scene: s.scene, campus: 'mars-2022', crew: s.build.bindings.crew };
  },
};

/** min/max (x, z) over the initial non-static entities (people, piles, vehicles, fixtures), padded. */
function boundsOf(entities, pad) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const e of entities) {
    x0 = Math.min(x0, e.pose.p[0]); x1 = Math.max(x1, e.pose.p[0]);
    z0 = Math.min(z0, e.pose.p[2]); z1 = Math.max(z1, e.pose.p[2]);
  }
  return { min: [x0 - pad, z0 - pad], max: [x1 + pad, z1 + pad] };
}

/** Record one scenario → [{ S, name, entry, json }] (one per chapter for a chapter scenario, plus its `set`). */
function record(name) {
  const S = SCENARIOS[name];
  if (!S) throw new Error(`unknown scenario ${name}: ${Object.keys(SCENARIOS).join(' | ')}`);
  if (S.chapters) return recordChapters(name, S);
  // 1. the take
  const t0 = performance.now();
  const run = S.run();
  const take = run.reh.take;
  const tSim = performance.now() - t0;
  if (S.pin && (take.ticks !== S.pin.ticks || take.finalStateHash !== S.pin.finalStateHash))
    throw new Error(`${name}: take ${take.ticks} ticks / ${take.finalStateHash} differs from the test pin ${S.pin.ticks} / ${S.pin.finalStateHash}`);
  return [packageTake(name, S, run, take, tSim)];
}

/**
 * A chapter scenario (`chapters`): ONE run (engine/take/chapters.ts rehearseChapters) cut at the plan's section barriers into
 * consecutive takes, each packaged like a take of its own (own file, own camera plan, own manifest entry with `chapter`),
 * plus the set entry (`chapterSets`). The set's final state must be the scenario's pin; the chapters must be continuous.
 */
function recordChapters(name, S) {
  const t0 = performance.now();
  const run = S.run();
  const { chapters, takes } = run.reh;
  const tSim = performance.now() - t0;
  const last = takes[takes.length - 1];
  const ticks = takes.reduce((n, t) => n + t.ticks, 0);
  if (ticks !== run.reh.report.metrics.ticks) throw new Error(`${name}: chapters sum to ${ticks} ticks, the run has ${run.reh.report.metrics.ticks}`);
  if (S.pin && (ticks !== S.pin.ticks || last.finalStateHash !== S.pin.finalStateHash))
    throw new Error(`${name}: chapters ${ticks} ticks / ${last.finalStateHash} differ from the test pin ${S.pin.ticks} / ${S.pin.finalStateHash}`);
  for (let k = 1; k < takes.length; k++) {
    const bad = chapterContinuity(takes[k - 1], takes[k]);
    if (bad.length) throw new Error(`${name}: chapter ${chapters[k].id} does not start where ${chapters[k - 1].id} ended: ${bad.slice(0, 3).join('; ')}`);
  }
  const exact = run.exactTakes(); // one exact re-run for every chapter's camera (checked per chapter in packageTake)
  const setId = hashOf({ set: S.set.key, takes: takes.map((t) => t.id) }).slice(0, 24);
  const n = takes.length;
  const out = takes.map((take, k) => {
    const c = chapters[k], spec = S.chapter[c.id];
    if (!spec) throw new Error(`${name}: no chapter spec for ${c.id}`);
    const view = {
      ...S,
      file: S.chapterFile(c.id),
      label: `${S.set.short}, ${k + 1}/${n} ${c.id}: ${spec.label} (HYPOTHETICAL build scenario — not historical)`,
      note: `${spec.note} Chapter ${k + 1} of ${n} of "${S.set.label}" (${S.set.note}) Plan steps ${c.fromStep}–${c.toStep - 1}, run ticks ${c.fromTick}–${c.toTick}; it starts from the final state of the chapter before it.`,
      shots: spec.shots,
      moments: spec.moments,
      pin: k === n - 1 ? S.pin : undefined, // only the last chapter ends at the run's pin (checked above for the set)
    };
    const chapter = { of: setId, index: k, id: c.id, startsFrom: k ? takes[k - 1].id : null, startHash: take.baselineStateHash };
    return packageTake(`${name}:${c.id}`, view, { ...run, reh: { take }, exact: () => exact[k] }, take, k ? 0 : tSim, { chapter });
  });
  const set = {
    id: setId,
    label: S.set.label,
    year: S.year,
    hypothetical: true,
    kind: 'year-build-chapters',
    duration: ticks * last.dt,
    ticks,
    startStateHash: takes[0].baselineStateHash,
    finalStateHash: last.finalStateHash,
    planHash: last.planHash,
    rulesVersion: last.rulesVersion,
    bytes: out.reduce((b, r) => b + r.entry.bytes, 0),
    gzipBytes: out.reduce((b, r) => b + r.entry.gzipBytes, 0),
    chapters: out.map((r, k) => ({ id: chapters[k].id, label: S.chapter[chapters[k].id].label, take: r.entry.id, file: r.entry.file, from: chapters[k].fromTick, to: chapters[k].toTick, ticks: chapters[k].ticks, fromStep: chapters[k].fromStep, toStep: chapters[k].toStep })),
  };
  console.log(`== ${name}: set ${setId} "${S.set.label}", ${n} chapters, ${ticks} ticks, final ${last.finalStateHash}${S.pin ? ' (= test pin)' : ''}, ${set.bytes} B (gzip ${set.gzipBytes} B)`);
  out[0].set = set;
  return out;
}

/** Camera plan, moments, payload and manifest entry of one take (a scenario's, or one chapter of a chapter scenario). */
function packageTake(name, S, run, take, tSim, extra = {}) {
  const HZ = S.hz;
  const URL_PATH = `/engine/takes/${S.file}`;
  const { plan, site, scene } = run;
  const lib = new TakeLibrary();
  lib.put(take); // verifies the content address
  const final = replayFinalState(take);

  // 2. step timeline (seconds) from the take's own lifecycle events
  const { steps, T } = timeline(take, plan);
  const duration = takeDuration(take);
  const g = (t) => Math.round(t * HZ) / HZ; // shot boundaries on the camera grid
  const initial = Object.keys(take.tracks).map((id) => ({ id, pose: { p: [take.tracks[id][0][1] / 1000, take.tracks[id][0][2] / 1000, take.tracks[id][0][3] / 1000] } }));

  // 3. camera: shot list planned against the scene (+ the finished build, collision-only)
  const ctx = { site, final, initial, plan, T, g, duration, crew: run.crew, steps, take };
  const shots = S.shots(ctx).map((s, i, all) => ({ ...s, t0: i ? g(all[i - 1].t1) : 0, t1: g(s.t1) }));
  const cameraScene = { ...scene, obstacles: [...scene.obstacles, ...buildSolids(final)] };
  // the finished build may not be entered or crossed at any time; as a prism it never occludes (it is not there yet for
  // most of the take). Sight occlusion by parts comes per tick from takeSampler (kind-aware boxes: posts, stringers, slabs).
  const policy = { ...DEFAULT_CAMERA_POLICY, component: { collide: true, occlude: false } };
  // the camera is planned from an exact re-run (tracks at 1 mm / 1 mrad; the same motion — checked), not from the
  // shipped take's TRACK_TOL tracks: thinning must not move a planned camera (the whole-house take's shot list took other
  // corrections on 99 of 2933 samples when planned from the thinned tracks). The track belongs to the shipped take id.
  const exact = run.exact ? run.exact() : take;
  if (exact.ticks !== take.ticks || exact.finalStateHash !== take.finalStateHash) throw new Error(`${name}: the exact re-run differs from the take (${exact.ticks} / ${exact.finalStateHash})`);
  const t1 = performance.now();
  // cutCost 2.5 s: bystanders are occluders now, and a crew walking past for ~1 s is not worth a cut away and back
  // kind-aware sampler for every take (W23: piles / the cutting station are boxes from entities0, a removed entity leaves
  // at its removal tick). The year-build cameras were re-planned with it in W26 (lead decision, PROGRESS "W23 landed");
  // `legacyKinds` (every entity absent from finalState sampled as a person) is no longer used by the recorder.
  const cam = planShotList(shots, takeSampler(exact), cameraScene, { hz: HZ, policy, cutCost: 2.5, safeArea: { bottom: SAFE_BOTTOM } });
  const tCam = performance.now() - t1;
  const track = toCameraTrack('', take.id, cam, 'planned-shot-list');
  track.id = `cam-${hashOf({ takeId: take.id, data: track.data }).slice(0, 16)}`;
  lib.attachCamera(track);

  // 4. moments for the studio (take seconds) + payload
  const moments = S.moments(ctx);
  const { half: _half, ...siteOut } = site;
  const body = {
    schema: 'mars-take-replay/1',
    label: S.label,
    hypothetical: true,
    note: S.note,
    ...(extra.chapter ? { chapter: extra.chapter } : {}),
    campus: run.campus,
    site: siteOut,
    steps,
    moments,
    take,
    camera: track,
  };
  // extra camera tracks saved beside the take (`cameras`, e.g. directed ones: engine/camera/track.ts withFileCamera)
  // survive a re-record that reproduces the same take; a changed take drops them (they were computed against the old one)
  const prevPath = join(OUT_DIR, S.file);
  const prevFile = existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, 'utf8')) : null;
  const kept = [];
  if (prevFile?.cameras && Object.keys(prevFile.cameras).length) {
    if (prevFile.take?.id === take.id) {
      body.cameras = prevFile.cameras;
      kept.push(...fileCameras(body).slice(1).map((c) => c.id)); // checked: schema, key, same take
    } else console.log(`cameras      dropped ${Object.keys(prevFile.cameras).length} extra track(s) of the previous take ${prevFile.take?.id}: ${Object.keys(prevFile.cameras).join(', ')}`);
  }
  const json = JSON.stringify(body);
  const bytes = Buffer.byteLength(json);
  const gz = gzipSync(json, { level: 9 }).length;
  const entities = Object.keys(take.tracks).length;
  const entry = {
    id: take.id,
    file: URL_PATH,
    label: S.label,
    year: S.year,
    hypothetical: true,
    duration,
    ticks: take.ticks,
    entities,
    finalStateHash: take.finalStateHash,
    planHash: take.planHash,
    rulesVersion: take.rulesVersion,
    takeSchema: take.schema,
    ...(S.kind ? { kind: S.kind } : {}),
    ...(extra.chapter ? { chapter: extra.chapter } : {}),
    cameraTrack: track.id,
    ...(kept.length ? { cameras: kept } : {}),
    camera: {
      shots: shots.length,
      hz: HZ,
      samples: cam.report.samples,
      cuts: cam.report.cuts.length,
      invalidSamples: cam.report.invalidSamples,
      sweptCrossings: cam.report.sweptCrossings,
      minReadability: cam.report.minReadability,
      meanReadability: cam.report.meanReadability,
      readableFraction: cam.report.readableFraction,
      rejected: cam.report.rejected,
      safeAreaBottom: SAFE_BOTTOM,
    },
    violations: take.events.filter((e) => e.type === 'violation').length,
    blockedWaits: blockedWaits(take.events), // merged repeated waits (mars-take/4) count n times
    moments,
    bytes,
    gzipBytes: gz,
    takeBytes: Buffer.byteLength(JSON.stringify(take)),
    thinned: false,
  };

  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`== ${name}`);
  console.log(`take         ${take.id} (${take.schema})`);
  console.log(`final state  ${take.finalStateHash}${S.pin ? ' (= test pin)' : ''}`);
  console.log(`simulated    ${duration.toFixed(1)} s (${take.ticks} ticks), ${entities} entities, ${steps.length} steps, rehearsal ${(tSim / 1000).toFixed(1)} s`);
  console.log(`camera       ${track.id}: ${shots.length} shots, ${cam.report.samples} samples @ ${HZ} Hz, ${cam.report.cuts.length} cuts, readability min ${cam.report.minReadability.toFixed(2)} mean ${cam.report.meanReadability.toFixed(2)} readable ${(cam.report.readableFraction * 100).toFixed(1)}%, invalid ${cam.report.invalidSamples}, crossings ${cam.report.sweptCrossings}${cam.report.rejected ? ' REJECTED' : ''}, planned in ${(tCam / 1000).toFixed(1)} s`);
  for (const s of cam.shots) console.log(`  ${s.t0.toFixed(1).padStart(7)}–${s.t1.toFixed(1).padEnd(7)} ${s.label}: min read ${s.report.minReadability.toFixed(2)}, ${s.report.cuts.length} cuts, ${s.report.corrections.length} corrections${s.report.reasons[0] ? ` — ${s.report.reasons[0]}` : ''}`);
  const part = (k) => kb(Buffer.byteLength(JSON.stringify(take[k] ?? null)));
  console.log(`payload      ${bytes} B = ${kb(bytes)} (gzip ${kb(gz)}): take ${kb(Buffer.byteLength(JSON.stringify(take)))} (gzip ${kb(gzipSync(JSON.stringify(take), { level: 9 }).length)}; tracks ${part('tracks')}, changes ${part('changes')}, events ${part('events')}, finalState ${part('finalState')}, entities0 ${part('entities0')}), camera ${kb(Buffer.byteLength(JSON.stringify(track)))}`);
  console.log(`moments      ${JSON.stringify(moments)}`);
  if (bytes > S.limit) throw new Error(`${name}: take payload ${bytes} bytes > ${S.limit / MB} MB: thin replay samples / camera rate before shipping`);
  if (cam.report.rejected) throw new Error('camera plan rejected (invalid samples or swept crossings): ' + cam.report.reasons.filter((r) => /REJECTED/.test(r)).join('; '));
  return { S, name, entry, json };
}

const ORDER = Object.keys(SCENARIOS);
const full = process.argv.includes('--full');
const names = process.argv.includes('--all') ? ORDER.filter((n) => SCENARIOS[n].optIn !== 'explicit' && (full || !SCENARIOS[n].optIn)) : [argOf('--scenario') ?? 'flagship'];
// each scenario fails loudly on its own; --all still records (and writes) the ones that complete, then exits non-zero
const failed = [];
const results = names.flatMap((n) => {
  try { return record(n); } catch (e) {
    if (names.length === 1) throw e;
    failed.push(n);
    console.error(`== ${n} FAILED: ${e.message.slice(0, 600)}`);
    return [];
  }
});
const sets = results.filter((r) => r.set).map((r) => r.set);

if (check) {
  if (!existsSync(MANIFEST)) throw new Error('no manifest to check against');
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  let ok = true;
  for (const { entry } of results) {
    const prev = [...(m.takes ?? []), ...(m.otherYears ?? [])].find((t) => t.file === entry.file);
    const same = prev && prev.id === entry.id && prev.finalStateHash === entry.finalStateHash && prev.cameraTrack === entry.cameraTrack && prev.bytes === entry.bytes && JSON.stringify(prev.chapter) === JSON.stringify(entry.chapter);
    ok &&= !!same;
    console.log(same ? `check        ${entry.file} OK (take id, final state, camera track and bytes match)` : `check        ${entry.file} MISMATCH vs manifest ${JSON.stringify(prev && { id: prev.id, cameraTrack: prev.cameraTrack, bytes: prev.bytes })}`);
  }
  for (const set of sets) {
    const prev = (m.chapterSets ?? []).find((s) => s.label === set.label);
    const same = prev && JSON.stringify(prev) === JSON.stringify(set);
    ok &&= !!same;
    console.log(same ? `check        chapter set ${set.id} OK (${set.chapters.length} chapters, ${set.ticks} ticks, final ${set.finalStateHash.slice(0, 12)})` : `check        chapter set "${set.label}" MISMATCH vs manifest ${JSON.stringify(prev && { id: prev.id, ticks: prev.ticks, bytes: prev.bytes })}`);
  }
  process.exit(ok && !failed.length ? 0 : 1);
}

mkdirSync(OUT_DIR, { recursive: true });
const prev = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
const all = [...(prev.takes ?? []), ...(prev.otherYears ?? [])];
for (const { S, entry, json } of results) {
  writeFileSync(join(OUT_DIR, S.file), json);
  const i = all.findIndex((t) => t.file === entry.file);
  if (i >= 0) all[i] = entry; else all.push(entry);
  console.log(`wrote        public/engine/takes/${S.file}`);
}
// a re-recorded chapter set replaces the set of the same label; its old chapter entries (other take ids) go too
const allSets = [...(prev.chapterSets ?? [])];
for (const set of sets) {
  const i = allSets.findIndex((s) => s.label === set.label);
  if (i >= 0) {
    const keep = new Set(set.chapters.map((c) => c.file));
    for (const c of allSets[i].chapters) if (!keep.has(c.file)) { const j = all.findIndex((t) => t.file === c.file); if (j >= 0) all.splice(j, 1); }
    allSets[i] = set;
  } else allSets.push(set);
}
// manifest order follows ORDER (flagship first; a chapter scenario's files in chapter order at its place); entries of
// files this script no longer knows are kept at the end
const FILES = new Map();
for (const [k, n] of ORDER.entries()) {
  const S = SCENARIOS[n];
  if (S.chapters) for (const [j, id] of Object.keys(S.chapter).entries()) FILES.set(`/engine/takes/${S.chapterFile(id)}`, { rank: k + j / 100, list: S.list });
  else FILES.set(`/engine/takes/${S.file}`, { rank: k, list: S.list });
}
const rank = (t) => FILES.get(t.file)?.rank ?? ORDER.length;
all.sort((a, b) => rank(a) - rank(b));
const listOf = (t) => FILES.get(t.file)?.list ?? (t.year === 2026 ? 'takes' : 'otherYears');
const manifest = {
  schema: 'mars-take-manifest/1',
  takes: all.filter((t) => listOf(t) === 'takes'),
  otherYears: all.filter((t) => listOf(t) === 'otherYears'),
  otherYearsNote: 'Recorded in another year\'s frame; not offered by the 2026 studio picker (it replays every `takes` entry on the 2026 scene and does not filter by year).',
  ...(allSets.length ? {
    chapterSets: allSets,
    chapterSetsNote: 'A long build recorded as ONE run cut into consecutive chapter takes (engine/take/chapters.ts): each chapter is an `otherYears` entry with kind \'year-build-chapter\' and `chapter` { of, index, id, startsFrom, startHash }; play `chapters` in order — chapter k starts from chapter k − 1\'s final state (STUDIO_REPLAY.md "Chapter sets").',
  } : {}),
};
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote        public/engine/takes/manifest.json (takes: ${manifest.takes.map((t) => t.file.split('/').at(-1)).join(', ')}; otherYears: ${manifest.otherYears.map((t) => t.file.split('/').at(-1)).join(', ') || '—'}${allSets.length ? `; chapterSets: ${allSets.map((s) => `${s.id} (${s.chapters.length})`).join(', ')}` : ''})`);
if (failed.length) { console.error(`not recorded: ${failed.join(', ')}`); process.exit(1); }
