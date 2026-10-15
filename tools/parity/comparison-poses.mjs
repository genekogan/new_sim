/**
 * Matched views for the Oct 15 human comparison, not an identical-pixel gate.
 * Pure file/coordinate work; importing this module starts no renderer or server.
 *
 * comparisonPoses(root, 'mars'|'littlemartians', template) returns named views:
 * {name,kind,hour,old:{eye,at},candidate:{eye,at},note}.
 * Mars cameras are the SAME viewpoint in each campus's own frame. The transform
 * follows mars-two/v3.mjs O/NORTH/EAST and mars-two/frame.mjs bearing90, and the
 * old mars-2026-map backdrop placement [40,.16,-30]. Its y translation cancels
 * the source ground y=-.16, so world eye heights are unchanged. The current
 * true-compass source retains this frame; its corrected rooms/furniture may
 * differ. No source GLB or private source file is opened here.
 *
 * LM has no whole-map rigid correspondence. Retained tower/temple geometry is
 * matched to the candidate's half-scale auxiliary buildings; overview and new
 * Arium landmarks are clearly labeled contextual comparisons. Rendering must
 * keep both roof policies and FOV equal, and verify the requested world hour.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Pinned geometry-frame facts from tools/god-skill/scripts/mars-two/v3.mjs and
// frame.mjs; do not import v3.mjs (its top level loads media-processing modules).
const O = [2.05645, -8.92635];
const NORTH = [0.4264952019559668, -0.9044898245467106];
const EAST = [0.9044898245467106, 0.4264952019559668];
const BACKDROP = [40, 0.16, -30];
const MIMOS_WORLD = [0, -30];
const r4 = n => Math.round(n * 10000) / 10000;
const round = p => p.map(r4);
const add = (p, q) => p.map((v, i) => v + q[i]);
const read = path => JSON.parse(readFileSync(path, 'utf8'));

/** Old camp/world frame → current bearing90 candidate frame, metres. */
export function marsOldToCandidate([x, y, z]) {
  const dx = x - BACKDROP[0] - O[0], dz = z - BACKDROP[2] - O[1];
  const n = dx * NORTH[0] + dz * NORTH[1], e = dx * EAST[0] + dz * EAST[1];
  return round([n + MIMOS_WORLD[0], y, e + MIMOS_WORLD[1]]);
}

/** Current bearing90 candidate frame → old camp/world frame, metres. */
export function marsCandidateToOld([x, y, z]) {
  const n = x - MIMOS_WORLD[0], e = z - MIMOS_WORLD[1];
  return round([BACKDROP[0] + O[0] + n * NORTH[0] + e * EAST[0], y,
    BACKDROP[2] + O[1] + n * NORTH[1] + e * EAST[1]]);
}

function worldPoint(op) {
  if (!op?.p) throw new Error('comparison landmark is missing its root placement');
  return op.p.length === 2 ? [op.p[0], 0, op.p[1]] : op.p.slice();
}

function rootPlacement(template, name) {
  const matches = template.batches.flatMap(b => b.ops).filter(o => o.op === 'place' && !o.in && o.name === name);
  if (matches.length !== 1) throw new Error(`expected one root placement for ${name}, found ${matches.length}`);
  return matches[0];
}

function marsPoses(template) {
  // The rounded authored rotation is −1.571. Refuse a different campus frame
  // rather than silently use an unsuitable camera transform.
  for (const name of ['chiba', 'mimos', 'kitchen', 'dojo']) {
    const op = rootPlacement(template, name), yaw = Array.isArray(op.r) ? op.r[0] : op.r ?? 0;
    if (Math.abs(yaw + Math.PI / 2) > 0.002) throw new Error(`${name}: comparison transform requires the bearing90 template`);
  }
  const fromCandidate = (name, kind, hour, eye, at, note) => ({ name, kind, hour,
    old: { eye: marsCandidateToOld(eye), at: marsCandidateToOld(at) },
    candidate: { eye: round(eye), at: round(at) }, note });
  const campus = hour => fromCandidate(hour === 14 ? 'campus-day' : hour === 18 ? 'campus-dusk' : 'campus-night',
    hour === 14 ? 'overview' : 'time', hour, [75, 85, 75], [20, 1, -65],
    'Same campus-relative view through the documented rigid frame transform. The old world includes its furnished camp beside a CAD backdrop; the candidate has individually authored campus entities and a rebuilt surrounding landscape.');
  const chiba = worldPoint(rootPlacement(template, 'chiba'));
  const dojo = worldPoint(rootPlacement(template, 'dojo'));
  const oldCamp = { eye: [29, 31, 27], at: [0, 0, -5] };
  return [
    campus(14),
    fromCandidate('chiba-solar-front', 'landmark', 14, add(chiba, [21, 18, 28]), add(chiba, [0, 3, 0]),
      'Chiba auditorium and its solar-panel face. Camera position and bearing are transformed from the candidate into the old campus frame; the source corrections may change individual details.'),
    fromCandidate('mimos-lounge-interior', 'interior', 14, [3.6, 1.65, -28.9], [3.9, 1.3, -33.9],
      'Mimos glazed tea room, looking from near the south glazing toward the poster/honey-sofa wall. The candidate applies Gene’s later room/furniture corrections; the old backdrop may depict an earlier arrangement.'),
    fromCandidate('working-kitchen-interior', 'interior', 14, [-7.2, 2.18, -31.7], [-7.5, 1.3, -38.9],
      'Working kitchen from the serving/front end toward the counter/prep area. The old layout puts a dividing panel in the foreground at this same campus-relative viewpoint; the new work bay is visible beyond it. The camera is 1.65 m above the raised kitchen floor. Interior access is measured separately below.'),
    fromCandidate('dojo-landmark', 'landmark', 14, add(dojo, [25, 19, 30]), add(dojo, [0, 3, 0]),
      'The same Dojo building in the campus frame. This is a landmark view; backdrop appearance is not evidence that old residents can enter or use it.'),
    { name: 'old-camp-context', kind: 'context', hour: 14, old: oldCamp,
      candidate: { eye: marsOldToCandidate(oldCamp.eye), at: marsOldToCandidate(oldCamp.at) },
      note: 'The old furnished camp: kitchen, living/classroom room, bunks, fire and work yard. Candidate shows the corresponding geographic patch; this plain camp was not recreated there. It is context for a content gap, not a matched replacement interior.' },
    campus(18), campus(23),
  ];
}

