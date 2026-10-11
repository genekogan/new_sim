// Kit creatures (L4): rounded low-poly bodies with animation roles, ≤ 600 tris each.
// Gaits live in apps/web/src/gen-mesh/motion.ts; behaviours come from the `behavior` component.
// Front is +z, feet at y = 0. Spec <eden4>/33 §3.2.
import { cap, cone, cyl, kitDef, limb, mirror, perch, sph, withRole } from './dsl.mjs';

const EYE = '#1d1a18', NOSE = '#2a2220';

/**
 * Parametric quadruped. Proportions in metres; colours by palette key.
 * Body is one capsule along z; legs are tapered capsules swinging from the hip; the head role
 * carries neck, skull, muzzle, ears and eyes (so ears ride along when it nods or grazes).
 */
function quadruped(q) {
  const L = q.L, H = q.H, wf = q.wf ?? 0.85, leg = q.leg, lr = q.legR, yb = leg + H * (q.sink ?? 0.32);
  const shapes = [];
  // torso: one capsule; optional chest/rump spheres give shoulders and haunches without many tris
  shapes.push(cap([0, yb, 0], H / 2, L - H, 'fur', { pitch: Math.PI / 2, scale: [wf, 1, 1], seg: q.bodySeg ?? 7 }));
  if (q.belly) shapes.push(sph([0, yb - H * 0.16, 0.04], 0.5, 'belly', { scale: [H * wf * 0.9, H * 0.75, L * 0.62], seg: 5 }));
  if (q.hump) shapes.push(sph([0, yb + H * 0.32, L * 0.22], H * 0.42, 'fur', { scale: [wf * 1.1, 0.7, 1.2], seg: 6 }));
  // legs: front pair under the chest, back pair under the rump; a paw or hoof at the foot
  const lx = H / 2 * wf * (q.legSpread ?? 0.62), zf = L / 2 - H * (q.legInsetF ?? 0.5), zb = -L / 2 + H * (q.legInsetB ?? 0.5);
  const legShapes = (x, z, back, role) => {
    const top = [x, yb, z], knee = back ? [x, leg * 0.45, z - lr * (q.hock ?? 1.2)] : [x, leg * 0.45, z];
    const foot = [x, (q.hoof ? q.hoof * 0.5 : lr * 0.55), z + (back ? lr * 0.2 : 0)];
    const out = [];
    // tapered cylinders (24 tris) instead of capsules (60): the paw or hoof hides the foot end
    const lc = q.legColor ?? 'fur', lo = q.lowerColor ?? lc;
    if (q.twoSegment && back) { out.push(limb(top, knee, lr * 1.45, lc, { kind: 'cyl', r2: lr * 1.0, seg: 6 })); out.push(limb(knee, foot, lr * 1.0, lo, { kind: 'cyl', r2: lr * 0.8, seg: 6 })); }
    else out.push(limb(top, foot, lr * 1.15, lo === lc ? lc : lo, { kind: 'cyl', r2: lr * 0.8, seg: 6 }));
    if (q.hoof) out.push(cyl([foot[0], q.hoof / 2, foot[2]], lr * 1.05, q.hoof, 'hoof', { r2: lr * 0.9, seg: 5 }));
    else if (q.paw !== false) out.push(sph([foot[0], lr * 0.55, foot[2] + lr * 0.35], lr * 1.15, q.pawColor ?? lo, { scale: [1, 0.62, 1.35], seg: 4 }));
    return withRole(role, top, out);
  };
  shapes.push(...legShapes(lx, zf, false, 'leg.fl'), ...legShapes(-lx, zf, false, 'leg.fr'), ...legShapes(lx, zb, true, 'leg.bl'), ...legShapes(-lx, zb, true, 'leg.br'));
  // head role: neck from the chest up to the skull
  const nb = [0, yb + H * 0.18, L / 2 - H * 0.35];
  const nl = q.neck?.len ?? H * 0.6, na = q.neck?.angle ?? 0.6;
  const hc = [0, nb[1] + Math.cos(na) * nl, nb[2] + Math.sin(na) * nl];
  const hr = q.head.r, hs = q.head.scale ?? [0.9, 0.9, 1.05];
  const head = [];
  if (nl > 0.02) head.push(limb(nb, hc, q.neck?.r ?? H * 0.28, 'fur', { kind: 'cyl', r2: (q.neck?.r ?? H * 0.28) * 0.8, seg: 6 }));
  head.push(sph(hc, hr, q.head.color ?? 'fur', { scale: hs, seg: 8 }));
  const sn = q.snout;
  const tip = [0, hc[1] - (sn.drop ?? hr * 0.25), hc[2] + hr * hs[2] * 0.6 + sn.len];
  // muzzle: an ellipsoid from the skull front to the nose (36 tris)
  if (sn.len > 0.01) { const s0 = [0, hc[1] - (sn.drop ?? hr * 0.25) * 0.6, hc[2] + hr * 0.3]; const ln = Math.hypot(tip[1] - s0[1], tip[2] - s0[2]); head.push(sph([0, (s0[1] + tip[1]) / 2, (s0[2] + tip[2]) / 2], 0.5, sn.color ?? 'muzzle', { scale: [sn.r * 2 * (sn.wide ?? 1), sn.r * 1.8, ln + sn.r * 1.4], pitch: Math.atan2(s0[1] - tip[1], ln) * 0.6, seg: 6 })); }
  head.push(sph([0, tip[1] + sn.r * 0.3, tip[2] + sn.r * 0.62], sn.nose ?? sn.r * 0.45, NOSE, { seg: 3 }));
  // eyes: two small dark beads on the front-sides of the skull
  const ex = hr * hs[0] * 0.55, ey = hc[1] + hr * 0.25, ez = hc[2] + hr * hs[2] * 0.72;
  head.push(sph([ex, ey, ez], hr * 0.13, EYE, { seg: 3 }), sph([-ex, ey, ez], hr * 0.13, EYE, { seg: 3 }));
  // ears
  const e = q.ears ?? { kind: 'none' };
  const ey0 = hc[1] + hr * hs[1] * 0.75, ex0 = hr * hs[0] * 0.55, ez0 = hc[2] - hr * 0.15;
  const earCol = e.color ?? 'fur';
  const one = (() => {
    switch (e.kind) {
      case 'pointy': return [cone([ex0, ey0 + e.h / 2, ez0], e.r, e.h, earCol, { roll: -(e.tilt ?? 0.25), seg: 5, scale: [1, 1, 0.55] })];
      case 'floppy': return [sph([ex0 + e.r * 0.4, hc[1] + hr * 0.1, ez0], e.r, earCol, { scale: [0.35, 1.3, 0.8], roll: -0.25, seg: 4 })];
      case 'round': return [sph([ex0, ey0, ez0], e.r, earCol, { scale: [1, 1, 0.45], seg: 5 })];
      case 'long': return [sph([ex0 * 0.6, ey0 + e.h / 2, ez0 - 0.01], 0.5, earCol, { roll: -(e.tilt ?? 0.12), scale: [e.r * 2, e.h + e.r * 2, e.r], seg: 5 })];
      case 'side': return [sph([ex0 + e.r * 0.6, ey0 - hr * 0.2, ez0], e.r, earCol, { scale: [1.2, 0.45, 0.7], roll: -0.35, seg: 4 })];
      default: return [];
    }
  })();
  head.push(...one, ...mirror(one));
  if (q.horns) { const hn = [cone([hr * 0.45, ey0 + q.horns.h / 2, ez0 + 0.02], q.horns.r, q.horns.h, 'horn', { roll: -(q.horns.tilt ?? 0.35), pitch: -(q.horns.back ?? 0.2), seg: 5 })]; head.push(...hn, ...mirror(hn)); }
  if (q.mane) head.push(cap([0, (nb[1] + hc[1]) / 2 + H * 0.12, (nb[2] + hc[2]) / 2 - H * 0.1], q.mane.r, nl * 0.8, 'mane', { pitch: na, scale: [0.45, 1, 1], seg: 6 }));
  if (q.headExtras) head.push(...q.headExtras({ hc, hr, hs, tip, nb }));
  shapes.push(...withRole('head', nb, head));
  // tail role
  const t = q.tail ?? { kind: 'none' };
  const tb = [0, yb + H * (t.y ?? 0.2), -L / 2 + H * 0.12];
  if (t.kind !== 'none') {
    const ta = t.angle ?? 0.9, tl = t.len;
    const tt = [0, tb[1] + Math.cos(ta) * tl, tb[2] - Math.sin(ta) * tl];
    const tail = t.kind === 'bushy' ? [sph([(tb[0] + tt[0]) / 2, (tb[1] + tt[1]) / 2, (tb[2] + tt[2]) / 2], 0.5, 'fur', { scale: [t.r * 2.4, t.r * 2.4, tl * 1.1], pitch: -(Math.PI / 2 - ta), seg: 6 }), sph(tt, t.r * 1.0, t.tip ?? 'fur', { scale: [1, 1, 1.3], pitch: -(Math.PI / 2 - ta), seg: 5 })]
      : t.kind === 'puff' ? [sph(tb, t.r, t.tip ?? 'fur', { seg: 5 })]
      : t.kind === 'tuft' ? [limb(tb, tt, t.r, 'fur', { kind: 'cyl', r2: t.r * 0.7, seg: 5 }), sph(tt, t.r * 1.7, t.tip ?? 'fur', { scale: [1, 1.6, 1], seg: 4 })]
      : t.kind === 'hook' ? (() => { const mid = [0, tb[1] + Math.cos(t.angle2 ?? 1.9) * tl * 0.5, tb[2] - Math.sin(t.angle2 ?? 1.9) * tl * 0.5]; const tip = [0, mid[1] + Math.cos(ta) * tl * 0.55, mid[2] - Math.sin(ta) * tl * 0.55]; return [limb(tb, mid, t.r, 'fur', { kind: 'cyl', r2: t.r * 0.85, seg: 5 }), limb(mid, tip, t.r * 0.85, t.tip ?? 'fur', { kind: 'cone', seg: 5 })]; })()
      : [limb(tb, tt, t.r, t.tip ?? 'fur', { kind: 'cone', seg: 5 })];
    shapes.push(...withRole('tail', tb, tail));
  }
  if (q.extras) shapes.push(...q.extras({ yb, L, H, wf }));
  return shapes;
}

