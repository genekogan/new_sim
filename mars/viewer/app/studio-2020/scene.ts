import * as THREE from 'three';
import { GROUND } from '../studio/ambience-math';

// Late-March 2020 evidence model. Coordinates are a photographic fit, not a survey.
// One unit is one metre. The observed racks used dark frames and red beams.
const BAY = 3.6576; // 12 ft rack beam
const plywood = new THREE.MeshStandardMaterial({ color: 0xb79469, roughness: 0.92 });
const plywoodDark = new THREE.MeshStandardMaterial({ color: 0x806043, roughness: 0.96 });
const steel = new THREE.MeshStandardMaterial({ color: 0x24292c, metalness: 0.55, roughness: 0.57 });
const beamRed = new THREE.MeshStandardMaterial({ color: 0x9c303a, metalness: 0.48, roughness: 0.62 });
const beamOrange = new THREE.MeshStandardMaterial({ color: 0xb95737, metalness: 0.48, roughness: 0.58 });
const white = new THREE.MeshStandardMaterial({ color: 0xc9c8bf, metalness: 0.15, roughness: 0.75 });
const canvasWhite = new THREE.MeshStandardMaterial({ color: 0xd7d7d0, roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.88, depthWrite: false });
const pink = new THREE.MeshStandardMaterial({ color: 0xb51d65, roughness: 0.9, side: THREE.DoubleSide });
const black = new THREE.MeshStandardMaterial({ color: 0x171b1c, roughness: 0.8 });
const scrim = new THREE.MeshStandardMaterial({ color: 0x171d20, roughness: 1, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false });
const glass = new THREE.MeshStandardMaterial({ color: 0x35464c, metalness: 0.1, roughness: 0.25 });
const rubber = new THREE.MeshStandardMaterial({ color: 0x171717, roughness: 0.98 });
const glowing = new THREE.MeshStandardMaterial({ color: 0xe9eff1, emissive: 0xd9e8ee, emissiveIntensity: 1.5 });
const boxCache = new Map<string, THREE.BoxGeometry>();
function box(parent: THREE.Object3D, name: string, size: [number, number, number], position: [number, number, number], material: THREE.Material, cast = true) {
  const key = size.join(',');
  let geometry = boxCache.get(key);
  if (!geometry) { geometry = new THREE.BoxGeometry(...size); boxCache.set(key, geometry); }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name; mesh.position.set(...position);
  mesh.castShadow = cast; mesh.receiveShadow = true;
  parent.add(mesh); return mesh;
}
function rod(parent: THREE.Object3D, name: string, a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material) {
  const delta = b.clone().sub(a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 6), material);
  mesh.name = name; mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  mesh.castShadow = true; parent.add(mesh); return mesh;
}
function group(root: THREE.Object3D, id: string, title: string, position: [number, number, number], confidence: 'high' | 'medium' | 'low', source: string) {
  const g = new THREE.Group(); g.name = title; g.position.set(...position);
  g.userData = { id, title, confidence, source };
  root.add(g); return g;
}
function upright(g: THREE.Object3D, x: number, z: number, height = 4.88, depth = 0.9) {
  // Two posts and the triangulated welded bracing of a reusable pallet-rack upright.
  for (const dz of [-depth / 2, depth / 2]) box(g, 'rack upright', [0.075, height, 0.075], [x, height / 2, z + dz], steel);
  for (let i = 0; i < Math.floor(height / 0.7); i++) {
    const y = 0.35 + i * 0.7;
    rod(g, 'upright diagonal', new THREE.Vector3(x, y - 0.31, z - depth / 2), new THREE.Vector3(x, y + 0.31, z + depth / 2), 0.014, steel);
  }
  for (let y = 0.3; y < height; y += 1.4) box(g, 'upright crossbar', [0.04, 0.04, depth], [x, y, z], steel);
}
function rack(g: THREE.Object3D, bays: number, depthRows: number, height: number, levels: number[], depth = 1.1, beamMaterial = beamRed) {
  const width = bays * BAY;
  for (let r = 0; r <= depthRows; r++) for (let b = 0; b <= bays; b++) upright(g, b * BAY - width / 2, r * depth, height, 0.8);
  for (let r = 0; r <= depthRows; r++) for (let b = 0; b < bays; b++) for (const y of levels) {
    box(g, '12 ft rack beam', [BAY, 0.11, 0.08], [(b + 0.5) * BAY - width / 2, y, r * depth], beamMaterial);
  }
}
function panel(g: THREE.Object3D, name: string, w: number, h: number, x: number, z: number, y = h / 2, material = plywood) {
  return box(g, name, [w, h, 0.055], [x, y, z], material);
}
/** A road wheel rolling along the vehicle's x: the tire ring in the group's x–y plane, the hub's axle along z (W46:
 *  both were turned 90° about y, so the tires stood across the direction of travel). */