function lmPoses(root, template) {
  const scene = read(resolve(root, 'worlds/littlemartians/scene.json'));
  const oldBuilding = name => {
    const b = scene.buildings.find(b => b.file === name);
    if (!b || (b.yaw ?? 0) !== 0) throw new Error(`expected unrotated old LM building ${name}`);
    return b.p;
  };
  const pairBuilding = (file, candidateName) => {
    const op = rootPlacement(template, candidateName);
    if (Math.abs((op.s ?? 1) - 0.5) > 1e-9 || (op.r ?? 0) !== 0) throw new Error(`${candidateName}: expected the unrotated half-scale retained building`);
    return { old: oldBuilding(file), candidate: worldPoint(op), scale: op.s };
  };
  const tower = pairBuilding('ceramic-tower', 'auxiliary-tower');
  const temple = pairBuilding('minaret-temple', 'auxiliary-temple');
  const relative = (building, eye, at) => ({ old: { eye: add(building.old, eye), at: add(building.old, at) },
    candidate: { eye: add(building.candidate, eye.map(v => v * building.scale)), at: add(building.candidate, at.map(v => v * building.scale)) } });
  const overview = hour => ({ name: hour === 14 ? 'ceramic-world-day' : hour === 18 ? 'ceramic-world-dusk' : 'ceramic-world-night',
    kind: hour === 14 ? 'overview' : 'time', hour,
    old: { eye: [0, 65, 100], at: [0, 4, 0] }, candidate: { eye: [0, 230, 400], at: [0, 7, 100] },
    note: 'Whole-world context from the south: the compact original garden versus the larger Arium map. Framing scales to each map’s extent; there is no common rigid map transform or identical-location claim.' });
  return [
    overview(14),
    { name: 'ceramic-tower-context', kind: 'landmark', hour: 14, ...relative(tower, [38, 34, 56], [0, 19, 0]),
      note: 'Original Ceramic Tower versus the retained auxiliary tower at half scale and a new location. Camera offset and target height scale with the sculpture, so this compares its shape rather than equal metre-scale size.' },
    { name: 'minaret-temple-context', kind: 'landmark', hour: 14, ...relative(temple, [42, 39, 65], [0, 22, 0]),
      note: 'Original Minaret Temple versus its half-scale auxiliary copy. The candidate’s large Minarete scan is a different landmark and should not be substituted for this retained temple.' },
    { name: 'tower-ground-interior', kind: 'interior', hour: 14, ...relative(tower, [0, 2.15, 6], [0, 1.6, 0]),
      note: 'Ground hall: original floor .5m, candidate retained floor .25m at half scale. Camera height/offset scale with the building; the old tower is not left at its old size or map location.' },
    { name: 'temple-pavilion-interior', kind: 'interior', hour: 14, ...relative(temple, [0, 2.25, 5], [0, 1.6, 0]),
      note: 'Ground pavilion: original floor .6 m, candidate retained floor .3 m. This eye is inside the ground pavilion, rather than between its .6 m and 14.3 m storeys. Camera scales with the sculpture.' },
    { name: 'garden-and-arium-galleries', kind: 'context', hour: 14,
      old: { eye: [0, 24, 42], at: [0, 3, 8] }, candidate: { eye: [0, 55, 105], at: [0, 8, 5] },
      note: 'Old open garden/kin context versus the Arium commons with Madmaraca/Minarete gallery courts, glazed garden and painted grotto. Those new landmarks have no counterparts in the small old garden; the wide candidate view is contextual, not a recovered old gallery/grotto view.' },
    { name: 'arium-madmaraca-gallery', kind: 'context', hour: 14,
      old: { eye: [-35, 22, 35], at: [-17, 6, 0] }, candidate: { eye: [-24, 23, 15], at: [-45, 8, -20] },
      note: 'Added Arium landmark: the Madmaraca scan and gallery court. The old side shows the Ceramic Tower garden as context; the compact original has no Madmaraca counterpart.' },
    { name: 'arium-painted-grotto', kind: 'context', hour: 14,
      old: { eye: [30, 18, 42], at: [17, 4, 12] }, candidate: { eye: [66, 17, 73], at: [45, 4, 48] },
      note: 'Added Arium landmark: painted grotto and glazed basins. The original garden is shown for context because it has no painted grotto. This is not a matched original interior.' },
    overview(18), overview(23),
  ];
}

export function comparisonPoses(root, world, template) {
  if (!template?.batches) throw new Error('comparisonPoses needs the selected genesis template');
  const poses = world === 'mars' ? marsPoses(template) : ['littlemartians', 'lm'].includes(world) ? lmPoses(root, template) : null;
  if (!poses) throw new Error('comparison poses are available for Mars and Little Martians');
  for (const p of poses) for (const side of ['old', 'candidate']) for (const field of ['eye', 'at']) {
    if (!Array.isArray(p[side][field]) || p[side][field].length !== 3 || p[side][field].some(n => !Number.isFinite(n))) throw new Error(`invalid ${p.name} ${side} ${field}`);
  }
  return poses;
}
