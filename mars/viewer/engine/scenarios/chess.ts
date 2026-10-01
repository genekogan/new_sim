// Hypothetical tabletop game. Ordinary item transfers must prove the physical binding first.
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { Spatial } from '../spatial/service.ts';
import { READING_SCENE } from './reading.ts';
import { emptyWorld, addAll, human, FIXTURE } from '../world/factory.ts';
import { itemEntity, placeOnSlot, surfaceSlot } from '../items/model.ts';
import type { Entity } from '../world/types.ts';
import { rot2 } from '../core/math.ts';
import type { Position, Kind, Color } from '../games/chess-rules.ts';
export function openingPosition(): Position {
  const pieces: Position['pieces'] = [],
    row: Kind[] = [
      'rook',
      'knight',
      'bishop',
      'queen',
      'king',
      'bishop',
      'knight',
      'rook',
    ];
  for (const color of ['white', 'black'] as Color[])
    for (let x = 0; x < 8; x++) {
      const file = String.fromCharCode(97 + x),
        back = file + (color === 'white' ? 1 : 8),
        front = file + (color === 'white' ? 2 : 7);
      pieces.push(
        { id: `${color}-${row[x]}-${back}`, color, kind: row[x], square: back },
        { id: `${color}-pawn-${front}`, color, kind: 'pawn', square: front },
      );
    }
  return { pieces, turn: 'white', ply: 0 };
}
export function chessRuntime(
  yaw = 0,
  position: Position = openingPosition(),
  scene = READING_SCENE,
) {
  const fixture = (id: string, def: string): Entity => ({
    id,
    def,
    kind: 'fixture',
    pose: { p: [0, 0, 0], yaw },
    provenance: FIXTURE,
    support: { kind: 'ground' },
  });
  const white = rot2([-0.15, -1.4], yaw),
    black = rot2([-0.15, 1.4], yaw);
  const world = addAll(
    emptyWorld('tabletop-chess', scene),
    fixture('chess-table', 'table-6ft'),
    human('white-player', white[0], white[1]),
    human('black-player', black[0], black[1]),
  );
  world.entities['white-player'].pose.yaw = yaw + Math.PI / 2;
  world.entities['black-player'].pose.yaw = yaw - Math.PI / 2;
  for (const [id, def, slot] of [
    ['board', 'chess-board', 'chess-table#r1c2'],
    ['capture-tray', 'chess-tray', 'chess-table#r1c4'],
  ]) {
    const s = surfaceSlot(world, slot);
    if ('code' in s) throw new Error(`${s.code}: ${s.message}`);
    const f = fixture(id, def);
    placeOnSlot(f, s, yaw);
    world.entities[id] = f;
  }
  world.entities.board.equipment = {
    kind: 'chess-board',
    config: {
      position: JSON.stringify(position),
      white: 'white-player',
      black: 'black-player',
    },
  };
  for (const p of position.pieces) {
    const slot = surfaceSlot(world, `board#${p.square}`);
    if ('code' in slot) throw new Error(`${slot.code}: ${slot.message}`);
    const token = itemEntity(p.id, `chess-${p.color}-${p.kind}`, [0, 0, 0]);
    placeOnSlot(token, slot, yaw);
    world.entities[token.id] = token;
  }
  return new Runtime(
    world,
    createRegistry(),
    { spatial: new Spatial(scene) },
    ENGINE_INVARIANTS,
  );
}
