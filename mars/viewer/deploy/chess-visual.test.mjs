import { chessAttention } from '../app/lab/chess.ts';
import { chessRuntime } from '../engine/scenarios/chess.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  chessBoardObject,
  chessTokenObject,
} from '../app/engine-view/chess.ts';
import { CHESS_ASSETS } from '../engine/world/catalog-chess.ts';
test('original chess board and recognizable tokens remain within their supported physical dimensions', () => {
  const geometries = new Map(),
    materials = new Map();
  const kit = {
    geo: (key, make) => {
      if (!geometries.has(key)) geometries.set(key, make());
      return geometries.get(key);
    },
    mat: (color) => {
      if (!materials.has(color))
        materials.set(color, new THREE.MeshStandardMaterial({ color }));
      return materials.get(color);
    },
  };
  const unit = kit.geo('unit', () =>
    new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  );
  const box = (color, x, y, z, sx, sy, sz) => {
    const m = new THREE.Mesh(unit, kit.mat(color));
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    return m;
  };
  const bounds = (obj, d) => {
    obj.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(obj),
      eps = 1e-6;
    assert.ok(
      b.min.x >= -d.size[0] / 2 - eps && b.max.x <= d.size[0] / 2 + eps,
      d.id + ' x',
    );
    assert.ok(
      b.min.z >= -d.size[2] / 2 - eps && b.max.z <= d.size[2] / 2 + eps,
      d.id + ' z',
    );
    assert.ok(
      b.min.y >= -eps && b.max.y <= d.size[1] + eps,
      d.id + ' y ' + b.max.y,
    );
  };
  const board = CHESS_ASSETS.find((x) => x.id === 'chess-board');
  bounds(chessBoardObject(box), board);
  for (const d of CHESS_ASSETS.filter((x) => x.category === 'item')) {
    const visual = chessTokenObject(d.id, d.size, d.color, kit);
    assert.ok(visual);
    bounds(visual.obj, d);
  }
  const count = geometries.size;
  for (let reset = 0; reset < 9; reset++) {
    chessBoardObject(box);
    for (const d of CHESS_ASSETS.filter((x) => x.category === 'item'))
      chessTokenObject(d.id, d.size, d.color, kit);
  }
  assert.equal(
    geometries.size,
    count,
    'reset does not allocate extra shared geometries',
  );
  assert.equal(
    chessTokenObject('unrecognized', [0.035, 0.065, 0.035], '#fff', kit),
    null,
  );
  for (const g of geometries.values()) g.dispose();
  for (const m of materials.values()) m.dispose();
});

test('shared chess gaze is read-only and releases a person with foreign directed control', () => {
  const rt = chessRuntime();
  assert.deepEqual(chessAttention(rt), {});
  rt.submit('chess_move', {
    actor: 'white-player',
    board: 'board',
    from: 'f2',
    to: 'f3',
    tray: 'capture-tray',
  });
  const before = rt.stateHash();
  assert.deepEqual(Object.keys(chessAttention(rt)), [
    'white-player',
    'black-player',
  ]);
  assert.equal(rt.stateHash(), before);
  const away = rt.submit('walk_to', { actor: 'black-player', x: 3, z: 3 });
  assert.notEqual(away.status, 'failed');
  const after = rt.stateHash();
  assert.deepEqual(Object.keys(chessAttention(rt)), ['white-player']);
  assert.equal(rt.stateHash(), after);
});
