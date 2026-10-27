import { PerspectiveCamera, Vector3 } from 'three';

/** Bump when recipes, admissibility or ranking changes; callers bind this to cached pixels. */
export const CONTEXT_PHOTO_RECIPE = 'context-photo/2';
export const MAX_PHOTO_EVALUATIONS = 8;
export type PhotoPoint = readonly [number, number, number];
export type PhotoBounds = { min: PhotoPoint; max: PhotoPoint };
export type PhotoFront = {
  direction: PhotoPoint; source: 'declared-front' | 'entrance'; ambiguous?: boolean;
  alternatives?: readonly PhotoPoint[];
};
export type PhotoOccluder = {
  id: string; classification?: 'wall' | 'roof'; exteriorFacade?: boolean;
};
export type PhotoSubject = {
  ref: string; kind: 'exterior' | 'room' | 'part' | 'landscape' | 'wall-image';
  bounds: PhotoBounds; target: PhotoPoint; objectIds: readonly string[];
  authoredCamera?: { eye: PhotoPoint; at: PhotoPoint };
  front?: PhotoFront;
  /** Explicit enclosure evidence, never inferred from an authored camera or object yaw. */
  interior?: boolean;
  room?: { polygon: readonly (readonly [number, number])[]; floor: number; ceiling: number };
  occluders?: readonly PhotoOccluder[]; aspect?: number;
};
export type PhotoProvenance = {
  camera: 'authored' | 'geometric'; front: 'declared-front' | 'entrance' | 'unknown';
};
export type PhotoCutaway = { mode: 'hide' | 'ghost'; occluderIds: string[]; label: 'Cutaway' };
export type PhotoCandidate = {
  id: string; eye: PhotoPoint; at: PhotoPoint; fov: number;
  provenance: PhotoProvenance; cutaway?: PhotoCutaway;
  /** External probes can supply obstruction evidence but never become ordinary interior pictures. */
  ordinaryAllowed: boolean;
};
export type PhotoPlan = {
  recipeVersion: string; subject: PhotoSubject; candidates: PhotoCandidate[];
  invalid?: 'invalid-subject' | 'invalid-authored-camera';
};
export type PhotoEvidence = {
  subjectPresent: boolean; insideSolid: boolean;
  visibleFraction: number; projectedFill: number; clipping: number;
  /** Fraction of useful surrounding spatial context; omitted means unknown, not perfect. */
  context?: number; occluderIds?: readonly string[];
};
export type PhotoScore = {
  candidateId: string; admissible: boolean; reason?: string; total: number;
  visibility: number; frontAlignment: number; framing: number; clipping: number; context: number;
};
export type PhotoChoice = {
  status: 'ready'; recipeVersion: string; eye: PhotoPoint; at: PhotoPoint; fov: number;
  provenance: PhotoProvenance; scores: PhotoScore[]; cutaway?: PhotoCutaway;
} | {
  status: 'unavailable'; recipeVersion: string;
  reason: 'invalid-subject' | 'invalid-authored-camera' | 'needs-viewpoint'; diagnostics: PhotoScore[];
};

const finitePoint = (p: PhotoPoint) => p.length === 3 && p.every(Number.isFinite);
const vector = (p: PhotoPoint) => new Vector3(...p);
const tuple = (p: Vector3): PhotoPoint => [p.x, p.y, p.z];
const interior = (s: PhotoSubject) => s.kind === 'room' || s.interior === true || s.room !== undefined;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const ratio = (x: number) => Number.isFinite(x) && x >= 0 && x <= 1;
const validCamera = (c: { eye: PhotoPoint; at: PhotoPoint }) => finitePoint(c.eye) && finitePoint(c.at) && vector(c.eye).distanceToSquared(vector(c.at)) > 1e-8;

