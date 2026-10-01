import type { Runtime } from '../../engine/runtime/runtime.ts';
import { CATALOG } from '../../engine/world/catalog.ts';
import type { Scenario } from './scenarios.ts';
import { chessRuntime } from '../../engine/scenarios/chess.ts';
import { READING_SCENE } from '../../engine/scenarios/reading.ts';
import { readChess } from '../../engine/objects/chess.ts';
export const CHESS_SCENARIO: Scenario = {
  name: 'tabletop-chess',
  title: 'Tabletop chess · two physical players (hypothetical)',
  description:
    'Choose legal turns at a real table. The same tokens are picked up and placed; captures go into a supported tray. Interrupt or direct the player away: cleanup precedes handoff. Standing play with current poses; no castling or physical pawn promotion.',
  scene: () => READING_SCENE,
  humans: () => [],
  build: () => chessRuntime(),
  start: () => {},
  continuous: true,
  maxTicks: 36000,
  focus: [0, 0, 3.2, 110],
  hud: (rt) => {
    const s = readChess(rt, 'board');
    return 'code' in s
      ? [s.message]
      : [
          `Chess: ${s.position.turn}'s turn · ${s.position.ply} completed moves · ${s.status}`,
        ];
  },
  expect: (rt) => [
    {
      ok: rt.violations.length === 0,
      message: `authoritative violations: ${rt.violations.length}`,
    },
  ],
};

/** Read-only shared attention; foreign directed control immediately takes precedence. */
export function chessAttention(
  rt: Runtime,
  boardIds: readonly string[] = ['board'],
): Record<string, [number, number]> {
  const targets: Record<string, [number, number]> = {};
  for (const id of boardIds) {
    const board = rt.world.entities[id];
    if (!board) continue;
    if (
      CATALOG[board.def]?.capabilities?.boardGame !== 'chess' ||
      board.equipment?.config.available === false
    )
      continue;
    const game = readChess(rt, board.id);
    if ('code' in game || (!game.pending && game.position.ply === 0)) continue;
    for (const role of ['white', 'black']) {
      const actor = board.equipment?.config[role];
      if (typeof actor !== 'string' || !rt.world.entities[actor]?.human)
        continue;
      const ownsGame = (id: string) => {
        for (
          let r = rt.records.get(id);
          r;
          r = r.parent ? rt.records.get(r.parent) : undefined
        )
          if (
            r.verb === 'chess_move' &&
            r.params &&
            typeof r.params === 'object' &&
            'board' in r.params &&
            r.params.board === board.id
          )
            return true;
        return false;
      };
      if (rt.holder(`actor:${actor}`).some((id) => !ownsGame(id))) continue;
      targets[actor] = [board.pose.p[0], board.pose.p[2]];
    }
  }
  return targets;
}
