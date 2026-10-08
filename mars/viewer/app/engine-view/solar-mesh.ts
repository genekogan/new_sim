import * as THREE from 'three';

export type MeshKit = {
  mat(color: string, side?: THREE.Side): THREE.MeshStandardMaterial;
  geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry;
};

const piece = (kit: MeshKit, key: string, size: [number, number, number], color: string) => {
  const mesh = new THREE.Mesh(kit.geo(key, () => new THREE.BoxGeometry(...size)), kit.mat(color));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
};

/** Framed module: blue cell laminate on the front, pale backsheet and a junction box below. */
export function solarPanelMesh(id: string, length: number, thickness: number, width: number, kit: MeshKit): THREE.Group {
  const group = new THREE.Group();
  group.name = `module:${id}`;
  const rim = 0.027;
  const back = piece(kit, `solar-back:${id}`, [length - 2 * rim, 0.004, width - 2 * rim], '#e3e5dd');
  back.position.y = 0.004;
  group.add(back);
  const laminate = piece(kit, `solar-laminate:${id}`, [length - 2 * rim, 0.008, width - 2 * rim], '#102c4c');
  laminate.position.y = thickness - 0.007;
  group.add(laminate);
  const along = kit.geo(`solar-rim-long:${id}`, () => new THREE.BoxGeometry(length, thickness, rim));
  const across = kit.geo(`solar-rim-short:${id}`, () => new THREE.BoxGeometry(rim, thickness, width - 2 * rim));
  for (const sign of [-1, 1]) {
    const a = new THREE.Mesh(along, kit.mat('#aab6bb'));
    a.position.set(0, thickness / 2, sign * (width - rim) / 2);
    const b = new THREE.Mesh(across, kit.mat('#aab6bb'));
    b.position.set(sign * (length - rim) / 2, thickness / 2, 0);
    a.castShadow = b.castShadow = true;
    group.add(a, b);
  }
  // One instanced draw for the cell grid: 6 columns and 10/12 rows.
  const rows = length > 1.85 ? 12 : 10, cols = 6;
  const count = rows - 1 + cols - 1;
  const grid = new THREE.InstancedMesh(kit.geo(`solar-grid-line:${id}`, () => new THREE.BoxGeometry(1, 0.0015, 0.003)), kit.mat('#6b879b'), count);
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
  let i = 0;
  for (let col = 1; col < cols; col++) {
    position.set(0, thickness - 0.002, -width / 2 + rim + (width - 2 * rim) * col / cols);
    scale.set(length - 2 * rim, 1, 1);
    grid.setMatrixAt(i++, matrix.compose(position, quaternion, scale));
  }
  for (let row = 1; row < rows; row++) {
    position.set(-length / 2 + rim + (length - 2 * rim) * row / rows, thickness - 0.002, 0);
    scale.set(0.003, 1, (width - 2 * rim) / 0.003);
    grid.setMatrixAt(i++, matrix.compose(position, quaternion, scale));
  }
  grid.instanceMatrix.needsUpdate = true;
  // The cell grid lies 1.75 mm over the laminate: pull it forward in depth so it never z-fights (speckle) at range.
  const gm = grid.material as THREE.MeshStandardMaterial;
  gm.polygonOffset = true; gm.polygonOffsetFactor = -2; gm.polygonOffsetUnits = -4;
  group.add(grid);
  const junction = piece(kit, `solar-junction:${id}`, [0.16, 0.035, 0.11], '#242b32');
  junction.position.set(0, -0.014, 0);
  group.add(junction);
  return group;
}

/** C-channel extrusion for the standalone panel-rail entity; the caller must route that def here. */
export function solarRailMesh(length: number, kit: MeshKit): THREE.Group {
  const group = new THREE.Group();
  group.name = 'panel rail profile';
  const shape = new THREE.Shape();
  shape.moveTo(-0.02, 0); shape.lineTo(0.02, 0); shape.lineTo(0.02, 0.04);
  shape.lineTo(0.012, 0.04); shape.lineTo(0.012, 0.009);
  shape.lineTo(-0.012, 0.009); shape.lineTo(-0.012, 0.04); shape.lineTo(-0.02, 0.04);
  shape.closePath();
  const geo = kit.geo(`solar-rail-profile:${length}`, () => new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-length / 2, 0, 0));
  const body = new THREE.Mesh(geo, kit.mat('#adb6ba'));
  body.castShadow = body.receiveShadow = true;
  group.add(body);
  return group;
}

/** Two rear risers for an installed tilted mount; install state must come from the caller. */
export function solarTiltLegs(length: number, rise: number, kit: MeshKit): THREE.Group {
  const group = new THREE.Group();
  group.name = 'tilt risers';
  for (const sign of [-1, 1]) {
    const leg = piece(kit, `solar-tilt-leg:${rise}`, [0.025, rise, 0.025], '#a7afb4');
    leg.position.set(sign * length * 0.4, -rise / 2, 0);
    group.add(leg);
  }
  return group;
}