function wheel(g: THREE.Object3D, x: number, y: number, z: number, radius: number) {
  const t = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.24, 6, 14), rubber);
  t.name = 'RV tire'; t.position.set(x, y, z); t.castShadow = true; g.add(t);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.31, radius * 0.31, 0.08, 10), steel);
  hub.name = 'RV wheel hub'; hub.rotation.x = Math.PI / 2; hub.position.set(x, y, z); g.add(hub);
  return t;
}
function canvasTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w = 512, h = 512) {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!; draw(ctx, w, h);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
export function flowerMural() {
  // Vector interpretation of the large magenta tessellated flower on the container end.
  return canvasTexture((c, w, h) => {
    c.fillStyle = '#e3e0d3'; c.fillRect(0, 0, w, h);
    c.translate(w / 2, h / 2);
    for (let ring = 5; ring >= 1; ring--) {
      const petals = ring * 6 + 2, inner = ring * 33 - 17, outer = ring * 39 + 19;
      for (let i = 0; i < petals; i++) {
        const a = i * Math.PI * 2 / petals + ring * 0.19;
        c.save(); c.rotate(a); c.beginPath();
        c.moveTo(inner, -9); c.quadraticCurveTo((inner + outer) / 2, -26, outer, -5);
        c.quadraticCurveTo(outer + 9, 13, inner, 16); c.closePath();
        c.fillStyle = ring <= 2 ? '#ba2055' : '#9b1353'; c.fill(); c.restore();
      }
    }
    const gradient = c.createRadialGradient(0, 0, 2, 0, 0, 58);
    gradient.addColorStop(0, '#fce7a6'); gradient.addColorStop(0.45, '#d1b35f'); gradient.addColorStop(1, '#a53458');
    c.fillStyle = gradient; c.beginPath(); c.arc(0, 0, 45, 0, Math.PI * 2); c.fill();
  });
}
const TIRE_TUBE = 0.105, TIRE_SIDES = 6;
// The 6-sided tube's flat underside lies r·cos(30°) below the torus plane: a tire lying flat rests with its centre that high.
const TIRE_REST = TIRE_TUBE * Math.cos(Math.PI / TIRE_SIDES);
const UP = new THREE.Vector3(0, 1, 0);
/** A tire lying on a surface: `contact` is the surface point under its centre, `normal` the surface normal there
 *  (both in `g`'s frame). The torus axis follows the normal and the tread's underside touches the surface. */
function tire(g: THREE.Object3D, contact: THREE.Vector3, radius: number, normal = UP) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, TIRE_TUBE, TIRE_SIDES, 12), rubber);
  mesh.quaternion.setFromUnitVectors(UP, normal).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
  mesh.position.copy(contact).addScaledVector(normal, TIRE_REST); mesh.castShadow = true; g.add(mesh);
}
function fabricWall(g: THREE.Object3D, name: string, x: number, z0: number, z1: number, top: number, material: THREE.Material) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    x, 0.2, z0, x, top, z0, x, top - 0.18, z1,
    x, 0.2, z0, x, top - 0.18, z1, x, 0.2, z1,
  ], 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.castShadow = true; g.add(mesh);
}
function makePortal(root: THREE.Object3D) {
  const g = group(root, 'portal', 'Portal / climbing decks', [-9, 0, 0], 'high', 'DJI_0094 March 9 at 193–398s; March 17 flythrough; Portal ground photographs');
  const halfWidth = BAY * 1.5, halfDepth = BAY;
  const climbingTexture = new THREE.TextureLoader().load('/modular/textures/kitchen-plywood-sample.jpg');
  climbingTexture.colorSpace = THREE.SRGBColorSpace;
  const climbingPlywood = new THREE.MeshStandardMaterial({ color: 0xd6bda0, map: climbingTexture, roughness: 0.9 });
  // Three 12-foot bays across and two deep: the middle is the TV aisle, with decks on both sides.
  for (let ix = 0; ix <= 3; ix++) for (let iz = 0; iz <= 2; iz++)
    upright(g, (ix - 1.5) * BAY, (iz - 1) * BAY, ix === 0 ? 4.05 : ix === 3 ? 3.06 : 4.8768, 0.91);
  for (let iz = 0; iz <= 2; iz++) for (let ix = 0; ix < 3; ix++) for (const y of [0.18, 2.42])
    box(g, '12 ft rack beam', [BAY, 0.11, 0.085], [(ix - 1) * BAY, y, (iz - 1) * BAY], beamRed);
  for (let iz = 0; iz <= 2; iz++) box(g, 'raised center cross beam', [BAY, 0.11, 0.085], [0, 4.63, (iz - 1) * BAY], beamRed);
  for (let ix = 0; ix <= 3; ix++) for (let iz = 0; iz < 2; iz++) for (const y of [0.18, 2.42])
    box(g, '12 ft cross beam', [0.085, 0.11, BAY], [(ix - 1.5) * BAY, y, (iz - 0.5) * BAY], beamRed);
  for (let ix = 1; ix <= 2; ix++) for (let iz = 0; iz < 2; iz++)
    box(g, 'raised center length beam', [0.085, 0.11, BAY], [(ix - 1.5) * BAY, 4.63, (iz - 0.5) * BAY], beamRed);
  for (const side of [-1, 1]) {
    for (let iz = 0; iz < 2; iz++)
      box(g, 'plywood ground side deck', [BAY - 0.1, 0.07, BAY - 0.1], [side * BAY, 0.24, (iz - 0.5) * BAY], plywoodDark);
    // March 17 frontal footage and the ground views show long stepped side bays,
    // ascending from the public frontage to rear landings instead of a mezzanine slab.
    const count = 7, run = 2 * halfDepth / count, rise = 2.22 / count;
    for (let step = 0; step < count; step++) {
      const top = 0.28 + (step + 1) * rise;
      const z = halfDepth - (step + 0.5) * run;
      box(g, 'side stair plywood tread', [BAY - 0.14, 0.07, run - 0.018], [side * BAY, top - 0.035, z], plywood);
      const riser = box(g, 'side stair timber riser', [BAY - 0.14, rise - 0.018, 0.05], [side * BAY, top - rise / 2, z + run / 2 - 0.035], plywoodDark);
      riser.userData.walkNoCollision = true;
    }
    for (const edge of [-1, 1]) {
      const x = side * BAY + edge * (BAY / 2 - 0.16);
      rod(g, 'side stair sloping stringer', new THREE.Vector3(x, 0.25, halfDepth - 0.1), new THREE.Vector3(x, 2.5, -halfDepth + 0.1), 0.045, beamRed);
    }
  }
  box(g, 'Portal aisle plywood floor', [BAY - 0.08, 0.075, 2 * BAY - 0.1], [0, 0.24, 0], plywoodDark);
  box(g, 'dark ceiling above the TV aisle', [BAY - 0.1, 0.07, 2 * BAY - 0.1], [0, 2.49, 0], plywoodDark);
  box(g, 'raised center rooftop deck', [BAY - 0.12, 0.07, 2 * BAY - 0.13], [0, 4.57, 0], plywood);
  const screenMaterials = Array.from({ length: 12 }, (_, index) => {
    const texture = new THREE.TextureLoader().load(`/2020/screens/portal-screen-${String(index).padStart(2, '0')}.webp`);
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: THREE.DoubleSide });
  });
  const screenGeometry = new THREE.PlaneGeometry(0.53, 0.3);
  // Three rows of live displays, using crops from the photographed Portal wall.
  for (const side of [-1, 1]) for (let col = 0; col < 12; col++) for (let row = 0; row < 3; row++) {
    const z = (col - 5.5) * 0.57, y = 0.67 + row * 0.59, x = side * (BAY / 2 - 0.12);
    box(g, 'TV bezel', [0.075, 0.36, 0.57], [x, y, z], black);
    const display = new THREE.Mesh(screenGeometry, screenMaterials[row * 4 + col % 4]);
    display.name = 'Portal TV screen'; display.position.set(x - side * 0.041, y, z);
    display.rotation.y = -side * Math.PI / 2;
    g.add(display);
  }
  // The climbing panels cover the entire outer side, within the supporting rack's measured bounds.
  for (let iz = 0; iz < 6; iz++) for (let row = 0; row < 2; row++) {
    const z = (iz - 2.5) * (BAY / 3), h = row === 0 ? 2.05 : 1.85;
    const y = row === 0 ? 1.055 : 3.0;
    box(g, '4 ft plywood climbing sheet', [0.07, h, BAY / 3 - 0.012], [-halfWidth - 0.04, y, z], climbingPlywood);
  }
  const holdColors = [0x948575, 0xb0a18b, 0x77736a, 0xc3ab86];
  const holdMats = holdColors.map((color) => new THREE.MeshStandardMaterial({ color }));
  const tapeMats = [0x365f9c, 0xc94737, 0xd79b28, 0x5a7f66].map((color) => new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide }));
  const holdGeometries = [0.061, 0.076, 0.09].map((r) => new THREE.DodecahedronGeometry(r, 0));
  for (let i = 0; i < 66; i++) {
    const y = 0.42 + (i % 11) * 0.31, z = -3.25 + Math.floor(i / 11) * 1.29 + ((i % 2) * 0.17);
    const hold = new THREE.Mesh(holdGeometries[i % 3], holdMats[i % 4]);
    hold.name = 'climbing hold'; hold.position.set(-halfWidth - 0.095, y, z); g.add(hold);
    if (i % 3 !== 0) box(g, 'route tape tag', [0.005, 0.028, 0.035], [-halfWidth - 0.083, y - 0.09, z + 0.03], tapeMats[i % 4], false);
  }
  box(g, 'pink climbing crash mat', [1.4, 0.16, 4.4], [-halfWidth - 0.8, 0.12, 0], pink);
  fabricWall(g, 'magenta outer curtain', -halfWidth + 0.11, -halfDepth + 0.08, -halfDepth + 2.15, 2.4, pink);
  fabricWall(g, 'magenta right rear curtain', halfWidth - 0.11, -halfDepth + 0.08, -halfDepth + 2.15, 2.4, pink);
  fabricWall(g, 'black aisle scrim left', -BAY / 2, -halfDepth + 0.05, halfDepth - 0.05, 2.36, scrim);
  fabricWall(g, 'black aisle scrim right', BAY / 2, -halfDepth + 0.05, halfDepth - 0.05, 2.36, scrim);
  // The blue rain-day tarps and their ballast tires are absent in the usual built state.
  return g;
}
function makeContainer(root: THREE.Object3D) {
  const g = group(root, 'container', 'Solar container and mural', [1.5, 0, 0], 'high', 'March 17 flythrough; March 9 DJI_0094 at 193–398s');
  g.rotation.y = -Math.PI / 2;
  const L = 6.06, W = 2.44, H = 2.59;
  box(g, 'container floor', [L, 0.09, W], [0, 0.06, 0], steel);
  box(g, 'container roof', [L, 0.09, W], [0, H, 0], white);
  box(g, 'container north wall', [L, H, 0.06], [0, H / 2, -W / 2], white);
  box(g, 'container south wall', [L, H, 0.06], [0, H / 2, W / 2], white);
  box(g, 'container west wall', [0.06, H, W], [-L / 2, H / 2, 0], white);
  box(g, 'container east wall', [0.06, H, W], [L / 2, H / 2, 0], white);
  for (let x = -L / 2 + 0.18; x < L / 2; x += 0.28) for (const z of [-W / 2 - 0.04, W / 2 + 0.04])
    box(g, 'corrugated rib', [0.035, H - 0.12, 0.07], [x, H / 2, z], white, false);
  const mural = new THREE.MeshBasicMaterial({ map: flowerMural(), side: THREE.DoubleSide });
  const art = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), mural);
  art.name = 'magenta flower end mural'; art.position.set(L / 2 + 0.04, 1.29, 0); art.rotation.y = Math.PI / 2; g.add(art);
  for (let i = 0; i < 4; i++) {
    box(g, 'solar panel frame', [1.3, 0.045, 0.76], [-2.05 + i * 1.38, 2.77, -0.5], steel);
    box(g, 'solar panel', [1.22, 0.015, 0.68], [-2.05 + i * 1.38, 2.8, -0.5], glass);
  }
  // ballast on the roof beside the panels: resting on the roof box's top face
  for (let x = -2.3; x <= 2.3; x += 1.15) tire(g, new THREE.Vector3(x, H + 0.09 / 2, 0.75), 0.25);
  return g;
}
function makeCanopy(root: THREE.Object3D) {
  const g = group(root, 'canopy', 'White tarp workshop / gathering space', [6.6, 0, 0], 'medium', 'March 17 flythrough at 7–17s; March 9 DJI_0094 at 193–398s');
  const near = -3.82, far = 3.75, front = 3.15, back = -3.15;
  // A low lean-to tied to the container, with its outer edge guyed down near ground level.
  const positions: number[] = [], indices: number[] = [], rows = 12;
  const tarpY = (u: number, v: number) => 3.02 - u * 1.95 - Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * 0.19;
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= rows; i++) {
    const u = i / rows, v = j / rows;
    positions.push(near + (far - near) * u, tarpY(u, v), back + (front - back) * v);
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < rows; i++) {
    const a = j * (rows + 1) + i, b = a + 1, c = a + rows + 1;
    indices.push(a, c, b, b, c, c + 1);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setIndex(indices); geo.computeVertexNormals();
  const tarp = new THREE.Mesh(geo, canvasWhite); tarp.name = 'sloping white tarp roof'; tarp.castShadow = true; tarp.receiveShadow = true; g.add(tarp);
  for (const z of [back, 0, front]) {
    rod(g, 'tarp ridge beam', new THREE.Vector3(near, 3.02, z), new THREE.Vector3(far, 1.07, z), 0.035, beamRed);
    box(g, 'inner canopy post', [0.075, 2.9, 0.075], [near + 0.1, 1.48, z], steel);
    box(g, 'outer canopy post', [0.06, 1.1, 0.06], [far - 0.08, 0.57, z], steel);
  }
  const platform = box(g, 'workshop plywood platform', [5.8, 0.08, 5.8], [-0.43, 0.1, 0], plywoodDark);
  // the workshop furniture stands on the platform's top face (W46: legs started 7–10 cm inside it, bins hovered 1.5 cm)
  const floor = platform.position.y + 0.08 / 2;
  panel(g, 'rear workshop plywood wall', 5.8, 2.38, -0.43, back + 0.09, 1.28);
  const worktop = box(g, 'worktable', [2.0, 0.08, 0.85], [-0.8, 0.78, 0.9], plywood), under = worktop.position.y - 0.08 / 2;
  for (const x of [-1.6, 0]) for (const z of [0.58, 1.22]) box(g, 'table leg', [0.08, under - floor, 0.08], [x, (under + floor) / 2, z], plywoodDark);
  // ballast tires down the sloping tarp's back edge, lying on (and tilted with) the tarp surface
  const tarpAt = (x: number, z: number) => tarpY((x - near) / (far - near), (z - back) / (front - back));
  for (let i = 0; i < 8; i++) {
    const x = near + 0.5 + i * 0.88, z = back + 0.4, e = 0.01;
    const normal = new THREE.Vector3(-(tarpAt(x + e, z) - tarpAt(x - e, z)) / (2 * e), 1, -(tarpAt(x, z + e) - tarpAt(x, z - e)) / (2 * e)).normalize();
    tire(g, new THREE.Vector3(x, tarpAt(x, z), z), 0.2, normal);
  }
  // Ground photos IMG_3864 and 9-2 show an open workshop/cooking counter.
  const counterUnder = box(g, 'rear work counter', [4.8, 0.06, 0.66], [-.45, .91, back+.58], plywood).position.y - 0.06 / 2;
  for(const x of [-2.5,-.5,1.5])box(g, 'counter leg', [.07,counterUnder-floor,.07],[x,(counterUnder+floor)/2,back+.58],steel);
  box(g, 'flat cooking griddle', [1.1,.09,.54],[-1.8,.99,back+.58],black);
  for(let i=0;i<6;i++)box(g,'workshop storage bin',[.36,.25,.43],[-2.4+i*.65,floor+.25/2,back+.58],i%2?white:plywoodDark);
  for(let i=0;i<5;i++)box(g,'counter supply bottle',[.09,.24,.09],[.2+i*.2,1.06,back+.58],i%2?white:glass);
  return g;
}
function makeForest(root: THREE.Object3D) {
  const g = group(root, 'forest', 'The Forest rack installation', [29, 0, -5.5], 'high', 'March 9 DJI_0094 flyover; March 30 DJI_0104 night; Forest photographs');
  rack(g, 3, 3, 5.7912, [1.12, 3.04], 1.15, beamOrange);
  // Several bright horizontal bars are visible in the March 30 night aerial.
  for (let row = 0; row < 4; row++) for (let b = 0; b < 3; b++)
    box(g, 'Forest LED strip', [BAY - 0.19, 0.035, 0.045], [(b + 0.5) * BAY - 1.5 * BAY, 3.0, row * 1.15 + 0.42], glowing, false);
  // Translucent projection scrims are visible in IMG_6035 and IMG_5273.
  const projectionScrim = new THREE.MeshStandardMaterial({color:0xc2d3d5,roughness:1,side:THREE.DoubleSide,transparent:true,opacity:.22,depthWrite:false});
  for(const end of [-1,1]){
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(3.4,2.7),projectionScrim);
    screen.name='Forest projection scrim';screen.position.set(end*1.5*BAY,1.7,1.725);screen.rotation.y=Math.PI/2;g.add(screen);
  }
  return g;
}
function makeGeodesic(root: THREE.Object3D) {
  const g = group(root, 'geodesic', 'Open geodesic sphere', [-1, 0, 17], 'high', 'March 4 DJI_0079 aerial; March 9 DJI_0094 flyover');
  const ico = new THREE.IcosahedronGeometry(2.1, 1);
  const edges = new THREE.EdgesGeometry(ico);
  const mesh = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x363b3c }));
  mesh.position.y = 2.1; g.add(mesh);
  const positions=ico.getAttribute('position'), triangles:number[]=[];
  for(let i=0;i<positions.count;i+=3){const z=(positions.getZ(i)+positions.getZ(i+1)+positions.getZ(i+2))/3;if(z<-.15)for(let j=0;j<3;j++)triangles.push(positions.getX(i+j),positions.getY(i+j),positions.getZ(i+j));}
  const panels=new THREE.BufferGeometry();panels.setAttribute('position',new THREE.Float32BufferAttribute(triangles,3));panels.computeVertexNormals();const face=new THREE.Mesh(panels,canvasWhite);face.name='geodesic translucent panels';face.position.y=2.1;g.add(face);ico.dispose();
  return g;
}
function makeTent(root: THREE.Object3D) {
  const g = group(root, 'tent', 'White conical camp tent', [-21, 0, -52], 'medium', 'March 4 DJI_0079 aerial; March 9 DJI_0094 at 375s');
  const cone = new THREE.Mesh(new THREE.ConeGeometry(2.5, 2.8, 12), canvasWhite);
  cone.position.y = 1.65; cone.castShadow = true; g.add(cone);
  box(g, 'tent skirt', [3.6, 0.55, 3.6], [0, 0.3, 0], canvasWhite);
  for (let a = 0; a < 8; a++) {
    const angle = a * Math.PI / 4;
    rod(g, 'tent guy line', new THREE.Vector3(0, 3.03, 0), new THREE.Vector3(Math.cos(angle) * 3.6, 0.04, Math.sin(angle) * 3.6), 0.009, steel);
  }
  return g;
}
function makeTrees(root: THREE.Object3D) {
  const g = group(root, 'trees', 'desert tree row', [-26, 0, 15], 'medium', 'March 19–20 Trees ground photographs');
  const trunk = new THREE.MeshStandardMaterial({ color: 0x6d5947, roughness: 1 });
  for (let i = 0; i < 5; i++) {
    const x = i * 3.4, h = 1.7 + (i % 3) * 0.35;
    rod(g, 'young tree trunk', new THREE.Vector3(x, 0.02, 0), new THREE.Vector3(x + 0.09, h, 0), 0.035, trunk);
    for (let j = 0; j < 5; j++) {
      const a = j * Math.PI * 2 / 5 + i * 0.3;
      const start = new THREE.Vector3(x + 0.05, h * (0.45 + j * 0.09), 0);
      const end = new THREE.Vector3(x + Math.cos(a) * (0.35 + j * 0.08), h + 0.2 + j * 0.08, Math.sin(a) * (0.3 + j * 0.05));
      rod(g, 'leafless branch', start, end, 0.009, trunk);
    }
  }
  return g;
}
function makeRV(root: THREE.Object3D, id: string, position: [number, number, number], length: number, rotation: number, variant = 0) {
  const g = group(root, id, 'RV camp vehicle', position, 'medium', 'March 4 DJI_0079 aerial; March 9 DJI_0094 at 375s');
  g.rotation.y = rotation;
  const body = variant === 2 ? black : variant === 1 ? white : new THREE.MeshStandardMaterial({ color: 0xd8d6c9 });
  box(g, 'vehicle shell', [length, 2.38, 2.25], [0, 1.43, 0], body);
  const tires: THREE.Mesh[] = [];
  box(g, 'front windscreen', [0.08, 0.82, 1.72], [length / 2 + 0.05, 1.9, 0], glass);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) box(g, 'RV window', [0.7, 0.45, 0.015], [-length * 0.26 + i * length * 0.22, 1.9, side * 1.14], glass, false);
    tires.push(wheel(g, -length * 0.31, 0.4, side * 1.17, 0.39), wheel(g, length * 0.29, 0.4, side * 1.17, 0.39));
  }
  // stand on the studio ground: the lowest tire vertex (in the group's frame; the group only turns about y) on GROUND
  g.updateMatrixWorld(true);
  const toGroup = new THREE.Matrix4().copy(g.matrixWorld).invert(), v = new THREE.Vector3();
  let low = Infinity;
  for (const t of tires) { const p = t.geometry.attributes.position; for (let i = 0; i < p.count; i++) low = Math.min(low, v.fromBufferAttribute(p, i).applyMatrix4(t.matrixWorld).applyMatrix4(toGroup).y); }
  g.position.y = GROUND - low;
  return g;
}
function makeMCDA(root: THREE.Object3D) {
  const g = group(root, 'mcda', 'MCDA plywood shack', [39, 0, -1], 'low', 'MCDA ground photographs; March 18 DJI_0102 dusk footage');
  box(g, 'MCDA floor', [3.4, 0.13, 3.1], [0, 0.1, 0], plywoodDark);
  for (const z of [-1.52, 1.52]) panel(g, 'MCDA plywood wall', 3.4, 2.58, 0, z, 1.39, plywood);
  for (const x of [-1.68, 1.68]) box(g, 'MCDA side wall', [0.06, 2.58, 3.1], [x, 1.39, 0], plywood);
  box(g, 'MCDA roof', [3.6, 0.12, 3.35], [0, 2.74, 0], plywoodDark);
  box(g, 'serving window void', [1.45, 1.05, 0.075], [0.38, 1.55, 1.57], black);
  box(g, 'bar counter', [1.8, 0.12, 0.65], [0.38, 0.96, 1.73], plywoodDark);
  const neon = new THREE.MeshStandardMaterial({ color: 0x53f06e, emissive: 0x36ea65, emissiveIntensity: 1.7 });
  box(g, 'green bar light', [1.25, 0.045, 0.045], [0.38, 2.1, 1.63], neon, false);
  const graffiti = canvasTexture((c, w, h) => {
    c.fillStyle = '#b39066'; c.fillRect(0, 0, w, h);
    let seed = 25; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 27; i++) {
      c.strokeStyle = ['#1b2331', '#152f54', '#421f31'][i % 3]; c.lineWidth = 15 + random() * 40; c.lineCap = 'round';
      const x = random() * w, y = random() * h;
      c.beginPath(); c.moveTo(x, y); c.bezierCurveTo(x + random() * 110 - 55, y - 120, x + random() * 170 - 85, y + 100, x + random() * 150 - 75, y + 80); c.stroke();
    }
  });
  const mural = new THREE.Mesh(new THREE.PlaneGeometry(3.02, 2.55), new THREE.MeshBasicMaterial({ map: graffiti }));
  mural.name = 'painted MCDA wall'; mural.position.set(-1.72, 1.39, 0); mural.rotation.y = -Math.PI / 2; g.add(mural);
  const open = canvasTexture((c, w, h) => { c.fillStyle = '#101b18'; c.fillRect(0, 0, w, h); c.fillStyle = '#92eeac'; c.font = 'bold 170px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('OPEN', w / 2, h / 2); }, 512, 256);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.28), new THREE.MeshBasicMaterial({ map: open }));
  sign.name = 'OPEN sign'; sign.position.set(1.03, 2.34, 1.58); g.add(sign);
  return g;
}
function makeBoundary(root: THREE.Object3D) {
  const g = group(root, 'site', 'Desert site and boundary', [0, 0, 0], 'medium', 'March 4 DJI_0079 aerial');
  // In the aerial, loose tires mark a very broad, incomplete oval of ground.
  for (let i = 0; i < 66; i++) {
    const a = i * Math.PI * 2 / 66;
    if (i > 47 && i < 54) continue;
    tire(g, new THREE.Vector3(Math.cos(a) * 47 + 4, GROUND, Math.sin(a) * 32 - 8), 0.28); // lying on the studio ground (y = GROUND)
  }
  for (let i = 0; i < 4; i++) {
    const booth = group(g, 'toilet-' + i, 'Blue portable toilet', [37 + i * 1.12, 0, -35], 'high', 'March 4 DJI_0079 aerial');
    const blue = new THREE.MeshStandardMaterial({ color: 0x35738d, roughness: 0.92 });
    const body = box(booth, 'portable toilet body', [0.95, 2.1, 1.0], [0, 1.08, 0], blue);
    booth.position.y = GROUND - (body.position.y - 2.1 / 2); // the booth's base on the studio ground (W46; was 19 cm up)
    box(booth, 'portable toilet roof', [1.06, 0.12, 1.08], [0, 2.2, 0], blue);
    box(booth, 'door', [0.72, 1.73, 0.025], [0, 1.0, 0.51], steel);
  }
  // Sparse desert scrub; deterministic instancing avoids hundreds of draw calls.
  const scrub = new THREE.MeshStandardMaterial({ color: 0x8f8968, roughness: 1 });
  const geometry = new THREE.ConeGeometry(0.24, 0.25, 5);
  const instanced = new THREE.InstancedMesh(geometry, scrub, 220);
  const dummy = new THREE.Object3D(); let seed = 9072020;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 220; i++) {
    const x = (rand() - 0.5) * 230, z = (rand() - 0.5) * 190;
    dummy.position.set(x, 0, z); dummy.rotation.y = rand() * Math.PI * 2; dummy.scale.setScalar(0.45 + rand() * 1.4);
    dummy.updateMatrix(); instanced.setMatrixAt(i, dummy.matrix);
  }
  instanced.name = 'sparse desert scrub'; g.add(instanced);
  return g;
}
export type SiteFeature = { id: string; title: string; confidence: 'high' | 'medium' | 'low'; source: string; object: THREE.Object3D };
export function createBrahman2020Scene() {
  const root = new THREE.Group(); root.name = 'Brahman 2020 · late March evidence reconstruction';
  makeBoundary(root);
  makePortal(root); makeContainer(root); makeCanopy(root); makeForest(root); makeGeodesic(root); makeTent(root); makeMCDA(root); makeTrees(root);
  // The camp is a loose inward-facing ring well beyond the public site's tire line.
  makeRV(root, 'rv-1', [-8, 0, -55], 6.7, 0.19);
  makeRV(root, 'rv-2', [1, 0, -62], 7.5, 1.1, 2);
  makeRV(root, 'rv-3', [15, 0, -58], 6.4, 2.15);
  makeRV(root, 'rv-4', [18, 0, -49], 7.1, 3.02, 1);
  makeRV(root, 'rv-5', [5, 0, -45], 6.6, -1.23);
  makeRV(root, 'rv-6', [-8, 0, -45], 5.4, -0.2, 1);
  const features: SiteFeature[] = [];
  root.traverse((object) => {
    if (object.userData.id) features.push({ ...object.userData as Omit<SiteFeature, 'object'>, object });
  });
  const dispose = () => {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    root.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        geometries.add(object.geometry);
        const ms = Array.isArray(object.material) ? object.material : [object.material];
        for (const m of ms) materials.add(m);
      }
    });
    for (const m of materials) {
      const map = (m as THREE.MeshBasicMaterial).map; if (map) textures.add(map);
      m.dispose();
    }
    for (const t of textures) t.dispose();
    for (const g of geometries) g.dispose();
  };
  return { root, features, dispose };
}
