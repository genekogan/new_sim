#!/usr/bin/env node
// Record the flagship build on the real Mars 2026 campus as a replayable take
// plus an engine-planned camera track, for the studio's "Replay take" mode.
//   node deploy/record-campus-take.mjs          # write public/engine/takes/{flagship-campus-2026.json,manifest.json}
//   node deploy/record-campus-take.mjs --check  # re-record and compare take id / hashes with the files (no writes)
// Same recipe as engine/test/campus-flagship.test.ts: fork canonical Mars 2026,
// stage the build-bay inventory + crew at the centre of `staging-east`, rehearse
// the 43-step plan (TakeRecorder inside runPlan), then plan a shot list with
// engine/camera against the campus SpatialScene. HYPOTHETICAL: an engine
// demonstration, not a documented historical build (spec §4).
import { gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashOf } from '../engine/core/hash.ts';
import { WorldHistory } from '../engine/history/store.ts';
import { Spatial, entityFootprint } from '../engine/spatial/service.ts';
import { bindTemplate } from '../engine/sequence/bind.ts';
import { rehearse } from '../engine/rehearsal/rehearse.ts';
import { replayFinalState, takeDuration } from '../engine/take/replay.ts';
import { TakeLibrary } from '../engine/take/store.ts';
import { readCampus2026File } from '../engine/campus/node.ts';
import { cropScene } from '../engine/campus/load.ts';
import { CAMPUS_ID, loadCampus2026 } from '../engine/campus/world.ts';
import { RULES_VERSION } from '../engine/construction/rules.ts';
import { DEFAULT_CAMERA_POLICY } from '../engine/camera/geom.ts';
import { planShotList } from '../engine/camera/shotlist.ts';
import { takeSampler } from '../engine/camera/take-sampler.ts';
import { toCameraTrack } from '../engine/camera/track.ts';
import { buildBayEntities, buildBayTemplate, buildBayBindings, buildBayRegistry, BUILD_BAY_INVARIANTS, BUILD_BAY_CONTRIBUTORS } from '../engine/scenarios/build-bay.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public/engine/takes');
const FILE = 'flagship-campus-2026.json';
const URL_PATH = `/engine/takes/${FILE}`;
const RULES = `mars-campus-flagship/1+${RULES_VERSION}`;
const HZ = 10;
// The studio's replay bar (app/studio/take-panel.tsx, .take-panel in studio.css: 36 px inset + ~90 px panel)
// covers the bottom ~130 px of an 800 px viewport; subject framing keeps important points above it.
// Coupling: restyling that bar means re-planning with a matching fraction (the track stores it as data.safeArea).
const SAFE_BOTTOM = 0.17;
const LIMIT = 1.5 * 1024 * 1024;
const LABEL = 'Flagship rack bay at staging-east (HYPOTHETICAL build scenario — not historical)';
const check = process.argv.includes('--check');

// 1. the take (identical recipe to the campus flagship test)
const t0 = performance.now();
const file = readCampus2026File();
const { base, world } = loadCampus2026(file, { flagshipInventory: false });
const st = world.regions['staging-east'];
if (!st) throw new Error('campus scene has no staging-east region');
const xs = st.polygon.map((p) => p[0]), zs = st.polygon.map((p) => p[1]);
const site = { origin: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2], yaw: 0, groundY: base.meta.groundY };
const local = cropScene(base, [site.origin[0] - 40, site.origin[1] - 40, site.origin[0] + 40, site.origin[1] + 40]);
const h = new WorldHistory(RULES);
h.publishCanonical(CAMPUS_ID, 'Mars 2026 (canonical)', world, 'record-campus-take');
h.fork(CAMPUS_ID, 'build', 'flagship build (hypothetical)');
const w = h.read('build');
for (const e of buildBayEntities(site)) w.entities[e.id] = e;
h.commit('build', w, { kind: 'design-edit', note: 'flagship piles + crew at staging-east (hypothetical)' });
const registry = buildBayRegistry();
const plan = bindTemplate(buildBayTemplate(site), buildBayBindings, { history: h, baseline: 'build', registry });
const reh = rehearse(h, 'build', plan, {
  registry,
  invariants: BUILD_BAY_INVARIANTS,
  services: () => ({ spatial: new Spatial(local, { contributors: BUILD_BAY_CONTRIBUTORS, baseId: file.contentHash }) }),
});
if (reh.report.status !== 'completed' || reh.report.violations.length) {
  const bad = reh.report.steps.filter((s) => s.status !== 'completed').slice(0, 3);
  throw new Error(`flagship rehearsal did not complete cleanly: ${reh.report.status}, ${reh.report.violations.length} violations ${JSON.stringify(bad).slice(0, 400)}`);
}
const take = reh.take;
const lib = new TakeLibrary();
lib.put(take); // verifies the content address
const final = replayFinalState(take);
const tSim = performance.now() - t0;

