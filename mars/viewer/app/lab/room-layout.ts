// Two constrained, hypothetical layouts, shared by direct and coordinated setup.
import type { MoveFixtureParams } from '../../engine/carry/fixture.ts';
export type RoomLayout = 'default' | 'side';
export function classroomFurniture(scenario: string) {
  if (scenario !== 'classroom-4' && scenario !== 'classroom-8') throw Error('room_setup.unsupported-room');
  const eight = scenario === 'classroom-8';
  return {
    chair: { id: eight ? 'seat12' : 'seat8', default: { x: 4.5, z: eight ? 6 : 3, yaw: -Math.PI }, side: { x: 7.5, z: eight ? 4.5 : 3, yaw: -Math.PI } },
    table: { id: 'belongings-table', default: { x: 10, z: -5, yaw: 0 }, side: { x: 12, z: -2, yaw: 0 } },
  };
}
export function classroomSetup(scenario: string, layout: RoomLayout, crew: { chair: string; table: string; helper: string }) {
  const furniture = classroomFurniture(scenario);
  const moves: [MoveFixtureParams, MoveFixtureParams] = [
    { actor: crew.table, helpers: [crew.helper], fixture: furniture.table.id, to: furniture.table[layout] },
    { actor: crew.chair, fixture: furniture.chair.id, to: furniture.chair[layout] },
  ];
  return { layout, moves };
}
