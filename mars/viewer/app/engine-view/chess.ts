// Renderer adapters only: supported board/token dimensions, no game decisions or poses.
import * as THREE from 'three';
import { CHESS_PITCH } from '../../engine/world/catalog-chess.ts';
import type { Kind } from '../../engine/games/chess-rules.ts';
import type { ItemObject, Kit } from './items.ts';
type Box = (
  color: string,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
) => THREE.Object3D;
export function chessBoardObject(box: Box) {
  const group = new THREE.Group();
  group.add(box('#765332', 0, 0, 0, 0.54, 0.018, 0.54));
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      group.add(
        box(
          (x + y) % 2 ? '#5b4734' : '#e7dcc2',
          (x - 3.5) * CHESS_PITCH,
          0.018,
          (y - 3.5) * CHESS_PITCH,
          CHESS_PITCH,
          0.002,
          CHESS_PITCH,
        ),
      );
  return group;
}
export function chessTokenObject(
  def: string,
  size: [number, number, number],
  color: string,
  kit: Kit,
): ItemObject | null {
  const match =
    /^chess-(white|black)-(pawn|knight|bishop|rook|queen|king)$/.exec(def);
  if (!match) return null;
  const kind = match[2] as Kind,
    height = size[1],
    group = new THREE.Group(),
    material = kit.mat(color);
  const add = (
    key: string,
    create: () => THREE.BufferGeometry,
    x: number,
    y: number,
    z: number,
  ) => {
    const mesh = new THREE.Mesh(kit.geo(`chess:${key}`, create), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  add(
    'base',
    () => new THREE.CylinderGeometry(0.014, 0.0175, 0.008, 16),
    0,
    0.004,
    0,
  );
  add(
    `stem:${kind}`,
    () => new THREE.CylinderGeometry(0.007, 0.012, height * 0.45, 12),
    0,
    0.008 + height * 0.225,
    0,
  );
  const headY = height - (kind === 'pawn' ? 0.009 : 0.01);
  if (kind === 'pawn' || kind === 'queen' || kind === 'bishop') {
    add(
      `head:${kind}`,
      () => new THREE.SphereGeometry(kind === 'pawn' ? 0.009 : 0.01, 12, 8),
      0,
      headY,
      0,
    );
    if (kind === 'queen')
      for (let i = 0; i < 5; i++) {
        const angle = (i * Math.PI * 2) / 5;
        add(
          'queen-crown',
          () => new THREE.SphereGeometry(0.0025, 6, 4),
          Math.cos(angle) * 0.007,
          height - 0.0025,
          Math.sin(angle) * 0.007,
        );
      }
    if (kind === 'bishop')
      add(
        'bishop-tip',
        () => new THREE.ConeGeometry(0.003, 0.009, 8),
        0,
        height - 0.0045,
        0,
      );
  } else if (kind === 'knight') {
    const head = add(
      'knight-head',
      () => new THREE.BoxGeometry(0.011, 0.025, 0.012),
      0,
      height - 0.014,
      -0.002,
    );
    head.rotation.x = -0.25;
    add(
      'knight-muzzle',
      () => new THREE.BoxGeometry(0.011, 0.008, 0.009),
      0,
      height - 0.013,
      -0.009,
    );
  } else if (kind === 'rook') {
    add(
      'rook-crown',
      () => new THREE.CylinderGeometry(0.013, 0.01, 0.013, 12),
      0,
      height - 0.0065,
      0,
    );
    for (const x of [-1, 1])
      for (const z of [-1, 1])
        add(
          'rook-tooth',
          () => new THREE.BoxGeometry(0.005, 0.005, 0.005),
          x * 0.008,
          height - 0.0025,
          z * 0.008,
        );
  } else {
    add(
      'king-head',
      () => new THREE.SphereGeometry(0.007, 10, 8),
      0,
      height - 0.016,
      0,
    );
    add(
      'king-cross-v',
      () => new THREE.BoxGeometry(0.003, 0.013, 0.003),
      0,
      height - 0.0065,
      0,
    );
    add(
      'king-cross-h',
      () => new THREE.BoxGeometry(0.01, 0.003, 0.003),
      0,
      height - 0.007,
      0,
    );
  }
  return { obj: group };
}