/** Parametric bird (duck, goose, chicken, crow, gull): ellipsoid body, neck+head role, wings and legs. */
function bird(b) {
  const L = b.L, H = b.H, W = b.W ?? H * 0.85, leg = b.leg, yb = leg + H * 0.42;
  const shapes = [sph([0, yb, 0], 0.5, 'feather', { scale: [W, H, L], seg: 8 })];
  if (b.breast) shapes.push(sph([0, yb - H * 0.08, L * 0.18], 0.5, 'breast', { scale: [W * 0.85, H * 0.8, L * 0.55], seg: 6 }));
  // tail: a flattened cone pointing back and up
  shapes.push(cone([0, yb + H * (b.tailUp ?? 0.15), -L * 0.5], W * 0.28, L * (b.tailLen ?? 0.32), b.tailColor ?? 'feather', { pitch: Math.PI / 2 + (b.tailAngle ?? 0.5), scale: [1, 1, 0.35], seg: 5 }));
  // neck + head + bill
  const nb = [0, yb + H * 0.25, L * 0.3], ha = b.neckAngle ?? 0.25;
  const hc = [0, nb[1] + Math.cos(ha) * b.neck, nb[2] + Math.sin(ha) * b.neck];
  const head = [];
  if (b.neck > 0.02) head.push(limb(nb, hc, b.neckR ?? H * 0.2, b.neckColor ?? 'head', { seg: 6 }));
  head.push(sph(hc, b.head, 'head', { scale: [0.9, 0.95, 1.05], seg: 8 }));
  const bl = b.bill;
  const bs = [0, hc[1] - b.head * (bl.drop ?? 0.15), hc[2] + b.head * 0.75];
  head.push(bl.kind === 'flat'
    ? cap([0, bs[1], bs[2] + bl.len / 2], bl.r, bl.len, 'bill', { pitch: Math.PI / 2 + (bl.tilt ?? 0.1), scale: [1, 1, 0.45], seg: 6 })
    : cone([0, bs[1], bs[2] + bl.len / 2], bl.r, bl.len, 'bill', { pitch: Math.PI / 2 + (bl.tilt ?? 0.1), seg: 5 }));
  const ex = b.head * 0.62, ey = hc[1] + b.head * 0.25, ez = hc[2] + b.head * 0.45;
  head.push(sph([ex, ey, ez], b.head * 0.16, EYE, { seg: 4 }), sph([-ex, ey, ez], b.head * 0.16, EYE, { seg: 4 }));
  if (b.comb) head.push(sph([0, hc[1] + b.head * 0.9, hc[2] + b.head * 0.1], b.head * 0.45, 'comb', { scale: [0.35, 0.8, 1.1], seg: 5 }), sph([0, bs[1] - b.head * 0.45, bs[2] + 0.005], b.head * 0.22, 'comb', { scale: [0.5, 1.2, 0.7], seg: 4 }));
  if (b.headExtras) head.push(...b.headExtras({ hc }));
  shapes.push(...withRole('head', nb, head));
  // wings: flattened ellipsoids hinged at the shoulder
  const sx = W * 0.47, sy = yb + H * 0.18, sz = L * 0.12;
  const wing = withRole('wing.l', [sx, sy, sz], [sph([sx + 0.005, yb + H * 0.02, -L * 0.06], 0.5, b.wingColor ?? 'feather', { scale: [W * 0.18, H * 0.62, L * 0.72], pitch: -0.12, seg: 6 })]);
  shapes.push(...wing, ...mirror(wing));
  // legs: thin shanks and a foot (webbed for water birds)
  const lx = W * 0.22, hip = [lx, yb - H * 0.25, 0.0];
  const legShapes = [cyl([lx, (hip[1]) / 2, 0], b.legR ?? 0.012, hip[1], 'legs', { seg: 5 })];
  legShapes.push(b.webbed ? cone([lx, 0.008, b.foot * 0.45], b.foot * 0.55, b.foot, 'legs', { pitch: -Math.PI / 2, scale: [1, 1, 0.18], seg: 3 }) : cap([lx, 0.008, b.foot * 0.3], 0.008, b.foot, 'legs', { pitch: Math.PI / 2, seg: 4 }));
  const legL = withRole('leg.l', hip, legShapes);
  shapes.push(...legL, ...mirror(legL));
  return shapes;
}

