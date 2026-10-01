// Generic hypothetical tabletop equipment; original procedural appearance, no historical claims.
import type { AssetDef } from './catalog.ts';
import type { Kind, Color } from '../games/chess-rules.ts';
export const CHESS_PITCH = 0.065;
const dims = {
  confidence: 'provisional' as const,
  note: 'hypothetical standard tabletop chess set, no measured historical artifact',
};
const kinds: Kind[] = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
export const CHESS_ASSETS: AssetDef[] = [
  {
    id: 'chess-board',
    label: 'tabletop chess board',
    category: 'fixture',
    size: [0.54, 0.02, 0.54],
    massKg: 1.2,
    color: '#765332',
    dims,
    capabilities: { boardGame: 'chess' },
    surfaceSlots: Array.from({ length: 64 }, (_, i) => ({
      id: String.fromCharCode(97 + (i % 8)) + (Math.floor(i / 8) + 1),
      local: [
        ((i % 8) - 3.5) * CHESS_PITCH,
        0.02,
        (Math.floor(i / 8) - 3.5) * CHESS_PITCH,
      ],
    })),
  },
  {
    id: 'chess-tray',
    label: 'captured chess piece tray',
    category: 'fixture',
    size: [0.44, 0.015, 0.33],
    massKg: 0.3,
    color: '#8c765c',
    dims,
    surfaceSlots: Array.from({ length: 32 }, (_, i) => ({
      id: `captured-${i}`,
      local: [((i % 8) - 3.5) * 0.05, 0.015, (Math.floor(i / 8) - 1.5) * 0.075],
    })),
  },
  ...(['white', 'black'] as Color[]).flatMap((color) =>
    kinds.map(
      (kind): AssetDef => ({
        id: `chess-${color}-${kind}`,
        label: `${color} chess ${kind}`,
        category: 'item',
        size: [0.035, kind === 'pawn' ? 0.045 : 0.065, 0.035],
        massKg: 0.035,
        color: color === 'white' ? '#ebe5d2' : '#34302a',
        dims,
        capabilities: { gameToken: { game: 'chess', color, kind } },
        handling: {
          carryCrew: [1, 1],
          carryPose: 'flat',
          carryHeight: 0.95,
          hands: 1,
          small: true,
          grips: { 1: [{ id: 'piece', local: [0, 0.025, 0] }] },
        },
      }),
    ),
  ),
];