function front(s: PhotoSubject): { direction?: Vector3; source: PhotoProvenance['front'] } {
  const f = s.front;
  // Multiple entrances without an explicit unambiguous choice do not establish a front.
  if (!f || f.ambiguous || (f.alternatives?.length ?? 0) > 0 || !finitePoint(f.direction)) return { source: 'unknown' };
  const direction = vector(f.direction);
  return direction.lengthSq() > 1e-8 ? { direction: direction.normalize(), source: f.source } : { source: 'unknown' };
}

function inRoom(point: PhotoPoint, room: NonNullable<PhotoSubject['room']>): boolean {
  if (point[1] <= room.floor + .05 || point[1] >= room.ceiling - .05) return false;
  let inside = false;
  const [x, , z] = point, polygon = room.polygon;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j]!, b = polygon[i]!;
    // Keep eyes clear of boundaries, including reentrant corners of concave rooms.
    const dx = b[0] - a[0], dz = b[1] - a[1], length = dx * dx + dz * dz;
    const t = length ? clamp(((x - a[0]) * dx + (z - a[1]) * dz) / length) : 0;
    if (Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz) < .1) return false;
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Fits all eight corners in camera space, including depth and off-centre target points. */
function fit(s: PhotoSubject, direction: Vector3, fov: number): PhotoPoint {
  const camera = new PerspectiveCamera(fov, s.aspect ?? 10 / 7), target = vector(s.target);
  camera.position.copy(target).add(direction); camera.lookAt(target);
  const inverse = camera.quaternion.clone().invert(), vertical = Math.tan(fov * Math.PI / 360);
  const horizontal = vertical * camera.aspect, margin = s.kind === 'landscape' ? .72 : .84;
  let distance = .15;
  for (const x of [s.bounds.min[0], s.bounds.max[0]]) for (const y of [s.bounds.min[1], s.bounds.max[1]]) for (const z of [s.bounds.min[2], s.bounds.max[2]]) {
    const p = new Vector3(x, y, z).sub(target).applyQuaternion(inverse);
    distance = Math.max(distance, p.z + Math.abs(p.x) / (horizontal * margin), p.z + Math.abs(p.y) / (vertical * margin));
  }
  return tuple(target.addScaledVector(direction, distance));
}