/** A fish: elongated body, tail fin (role tail), small fins. Origin at the body centre line. */
function fish(f) {
  const L = f.L, H = f.H, W = f.W ?? H * 0.55;
  const shapes = [sph([0, H / 2, 0], 0.5, 'scales', { scale: [W, H, L], seg: 8 })];
  if (f.spots) for (const [x, y, z, r] of f.spots) shapes.push(sph([x * W, H / 2 + y * H, z * L], r * H, 'spots', { scale: [0.6, 0.5, 1], seg: 5 }));
  shapes.push(...withRole('tail', [0, H / 2, -L * 0.42], [cone([0, H / 2, -L * 0.6], H * 0.5, L * 0.3, 'fin', { pitch: Math.PI / 2, scale: [0.18, 1, 1], seg: 4 })]));
  shapes.push(cone([0, H * 0.98, -L * 0.05], L * 0.12, H * 0.3, 'fin', { scale: [0.2, 1, 1.6], seg: 4 }));
  const pf = [cone([W * 0.45, H * 0.35, L * 0.12], H * 0.18, H * 0.4, 'fin', { roll: -1.9, scale: [1, 1, 0.3], seg: 3 })];
  shapes.push(...pf, ...mirror(pf));
  const e = [sph([W * 0.38, H * 0.6, L * 0.36], H * 0.08, EYE, { seg: 4 })];
  shapes.push(...e, ...mirror(e));
  if (f.whiskers) { const w = [cap([W * 0.22, H * 0.38, L * 0.5], 0.004, L * 0.12, 'spots', { pitch: 1.2, yaw: 0.5, seg: 3 })]; shapes.push(...w, ...mirror(w)); }
  return shapes;
}

