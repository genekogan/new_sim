import * as T from 'three';
import { Kit, BAY, layers } from './kit';
import { GROUND } from '../studio/ambience-math';

/** Resident 2026-09-29 concept: user-supplied two plan images.
 * This is proposed design, never an occupied campus or an engineering plan.
 * Relative placements trace the close plan; metres fitted using its proposed
 * 100ft drainage line. North/image-up is assumed, camp identities unspecified.
 */
export const DRAFT_2027 = {
  drainageLength: 30.48,
  courtyardRadius: 19,
  kitchens: [
    { id: 'mit-kitchen', name: 'MIT kitchen · west', x: -34, z: -2, yaw: 0 },
    { id: 'kitchen-nw', name: 'Courtyard kitchen · northwest · unassigned', x: -22, z: -23, yaw: Math.PI / 4 },
    { id: 'kitchen-n', name: 'Courtyard kitchen · north · unassigned', x: 1, z: -33, yaw: 0 },
    { id: 'kitchen-e', name: 'Courtyard kitchen · east · unassigned', x: 34, z: 0, yaw: 0 },
    { id: 'kitchen-se', name: 'Courtyard kitchen · southeast · unassigned', x: 23, z: 24, yaw: Math.PI / 4 },
    { id: 'kitchen-s', name: 'Courtyard kitchen · south · unassigned', x: 0, z: 34, yaw: 0 },
  ],
};
const SOURCE = 'Proposed 2027: resident Sep29 post and two user-supplied plan images; fitted dimensions, no construction claim';
function rack(k: Kit, id: string, name: string, x: number, z: number, nx: number, nz: number, yaw = 0) {
  const g = k.assembly(id, name, [x, GROUND, z], yaw, SOURCE);
  k.frame(g, nx, nz, 3.048, false);
  // User asks raw materials/no paint. Keep all steel visible; no historical
  // blue/orange paint, no opaque wall/roof, no invented upper occupied floor.
  g.traverse(o => { if (o instanceof T.Mesh && o.userData.layer === layers.steel) o.material = k.mat('#899294', .65); });
  // Minimal plywood aisle on ground; its bottom sits on soil.
  k.box(g, 'raw plywood entrance strip', [1.2, .045, nz * BAY], [0, .0225, 0], '#c8b18a', layers.floor);
  return g;
}
function label(k: Kit, g: T.Group, text: string, x = 0, z = 0) {
  const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 96;
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.fillStyle = '#eef0e8'; ctx.fillRect(0, 0, 768, 96);
  ctx.fillStyle = '#293635'; ctx.font = '32px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(text, 384, 60);
  const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
  const sprite = new T.Sprite(new T.SpriteMaterial({map: texture, depthTest: false}));
  sprite.position.set(x, 4.2, z); sprite.scale.set(13, 1.625, 1);
  k.named(k.tag(g, sprite, text, layers.context, 'draft annotation'), 'draft-label');
}
export function make2027(k: Kit) {
  k.root.name = 'Mars 2027 · resident concept draft';
  const site = k.assembly('draft-site', 'Central courtyard and proposed camp sectors', [0, GROUND, 0], 0, SOURCE);
  // Subtle ground markings, not physical walls. No camp assignment invented.
  for (let i = 0; i < 72; i++) {
    const a = i * Math.PI / 36, b = (i + 1) * Math.PI / 36, r = DRAFT_2027.courtyardRadius;
    const o = k.rod(site, 'courtyard ground outline', [r * Math.cos(a), .025, r * Math.sin(a)], [r * Math.cos(b), .025, r * Math.sin(b)], .025, '#d0c5a5', layers.context);
    o.userData.walkNoCollision = true;
  }
  for (const degrees of [-150, -105, -75, 0, 30, 60, 90, 135]) {
    const a = degrees * Math.PI / 180;
    for (let r = 39; r < 96; r += 5) {
      const o = k.rod(site, 'provisional sector boundary', [r * Math.cos(a), .02, r * Math.sin(a)], [(r + 2) * Math.cos(a), .02, (r + 2) * Math.sin(a)], .02, '#a49c84', layers.context);
      o.userData.walkNoCollision = true;
    }
  }
  label(k, site, '2027 DRAFT · central courtyard');
  for (const spec of DRAFT_2027.kitchens) {
    const g = rack(k, spec.id, spec.name, spec.x, spec.z, 3, 3, spec.yaw);
    // A plain serving surface/sink marker only, no speculative appliances.
    k.box(g, 'raw kitchen counter', [BAY, .055, .65], [0, .92, -1.5*BAY + .36], '#c8b18a');
    for (const x of [-1.55, 1.55]) k.box(g, 'counter timber leg', [.065, .8925, .065], [x, .44625, -1.5*BAY + .36], '#c8b18a');
    k.box(g, 'sink location marker', [.55, .035, .45], [-.8, .965, -1.5*BAY + .36], k.mat('#929b9c', .6));
    label(k, g, spec.id === 'mit-kitchen' ? 'MIT · kitchen' : spec.name.replace('Courtyard kitchen · ', '').replace(' · unassigned', ' · kitchen?'));
  }
  const gallery = rack(k, 'mit-gallery', 'MIT gallery · western end', -87, 5.3, 3, 5);
  label(k, gallery, 'MIT · gallery');
  const cowork = rack(k, 'mit-cowork', 'MIT coworking · central strip', -60.3, 0, 11, 2);
  // Open grid carries only occasional raw timber slats, so interiors stay readable.
  label(k, cowork, 'MIT · coworking');
  // Wide plan image2 sets the separate music/auditorium ~230m southwest
  // of courtyard: use the matched kitchen-square scale between the two images.
  const music = rack(k, 'music-auditorium', 'Music / outdoor Thunder Talks · toward Bombay', -166, 164, 7, 3);
  k.box(music, 'raw outdoor stage deck', [7 * BAY, .10, 1.5], [0, .05, 1.5*BAY + .8], '#c8b18a', layers.floor);
  label(k, music, 'Music · outdoor auditorium');
  // Trace the alternating trailers behind MIT from the detailed plan.
  for (const [i, x, z, yaw] of [
    [0,-92,-22,0],[1,-88,-27,Math.PI/2],[2,-79,-29,0],[3,-74,-29,0],
    [4,-68,-33,Math.PI/2],[5,-61,-29,0],[6,-56,-29,0],[7,-48,-27,Math.PI/2],
    [8,-43,-22,0],[9,-40,-15,Math.PI/2],[10,-89,-13,0],
  ]) {
    const g = k.rv(`mit-trailer-${i+1}`, x, z, yaw, 8.4);
    g.userData.source = SOURCE; g.name = `MIT trailer placeholder ${i+1}`;
  }
  // Two equal parallel conceptual runs, not above-ground pipe routing.
  for (const [id, x, z] of [['nw', -28, -29], ['se', 32, 29]] as const) {
    const g = k.assembly(`drainage-${id}`, 'Proposed ARC chamber leach field · 100ft option', [x, GROUND, z], Math.PI/4, SOURCE);
    const length = DRAFT_2027.drainageLength;
    const strip = k.box(g, 'proposed trench footprint', [.88, .025, length], [0, .0125, 0], '#5c6058', layers.context);
    strip.userData.walkNoCollision = true;
    // Visible cutaway ribs communicate underground chambers, not actual installed equipment.
    const arch = new T.CylinderGeometry(.43, .43, 1.524, 12, 1, true, Math.PI/2, Math.PI);
    for (let i=0; i<20; i++) {
      const mesh = new T.Mesh(arch, k.mat('#3c413e', .15)); mesh.rotation.x = Math.PI/2;
      mesh.position.set(0, .02, -length/2+(i+.5)*1.524);
      k.tag(g, mesh, 'conceptual chamber cutaway', layers.context); mesh.userData.walkNoCollision = true;
    }
    label(k, g, 'Proposed drainage · 100 ft');
  }
}