export function planContextPhoto(subject: PhotoSubject): PhotoPlan {
  const plan: PhotoPlan = { recipeVersion: CONTEXT_PHOTO_RECIPE, subject, candidates: [] };
  const { min, max } = subject.bounds, room = subject.room;
  if (!finitePoint(min) || !finitePoint(max) || !finitePoint(subject.target) || min.some((x, i) => x > max[i]!) ||
      vector(min).distanceToSquared(vector(max)) < 1e-10 ||
      (subject.aspect !== undefined && (!Number.isFinite(subject.aspect) || subject.aspect <= 0)) ||
      (room && (room.polygon.length < 3 || !room.polygon.every(p => p.length === 2 && p.every(Number.isFinite)) ||
        !Number.isFinite(room.floor) || !Number.isFinite(room.ceiling) || room.ceiling - room.floor <= .2))) {
    plan.invalid = 'invalid-subject'; return plan;
  }
  const evidence = front(subject), provenance: PhotoProvenance = { camera: 'geometric', front: evidence.source };
  const add = (eye: PhotoPoint, fov: number, ordinaryAllowed: boolean, authored = false, at = subject.target) => {
    if (plan.candidates.length >= 6 || !validCamera({ eye, at })) return;
    if (plan.candidates.some(c => vector(c.eye).distanceToSquared(vector(eye)) < 1e-8 && vector(c.at).distanceToSquared(vector(at)) < 1e-8)) return;
    plan.candidates.push({ id: `view-${plan.candidates.length}`, eye, at, fov, ordinaryAllowed,
      provenance: authored ? { ...provenance, camera: 'authored' } : { ...provenance } });
  };
  if (subject.authoredCamera) {
    if (!validCamera(subject.authoredCamera)) { plan.invalid = 'invalid-authored-camera'; return plan; }
    const { eye, at } = subject.authoredCamera;
    add(eye, interior(subject) ? 64 : 38, !interior(subject) || !!room && inRoom(eye, room), true, at);
  }
  const base = evidence.direction ?? new Vector3(1, .45, 1).normalize();
  if (interior(subject) && room) {
    // Several actual room positions, including concave polygons; no bounding-box enclosure inference.
    const y = room.floor + Math.min(1.6, (room.ceiling - room.floor) * .6);
    const center = room.polygon.reduce((p, q) => [p[0] + q[0] / room.polygon.length, p[1] + q[1] / room.polygon.length], [0, 0]);
    for (const fraction of [.22, .5]) {
      for (let edge = 0; edge < Math.min(8, room.polygon.length) && plan.candidates.length < 4; edge++) {
        const i = Math.floor(edge * room.polygon.length / Math.min(8, room.polygon.length));
        const a = room.polygon[i]!, b = room.polygon[(i + 1) % room.polygon.length]!;
        const eye: PhotoPoint = [(a[0] + b[0]) * .5 * (1 - fraction) + center[0]! * fraction, y,
          (a[1] + b[1]) * .5 * (1 - fraction) + center[1]! * fraction];
        if (inRoom(eye, room)) add(eye, 64, true);
        if (plan.candidates.length >= 4) break;
      }
    }
  }
  // A declared/entrance front deserves several useful front obliques rather
  // than spending both side slots on views that cannot show that facade.
  const side = evidence.direction ? Math.PI / 3 : Math.PI / 2;
  const angles = interior(subject) ? [0, Math.PI] : [0, Math.PI / 4, -Math.PI / 4, side, -side, Math.PI];
  for (const angle of angles) {
    const direction = base.clone().applyAxisAngle(new Vector3(0, 1, 0), angle);
    if (subject.kind !== 'wall-image') direction.y = subject.kind === 'landscape' ? .95 : .45;
    direction.normalize();
    const eye = fit(subject, direction, subject.kind === 'landscape' ? 48 : 38);
    add(eye, subject.kind === 'landscape' ? 48 : 38, !interior(subject) || !!room && inRoom(eye, room));
  }
  return plan;
}

function score(plan: PhotoPlan, candidate: PhotoCandidate, e: PhotoEvidence): PhotoScore {
  const s = plan.subject, preferredFill = s.kind === 'landscape' ? .35 : s.kind === 'room' ? .6 : s.kind === 'wall-image' ? .68 : .5;
  const direction = front(s).direction, delta = vector(candidate.eye).sub(vector(candidate.at)).normalize();
  const alignment = direction ? clamp((delta.dot(direction) + 1) / 2) : .5;
  const valid = ratio(e.visibleFraction) && ratio(e.projectedFill) && ratio(e.clipping) && (e.context === undefined || ratio(e.context));
  const reason = !valid ? 'invalid-evidence' : !e.subjectPresent ? 'empty-subject' : e.insideSolid ? 'inside-solid' :
    !candidate.ordinaryAllowed && !candidate.cutaway ? 'outside-interior' : e.visibleFraction < .6 ? 'obscured' :
      e.projectedFill < .015 ? 'too-small' : e.clipping > .15 ? 'clipped' : undefined;
  const framing = valid ? clamp(1 - Math.abs(e.projectedFill - preferredFill) / preferredFill) : 0;
  const context = e.context ?? 0;
  return { candidateId: candidate.id, admissible: !reason, ...(reason ? { reason } : {}),
    total: valid ? 55 * e.visibleFraction + 18 * alignment + 18 * framing + 9 * context - 35 * e.clipping : -1,
    visibility: valid ? e.visibleFraction : 0, frontAlignment: alignment, framing, clipping: valid ? e.clipping : 1, context: valid ? context : 0 };
}