const creature = (name, description, tags, shapes, palette, gait, behavior, extra = {}) => kitDef({
  name, description, tags: ['creature', 'animal', ...tags], shapes, palette, gait, round: 0.02,
  layer: 'decor', anchor: extra.anchor ?? 'base',
  components: { behavior: { kind: behavior, speed: extra.speed ?? 1, radius: extra.radius ?? 8 }, ...(extra.components ?? {}) },
  scale: extra.scale ?? [0.4, 2.5],
  params: {
    behavior: { type: 'enum', values: ['wander', 'graze', 'swim', 'perch', 'sleep', 'fly', 'follow', 'idle'], default: behavior, doc: 'what it does (client-side, deterministic): wander/graze within radius of where it was placed, swim in water, perch, sleep, fly loops, follow a ref, idle' },
    speed: { type: 'number', min: 0.1, max: 6, default: extra.speed ?? 1, doc: 'walking speed m/s' },
    radius: { type: 'number', min: 0.5, max: 40, default: extra.radius ?? 8, doc: 'how far from home it roams (m)' },
    follow: { type: 'string', max: 80, default: '', doc: 'entity id or path to follow (behavior follow)' },
    ...(extra.params ?? {}),
  },
});

/** A herd, flock or school living in an area (animals/1): each member is the species' kit creature. */
const herd = {
  schema: 'def/1', name: 'core-animals', version: 1, form: 'area', layer: 'decor',
  description: 'Animals living in an area: a herd, flock or school (species: dog, cat, pug, duck, goose, chicken, sheep, goat, cow, horse, pig, fox, deer, rabbit, bird, crow, seagull, koi, fish; or def: any kit creature). Each one wanders, grazes or swims (on water areas) around its own spot. Area shape. Client-side, no server cost.',
  tags: ['animals', 'herd', 'flock', 'school', 'creature-group', 'livestock'],
  make: { kind: 'gen', gen: 'animals/1' },
  params: {
    species: { type: 'enum', values: ['dog', 'cat', 'pug', 'duck', 'goose', 'chicken', 'sheep', 'goat', 'cow', 'horse', 'pig', 'fox', 'deer', 'rabbit', 'bird', 'crow', 'seagull', 'koi', 'fish'], default: 'sheep' },
    def: { type: 'ref', doc: 'a kit creature def instead of the species (e.g. "core/dog@1" or your own)' },
    count: { type: 'int', min: 1, max: 60, default: 5 },
    behavior: { type: 'enum', values: ['wander', 'graze', 'swim', 'perch', 'sleep', 'fly', 'follow', 'idle'], default: 'graze', doc: 'water areas always swim' },
    speed: { type: 'number', min: 0.1, max: 6, default: 1, doc: 'multiplies the species speed' },
    scale: { type: 'number', min: 0.3, max: 3, default: 1, doc: 'size (ducklings: 0.5)' },
  },
  size: { box: [40, 2, 40] },
};