// 2. step timeline (seconds) from the take's own lifecycle events
const steps = [];
const byId = new Map();
for (const e of take.events) {
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
const duration = takeDuration(take);
const g = (t) => Math.round(t * HZ) / HZ; // shot boundaries on the camera grid

// 3. camera: shot list planned against the campus scene (+ the finished bay, collision-only)
const bay = [site.origin[0], site.groundY, (final.entities.A.pose.p[2] + final.entities.B.pose.p[2]) / 2];
const b1x = final.entities.b1.pose.p[0];
const outsideB1 = b1x < bay[0] ? Math.PI : 0; // look at the first seated beam from outside its column
const NE = -Math.PI / 4, SE = Math.PI / 4, DEG = Math.PI / 180;
const shots = [
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
].map((s, i, all) => ({ ...s, t0: i ? g(all[i - 1].t1) : 0, t1: g(s.t1) }));

const buildSolids = Object.values(final.entities)
  .filter((e) => e.kind === 'component' && e.phase === 'installed')
  .map((e) => ({ id: `take:${e.id}`, kind: 'component', label: `hypothetical ${e.def} ${e.id}`, ...entityFootprint(e) }));
const cameraScene = { ...local, obstacles: [...local.obstacles, ...buildSolids] };
// the finished bay may not be entered or crossed at any time; it never occludes (it is not there yet for most of the take)
const policy = { ...DEFAULT_CAMERA_POLICY, component: { collide: true, occlude: false } };
const t1 = performance.now();
// cutCost 2.5 s: bystanders are occluders now, and a crew walking past for ~1 s is not worth a cut away and back
const cam = planShotList(shots, takeSampler(take), cameraScene, { hz: HZ, policy, cutCost: 2.5, safeArea: { bottom: SAFE_BOTTOM } });
const tCam = performance.now() - t1;
const track = toCameraTrack('', take.id, cam, 'planned-shot-list');
track.id = `cam-${hashOf({ takeId: take.id, data: track.data }).slice(0, 16)}`;
lib.attachCamera(track);

// 4. moments for the studio e2e (take seconds) + payload
const moments = {
  carry: g(T('carryA', 'start') + (T('carryA', 'end') - T('carryA', 'start')) / 2),
  held: g(T('raiseB', 'end') + 1),
  deck: g(T('deck_s2', 'end') + 1.5),
  visitor: Math.floor(duration * HZ) / HZ, // last grid point inside the take (the scrubber max is the duration)
};
const body = {
  schema: 'mars-take-replay/1',
  label: LABEL,
  hypothetical: true,
  note: 'Engine demonstration on a fork of canonical Mars 2026 (workspace mars-2026 untouched). Build site = centre of the algorithmic staging-east clearing east of Chiba; people are generic, not attendees.',
  campus: CAMPUS_ID,
  site,
  steps,
  moments,
  take,
  camera: track,
};
const json = JSON.stringify(body);
const bytes = Buffer.byteLength(json);
const gz = gzipSync(json, { level: 9 }).length;
if (bytes > LIMIT) throw new Error(`take payload ${bytes} bytes > 1.5 MB: thin replay samples to 10 Hz keyframes before shipping`);
const entities = Object.keys(take.tracks).length;
const entry = {
  id: take.id,
  file: URL_PATH,
  label: LABEL,
  year: 2026,
  hypothetical: true,
  duration,
  ticks: take.ticks,
  entities,
  finalStateHash: take.finalStateHash,
  planHash: take.planHash,
  rulesVersion: take.rulesVersion,
  cameraTrack: track.id,
  camera: {
    shots: shots.length,
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
  blockedWaits: take.events.filter((e) => e.type === 'action' && e.status === 'blocked').length,
  moments,
  bytes,
  gzipBytes: gz,
  thinned: false,
};
const manifest = { schema: 'mars-take-manifest/1', takes: [entry] };

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`take         ${take.id}`);
console.log(`final state  ${take.finalStateHash}`);
console.log(`simulated    ${duration.toFixed(1)} s (${take.ticks} ticks), ${entities} entities, ${steps.length} steps, rehearsal ${(tSim / 1000).toFixed(1)} s`);
console.log(`camera       ${track.id}: ${shots.length} shots, ${cam.report.samples} samples @ ${HZ} Hz, ${cam.report.cuts.length} cuts, readability min ${cam.report.minReadability.toFixed(2)} mean ${cam.report.meanReadability.toFixed(2)} readable ${(cam.report.readableFraction * 100).toFixed(1)}%, invalid ${cam.report.invalidSamples}, crossings ${cam.report.sweptCrossings}${cam.report.rejected ? ' REJECTED' : ''}, planned in ${(tCam / 1000).toFixed(1)} s`);
for (const s of cam.shots) console.log(`  ${s.t0.toFixed(1).padStart(6)}–${s.t1.toFixed(1).padEnd(6)} ${s.label}: min read ${s.report.minReadability.toFixed(2)}, ${s.report.cuts.length} cuts, ${s.report.corrections.length} corrections${s.report.reasons[0] ? ` — ${s.report.reasons[0]}` : ''}`);
console.log(`payload      ${kb(bytes)} (gzip ${kb(gz)}): take ${kb(Buffer.byteLength(JSON.stringify(take)))}, camera ${kb(Buffer.byteLength(JSON.stringify(track)))}`);
console.log(`moments      ${JSON.stringify(moments)}`);
if (cam.report.rejected) throw new Error('camera plan rejected (invalid samples or swept crossings): ' + cam.report.reasons.filter((r) => /REJECTED/.test(r)).join('; '));

if (check) {
  const path = join(OUT_DIR, 'manifest.json');
  if (!existsSync(path)) throw new Error('no manifest to check against');
  const prev = JSON.parse(readFileSync(path, 'utf8')).takes.find((t) => t.file === URL_PATH);
  const same = prev && prev.id === take.id && prev.finalStateHash === take.finalStateHash && prev.cameraTrack === track.id && prev.bytes === bytes;
  console.log(same ? 'check        OK (take id, final state, camera track and bytes match)' : `check        MISMATCH vs manifest ${JSON.stringify(prev && { id: prev.id, cameraTrack: prev.cameraTrack, bytes: prev.bytes })}`);
  process.exit(same ? 0 : 1);
}
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, FILE), json);
writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote        public/engine/takes/${FILE}, public/engine/takes/manifest.json`);