/** Evaluations are serial, deterministic and capped, including render-only cutaway variants. */
export async function chooseContextPhoto(plan: PhotoPlan, evaluate: (candidate: PhotoCandidate) => PhotoEvidence | Promise<PhotoEvidence>): Promise<PhotoChoice> {
  const scores: PhotoScore[] = [], evaluated: { candidate: PhotoCandidate; evidence: PhotoEvidence; score: PhotoScore }[] = [];
  const unavailable = (reason: Extract<PhotoChoice, { status: 'unavailable' }>['reason']): PhotoChoice =>
    ({ status: 'unavailable', recipeVersion: plan.recipeVersion, reason, diagnostics: scores });
  if (plan.invalid) return unavailable(plan.invalid);
  const inspect = async (candidate: PhotoCandidate) => {
    let evidence: PhotoEvidence;
    try { evidence = await evaluate(candidate); }
    catch { evidence = { subjectPresent: false, insideSolid: false, visibleFraction: NaN, projectedFill: 0, clipping: 0 }; }
    const item = { candidate, evidence, score: score(plan, candidate, evidence) };
    scores.push(item.score); evaluated.push(item); return item;
  };
  for (const candidate of plan.candidates.slice(0, 6)) {
    const item = await inspect(candidate);
    if (candidate.provenance.camera === 'authored' && ['inside-solid', 'empty-subject', 'invalid-evidence', 'clipped', 'too-small'].includes(item.score.reason ?? ''))
      return unavailable('invalid-authored-camera');
    if (candidate.provenance.camera === 'authored' && item.score.reason === 'outside-interior')
      return unavailable(plan.subject.room ? 'invalid-authored-camera' : 'needs-viewpoint');
  }
  const frontDirection = front(plan.subject).direction;
  const frontTier = (candidate: PhotoCandidate) => {
    if (!frontDirection || plan.subject.kind === 'room' || plan.subject.kind === 'landscape') return 0;
    const direction = vector(candidate.eye).sub(vector(candidate.at)); direction.y = 0;
    const horizontal = frontDirection.clone(); horizontal.y = 0;
    if (direction.lengthSq() < 1e-8 || horizontal.lengthSq() < 1e-8) return 0;
    // Orientation only: this is not evidence that an entrance itself is visible.
    return Number(direction.normalize().dot(horizontal.normalize()) >= .5 - 1e-8);
  };
  const best = () => evaluated.filter(item => item.score.admissible).sort((a, b) =>
    Number(b.candidate.provenance.camera === 'authored') - Number(a.candidate.provenance.camera === 'authored') ||
    frontTier(b.candidate) - frontTier(a.candidate) || b.score.total - a.score.total ||
    a.candidate.id.localeCompare(b.candidate.id))[0];
  let chosen = best();
  if (!chosen && interior(plan.subject)) {
    const forbidden = new Set(plan.subject.objectIds), classified = new Map((plan.subject.occluders ?? []).map(o => [o.id, o]));
    const allowedIds = (ids: readonly string[]) => [...new Set(ids)].filter(id => {
      const o = classified.get(id);
      return !forbidden.has(id) && o && !o.exteriorFacade && (o.classification === 'wall' || o.classification === 'roof');
    }).sort();
    const blocked = evaluated.filter(x => x.evidence.subjectPresent && !x.evidence.insideSolid &&
      ratio(x.evidence.visibleFraction) && x.evidence.visibleFraction < .6 && allowedIds(x.evidence.occluderIds ?? []).length > 0)
      .sort((a, b) => b.score.total - a.score.total || a.candidate.id.localeCompare(b.candidate.id));
    for (const item of blocked.slice(0, 2)) {
      const ids = allowedIds(item.evidence.occluderIds ?? []);
      if (!ids.length || scores.length >= MAX_PHOTO_EVALUATIONS) continue;
      await inspect({ ...item.candidate, id: `${item.candidate.id}-cutaway`, cutaway: { mode: 'hide', occluderIds: ids, label: 'Cutaway' } });
    }
    chosen = best();
  }
  if (!chosen) return unavailable('needs-viewpoint');
  const { eye, at, fov, provenance, cutaway } = chosen.candidate;
  return { status: 'ready', recipeVersion: plan.recipeVersion, eye, at, fov, provenance, scores, ...(cutaway ? { cutaway } : {}) };
}