export default [
  herd,
  creature('dog', 'A friendly medium dog (rounded low-poly, ~600 tris) that trots about its yard: diagonal-pair walk, head nod, wagging tail. Recolour with params fur/muzzle/ear. Behaviours: wander (default), follow, sleep.', ['dog', 'pet', 'pup', 'puppy', 'quadruped'],
    quadruped({ L: 0.72, H: 0.3, leg: 0.36, legR: 0.045, twoSegment: true, neck: { len: 0.17, angle: 0.55, r: 0.085 }, head: { r: 0.11, scale: [0.9, 0.92, 1.0] }, snout: { len: 0.13, r: 0.048 }, ears: { kind: 'floppy', r: 0.07, color: 'ear' }, tail: { kind: 'hook', len: 0.3, r: 0.026, angle: 0.75, angle2: 1.7, y: 0.3 }, belly: true }),
    { fur: '#b8814a', belly: '#e6cfa6', muzzle: '#e6cfa6', ear: '#7a4f2a' }, 'quadruped-walk', 'wander', { speed: 1.1, radius: 7 }),
  creature('pug', 'A small pug with a short snout, curly tail and dark ears: a compact quadruped that ambles and naps.', ['dog', 'pug', 'pet', 'quadruped'],
    quadruped({ L: 0.42, H: 0.24, wf: 1.0, leg: 0.17, legR: 0.035, neck: { len: 0.04, angle: 0.5, r: 0.08 }, head: { r: 0.11, scale: [1.05, 0.95, 0.95], color: 'fur' }, snout: { len: 0.015, r: 0.05, color: 'mask', nose: 0.024 }, ears: { kind: 'side', r: 0.045, color: 'mask' }, tail: { kind: 'puff', r: 0.045, y: 0.35, tip: 'fur' } }),
    { fur: '#d9b98a', mask: '#3a2f28' }, 'quadruped-walk', 'wander', { speed: 0.7, radius: 5 }),
  creature('cat', 'A slender cat with pointed ears and a long raised tail; wanders, sits and sleeps in the sun.', ['cat', 'kitty', 'kitten', 'pet', 'quadruped'],
    quadruped({ L: 0.5, H: 0.19, wf: 0.95, leg: 0.21, legR: 0.026, twoSegment: true, neck: { len: 0.08, angle: 0.45, r: 0.055 }, head: { r: 0.075, scale: [1.0, 0.9, 0.95] }, snout: { len: 0.02, r: 0.03, color: 'muzzle', nose: 0.012 }, ears: { kind: 'pointy', r: 0.032, h: 0.06, tilt: 0.15 }, tail: { kind: 'hook', len: 0.4, r: 0.018, angle: 0.15, angle2: 2.3, y: 0.3 } }),
    { fur: '#6e6a66', muzzle: '#d9d2c4' }, 'quadruped-walk', 'wander', { speed: 0.7, radius: 6 }),
  creature('fox', 'A red fox with a white-tipped bushy tail, pointed ears and a narrow muzzle; wanders the edge of woods.', ['fox', 'wild', 'quadruped'],
    quadruped({ L: 0.62, H: 0.22, wf: 0.85, leg: 0.27, legR: 0.03, twoSegment: true, lowerColor: 'sock', neck: { len: 0.12, angle: 0.6, r: 0.065 }, head: { r: 0.085 }, snout: { len: 0.1, r: 0.035, color: 'muzzle', nose: 0.016 }, ears: { kind: 'pointy', r: 0.04, h: 0.08, tilt: 0.2, color: 'fur' }, tail: { kind: 'bushy', len: 0.3, r: 0.05, angle: 1.9, y: 0.15, tip: 'tip' } }),
    { fur: '#c8662b', muzzle: '#f1e6d6', sock: '#3a2a22', tip: '#f4efe6' }, 'quadruped-walk', 'wander', { speed: 1.2, radius: 10 }),
  creature('sheep', 'A woolly sheep: fat cream fleece, dark face and legs; grazes in a field with pauses.', ['sheep', 'lamb', 'farm', 'livestock', 'quadruped'],
    quadruped({ L: 0.9, H: 0.55, wf: 1.0, leg: 0.32, legR: 0.03, legColor: 'face', legSpread: 0.5, sink: 0.12, neck: { len: 0.1, angle: 1.0, r: 0.1 }, head: { r: 0.11, scale: [0.85, 0.95, 1.25], color: 'face' }, snout: { len: 0.03, r: 0.05, color: 'face', nose: 0.02 }, ears: { kind: 'side', r: 0.05, color: 'face' }, tail: { kind: 'puff', r: 0.08, y: 0.25, tip: 'fur' }, extras: ({ yb }) => [sph([0, yb + 0.22, 0.32], 0.17, 'fur', { scale: [1.2, 0.9, 1], seg: 6 })] }),
    { fur: '#efe8d8', face: '#2e2a27' }, 'quadruped-walk', 'graze', { speed: 0.5, radius: 10 }),
  creature('goat', 'A goat with curved horns, a little beard and an upright tail; grazes and clambers about.', ['goat', 'kid', 'farm', 'livestock', 'quadruped'],
    quadruped({ L: 0.8, H: 0.36, wf: 0.8, leg: 0.42, legR: 0.03, hoof: 0.05, neck: { len: 0.22, angle: 0.5, r: 0.07 }, head: { r: 0.09, scale: [0.8, 0.9, 1.3] }, snout: { len: 0.06, r: 0.045, color: 'fur' }, ears: { kind: 'side', r: 0.05 }, horns: { r: 0.022, h: 0.15, tilt: 0.25, back: 0.6 }, tail: { kind: 'long', len: 0.1, r: 0.025, angle: 0.25, y: 0.35 }, headExtras: ({ hc, tip }) => [cone([0, tip[1] - 0.07, tip[2] - 0.05], 0.025, 0.08, 'beard', { pitch: Math.PI, seg: 4 })] }),
    { fur: '#d9cdb8', hoof: '#3b322b', horn: '#8c7a62', beard: '#a89880' }, 'quadruped-walk', 'graze', { speed: 0.6, radius: 10 }),
  creature('cow', 'A black-and-white dairy cow with short horns and a tufted tail; grazes slowly in a pasture.', ['cow', 'cattle', 'calf', 'farm', 'livestock', 'quadruped'],
    quadruped({ L: 1.9, H: 0.8, wf: 0.82, leg: 0.66, legR: 0.08, hoof: 0.09, neck: { len: 0.34, angle: 1.1, r: 0.21 }, head: { r: 0.22, scale: [0.85, 0.95, 1.3] }, snout: { len: 0.1, r: 0.13, color: 'muzzle', nose: 0.05, drop: 0.14, wide: 1.2 }, ears: { kind: 'side', r: 0.09 }, horns: { r: 0.03, h: 0.11, tilt: 1.0, back: 0.2 }, bodySeg: 6, tail: { kind: 'tuft', len: 0.62, r: 0.025, angle: 2.85, y: 0.3, tip: 'patch' }, extras: ({ yb }) => [sph([0.24, yb + 0.12, 0.3], 0.3, 'patch', { scale: [0.6, 1, 1.3], seg: 4 }), sph([-0.22, yb + 0.06, -0.4], 0.3, 'patch', { scale: [0.65, 1, 1.4], seg: 4 }), sph([0, yb - 0.38, -0.3], 0.12, 'udder', { scale: [1, 0.7, 1], seg: 3 })] }),
    { fur: '#f3efe8', belly: '#f3efe8', patch: '#2b2725', muzzle: '#e7b9a8', hoof: '#3a322c', horn: '#e5dac4', udder: '#e7b9a8' }, 'quadruped-walk', 'graze', { speed: 0.5, radius: 14 }),
  creature('horse', 'A bay horse with a dark mane, long legs and a flowing tail; walks and grazes in a paddock.', ['horse', 'pony', 'foal', 'farm', 'quadruped'],
    quadruped({ L: 1.75, H: 0.62, wf: 0.75, leg: 0.95, legR: 0.055, hoof: 0.09, twoSegment: true, lowerColor: 'fur', neck: { len: 0.62, angle: 0.55, r: 0.14 }, head: { r: 0.16, scale: [0.75, 0.95, 1.2] }, snout: { len: 0.3, r: 0.11, color: 'fur', nose: 0.05, drop: 0.14 }, ears: { kind: 'pointy', r: 0.035, h: 0.12, tilt: 0.1 }, mane: { r: 0.06 }, tail: { kind: 'long', len: 0.75, r: 0.06, angle: 2.5, y: 0.3, tip: 'mane' } }),
    { fur: '#8a5230', mane: '#2a1d16', hoof: '#2b2420' }, 'quadruped-walk', 'graze', { speed: 0.9, radius: 16 }),
  creature('pig', 'A round pink pig with a flat snout, floppy ears and a curly tail; snuffles about the farmyard.', ['pig', 'piglet', 'hog', 'farm', 'livestock', 'quadruped'],
    quadruped({ L: 1.0, H: 0.52, wf: 0.95, leg: 0.22, legR: 0.05, hoof: 0.05, sink: 0.28, neck: { len: 0.02, angle: 0.5, r: 0.2 }, head: { r: 0.21, scale: [0.95, 0.9, 0.9] }, snout: { len: 0.06, r: 0.09, color: 'snout', nose: 0.05, drop: 0.06 }, ears: { kind: 'floppy', r: 0.08 }, tail: { kind: 'long', len: 0.12, r: 0.02, angle: 0.5, y: 0.3 } }),
    { fur: '#eeb0a6', snout: '#e39a8f', hoof: '#8a5f58' }, 'quadruped-walk', 'graze', { speed: 0.5, radius: 8 }),
  creature('deer', 'A slender deer with small antlers, a white tail and long legs; grazes in a clearing and bounds off.', ['deer', 'fawn', 'stag', 'wild', 'quadruped'],
    quadruped({ L: 1.15, H: 0.42, wf: 0.75, leg: 0.72, legR: 0.035, hoof: 0.05, twoSegment: true, neck: { len: 0.38, angle: 0.4, r: 0.08 }, head: { r: 0.11, scale: [0.8, 0.85, 1.2] }, snout: { len: 0.12, r: 0.05, color: 'fur', nose: 0.025 }, ears: { kind: 'pointy', r: 0.045, h: 0.11, tilt: 0.7, color: 'fur' }, tail: { kind: 'puff', r: 0.06, y: 0.3, tip: 'belly' }, headExtras: ({ hc, hr }) => { const a = [limb([0.04, hc[1] + hr * 0.7, hc[2] - 0.02], [0.12, hc[1] + hr * 2.6, hc[2] - 0.1], 0.014, 'antler', { kind: 'cyl', r2: 0.008, seg: 4 }), limb([0.09, hc[1] + hr * 1.8, hc[2] - 0.07], [0.15, hc[1] + hr * 2.3, hc[2] + 0.04], 0.011, 'antler', { kind: 'cyl', r2: 0.006, seg: 4 })]; return [...a, ...mirror(a)]; } }),
    { fur: '#a8774a', belly: '#f2ebe0', hoof: '#2e2620', antler: '#d9c9a8' }, 'quadruped-walk', 'graze', { speed: 1.0, radius: 14 }),
  creature('rabbit', 'A rabbit with long upright ears and a cotton tail; hops and nibbles grass.', ['rabbit', 'bunny', 'hare', 'wild', 'quadruped'],
    quadruped({ L: 0.32, H: 0.2, wf: 0.95, leg: 0.06, legR: 0.03, sink: 0.45, legInsetF: 0.25, legInsetB: 0.4, neck: { len: 0.03, angle: 0.3, r: 0.07 }, head: { r: 0.07, scale: [0.95, 0.95, 1.05] }, snout: { len: 0.015, r: 0.03, color: 'muzzle', nose: 0.012 }, ears: { kind: 'long', r: 0.022, h: 0.13, tilt: 0.12 }, tail: { kind: 'puff', r: 0.04, y: 0.35, tip: 'tail' }, extras: ({ yb }) => [sph([0, yb - 0.02, -0.08], 0.11, 'fur', { scale: [1, 0.85, 1], seg: 5 })] }),
    { fur: '#a8937a', muzzle: '#efe6d8', tail: '#f6f2ea' }, 'quadruped-walk', 'graze', { speed: 0.8, radius: 6 }),
  creature('duck', 'A mallard duck: green head, white collar, orange bill and webbed feet; waddles on land and swims on ponds (anchor float). Ducklings: scale 0.5.', ['duck', 'duckling', 'mallard', 'bird', 'water', 'pond'],
    bird({ L: 0.42, H: 0.24, W: 0.22, leg: 0.06, neck: 0.1, neckAngle: 0.15, neckR: 0.045, head: 0.07, bill: { kind: 'flat', len: 0.06, r: 0.028, tilt: 0.15 }, foot: 0.05, webbed: true, breast: true, tailLen: 0.22, tailAngle: 0.7, headExtras: ({ hc }) => [cyl([0, hc[1] - 0.085, hc[2] - 0.035], 0.043, 0.014, 'collar', { seg: 8 })] }),
    { feather: '#9a8a74', breast: '#8a5a44', head: '#2f6b44', bill: '#e9a23b', legs: '#e9893b', collar: '#f4f1ea' }, 'biped-waddle', 'swim', { speed: 0.4, radius: 6 }),
  creature('goose', 'A grey-brown goose with a long black neck, white cheek and stout bill; waddles and swims.', ['goose', 'bird', 'water', 'pond', 'farm'],
    bird({ L: 0.62, H: 0.3, W: 0.28, leg: 0.1, neck: 0.3, neckAngle: 0.15, neckR: 0.035, neckColor: 'neck', head: 0.06, bill: { kind: 'flat', len: 0.065, r: 0.026, tilt: 0.1 }, foot: 0.06, webbed: true, breast: true, tailLen: 0.2, tailAngle: 0.6, headExtras: ({ hc }) => [sph([0.035, hc[1] - 0.01, hc[2] - 0.005], 0.035, 'cheek', { scale: [0.5, 1, 1], seg: 4 }), sph([-0.035, hc[1] - 0.01, hc[2] - 0.005], 0.035, 'cheek', { scale: [0.5, 1, 1], seg: 4 })] }),
    { feather: '#8f877a', breast: '#c9c1b0', head: '#2a2725', neck: '#2a2725', bill: '#2a2725', legs: '#2f2b28', cheek: '#f4f1ea' }, 'biped-waddle', 'swim', { speed: 0.45, radius: 8 }),
  creature('chicken', 'A plump brown hen with a red comb and wattle; pecks about the yard (graze).', ['chicken', 'hen', 'rooster', 'chick', 'bird', 'farm'],
    bird({ L: 0.32, H: 0.28, W: 0.22, leg: 0.11, neck: 0.08, neckAngle: 0.1, neckR: 0.06, head: 0.06, bill: { kind: 'cone', len: 0.035, r: 0.016, tilt: 0.3 }, foot: 0.05, comb: true, tailLen: 0.25, tailAngle: 1.1, tailUp: 0.35 }),
    { feather: '#a0603a', head: '#a0603a', bill: '#e8b23a', legs: '#e8b23a', comb: '#d23a2e' }, 'biped-waddle', 'graze', { speed: 0.5, radius: 5 }),
  creature('bird', 'A small songbird (robin-like, red breast) that flits between perches and flies short loops; perch slots or fly.', ['bird', 'songbird', 'robin', 'sparrow', 'wild'],
    bird({ L: 0.13, H: 0.09, W: 0.08, leg: 0.03, neck: 0.015, neckAngle: 0.3, neckR: 0.025, head: 0.04, bill: { kind: 'cone', len: 0.02, r: 0.008 }, foot: 0.02, breast: true, legR: 0.004, tailLen: 0.55, tailAngle: 0.9, tailUp: 0.25 }),
    { feather: '#7a5c45', breast: '#d8643a', head: '#7a5c45', bill: '#3a2f28', legs: '#5a4636' }, 'bird-fly', 'fly', { speed: 2.5, radius: 10, scale: [0.5, 3], components: { sound: { kind: 'birds', radius: 18, volume: 0.35, mode: 'loop' } } }),
  creature('crow', 'A glossy black crow that struts, pecks and flies off in loops over fields.', ['crow', 'raven', 'bird', 'wild'],
    bird({ L: 0.36, H: 0.16, W: 0.13, leg: 0.09, neck: 0.05, neckAngle: 0.6, neckR: 0.04, head: 0.058, bill: { kind: 'cone', len: 0.06, r: 0.018, tilt: 0.1 }, foot: 0.045, legR: 0.008, tailLen: 0.5, tailAngle: 0.25, wingColor: 'wing' }),
    { feather: '#2a2c35', head: '#24262e', wing: '#1c1d24', bill: '#4a4a52', legs: '#3a3a40' }, 'bird-fly', 'fly', { speed: 3, radius: 14 }),
  creature('seagull', 'A white seagull with grey wings and a yellow bill; glides in wide loops over water and shores.', ['seagull', 'gull', 'bird', 'sea', 'water', 'shore'],
    bird({ L: 0.44, H: 0.18, W: 0.16, leg: 0.07, neck: 0.04, neckAngle: 0.4, head: 0.06, bill: { kind: 'cone', len: 0.055, r: 0.014, tilt: 0.05 }, foot: 0.045, webbed: true, legR: 0.007, wingColor: 'wing', tailLen: 0.3, tailAngle: 0.15, tailColor: 'wing' }),
    { feather: '#f4f3ef', head: '#f4f3ef', wing: '#a9b0b6', bill: '#e9c23b', legs: '#e9a07b' }, 'bird-fly', 'fly', { speed: 3.5, radius: 18 }),
  creature('koi', 'An orange-and-white koi with whiskers that swims slowly just under a pond surface (needs water).', ['koi', 'fish', 'carp', 'water', 'pond'],
    fish({ L: 0.5, H: 0.13, W: 0.1, whiskers: true, spots: [[0.15, 0.3, 0.15, 0.55], [-0.2, 0.25, -0.1, 0.5], [0, 0.4, -0.3, 0.4]] }),
    { scales: '#f2efe8', spots: '#e8642a', fin: '#f2a37a' }, 'fish-swim', 'swim', { speed: 0.3, radius: 5, anchor: 'float' }),
  creature('fish', 'A silver-blue fish that swims in lakes and the sea, under the surface (needs water).', ['fish', 'water', 'lake', 'sea'],
    fish({ L: 0.36, H: 0.11, W: 0.07, spots: [[0, 0.35, 0.05, 0.6]] }),
    { scales: '#9fb4c0', spots: '#4f6f86', fin: '#7d93a3' }, 'fish-swim', 'swim', { speed: 0.6, radius: 8, anchor: 'float' }),
];

export { perch, quadruped, bird, fish };
