// Boards a Soul writes on and wipes by hand (Soul Actions entry 13). Frozen v1 signage bytes stay intact:
// notice-board@2 is a revision; the standing whiteboard is new. Both share one write/erase contract.
import signage from './signage.json' with { type: 'json' };
import type { DefInput } from '../schemas.ts';

/** Board text a Soul may write: short, a few lines, shown on the face and returned only to a reader. */
export const BOARD_TEXT_MAX = 100, BOARD_TEXT_LINES = 3;
const boardActions = (thing: string): NonNullable<DefInput['actions']> => [
  { name: 'write', label: `Write on the ${thing}`, params: { text: { type: 'string', max: BOARD_TEXT_MAX, doc: `up to ${BOARD_TEXT_MAX} characters, at most ${BOARD_TEXT_LINES} lines` } },
    then: [{ op: 'set', field: 'text', value: { param: 'text' } }] },
  { name: 'erase', label: `Wipe the ${thing} clean`, when: [{ field: 'text', not: '' }],
    then: [{ op: 'set', field: 'text', value: '' }, { op: 'set', field: 'textBy', value: '' }] },
] as NonNullable<DefInput['actions']>;
const boardState = { text: { type: 'string', max: BOARD_TEXT_MAX, default: '' }, textBy: { type: 'string', max: 40, default: '' } };

const noticeV1 = signage.find(d => d.name === 'core-notice-board')! as unknown as DefInput;
const noticeBoard: DefInput = { ...structuredClone(noticeV1), version: 2, tags: [...(noticeV1.tags ?? []), 'hand-writable'],
  description: 'A roofed notice board on two posts. A Soul can write a short notice on it by hand, or wipe it clean.',
  state: boardState as DefInput['state'], components: { ...structuredClone(noticeV1.components), sign: { lines: [] } }, actions: boardActions('notice board') };

const post = (x: number) => ({ kind: 'extrude', at: [x, 0.012, 0], polygon: [[-0.025, -0.025], [0.025, -0.025], [0.025, 0.025], [-0.025, 0.025]], h: 1.66, tint: 'frame' });
const foot = (x: number) => ({ kind: 'box', at: [x, 0.02, 0], size: [0.06, 0.04, 0.3], round: 0.01, tint: 'frame' });
const whiteboard: DefInput = {
  schema: 'def/1', name: 'core-whiteboard', version: 1,
  description: 'A whiteboard on a wheeled stand. A Soul can write a short note on it by hand, or wipe it clean.',
  tags: ['signage', 'sign-text', 'board', 'whiteboard', 'classroom', 'office', 'hand-writable'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [post(-0.58), post(0.58), foot(-0.58), foot(0.58),
    { kind: 'box', at: [0, 1.2, 0], size: [1.12, 0.74, 0.04], round: 0.01, tint: 'frame' },
    { kind: 'box', at: [0, 1.2, 0.021], size: [1.06, 0.68, 0.006], round: 0, tint: 'board' },
    { kind: 'box', at: [0, 0.85, 0.05], size: [0.9, 0.025, 0.07], round: 0.005, tint: 'frame' }],
    faces: [{ at: [0, 1.2, 0.026], w: 0.98, h: 0.6, bg: '#f6f7f4', ink: '#1d3f8f', font: '600' }] } } as unknown as DefInput['make'],
  params: { frame: { type: 'color', default: '#b9bec4', doc: 'frame colour' }, board: { type: 'color', default: '#f6f7f4', doc: 'board colour' } },
  state: boardState as DefInput['state'],
  components: { readable: { pages: 1 }, sign: { lines: [] } } as DefInput['components'],
  palette: { frame: '#b9bec4', board: '#f6f7f4' },
  size: { box: [1.16, 1.68, 0.3] },
  actions: boardActions('whiteboard'),
} as DefInput;

// Entry 27: noughts and crosses on a standing chalk board, with honest turns. `text` is the grid (9 cells: X, O or .),
// `textBy` the two players' soul ids (X first), `players` their names; the world decides turns, wins and draws.
/** Where square i (0..8, row by row from the top left) sits on the face (face-local metres, x right, y up). */
export const gameSquare = (i: number): [number, number] => [((i % 3) - 1) * 0.17, (1 - Math.floor(i / 3)) * 0.17];
export const GAME_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]] as const;
/** The grid's state: whose turn (X or O), the winner and its line, or a draw. */
export function gameStatus(grid: string): { turn: 'X' | 'O'; winner: 'X' | 'O' | null; line: readonly number[] | null; draw: boolean; moves: number } {
  const g = (grid || '.........').padEnd(9, '.').slice(0, 9), moves = [...g].filter(c => c !== '.').length;
  for (const l of GAME_LINES) { const [a, b, c] = l; if (g[a] !== '.' && g[a] === g[b] && g[a] === g[c]) return { turn: moves % 2 ? 'O' : 'X', winner: g[a] as 'X' | 'O', line: l, draw: false, moves }; }
  return { turn: moves % 2 ? 'O' : 'X', winner: null, line: null, draw: moves === 9, moves };
}
/** The square a Soul names: 1-9, or words (top left, centre, middle right, bottom...). -1 = not a square. */
export function gameSquareOf(v: unknown): number {
  const s = typeof v === 'string' ? v.trim().toLowerCase().replace(/\b(?:the|square|box|corner|one)\b/g, ' ').replace(/\s+/g, ' ').trim() : typeof v === 'number' ? String(v) : '';
  if (/^[1-9]$/.test(s)) return Number(s) - 1;
  const row = /\btop\b|\bupper\b/.test(s) ? 0 : /\bbottom\b|\blower\b/.test(s) ? 2 : /\b(?:middle|centre|center)\b/.test(s) ? 1 : -1;
  const col = /\bleft\b/.test(s) ? 0 : /\bright\b/.test(s) ? 2 : /\b(?:middle|centre|center)\b/.test(s) || /^(?:top|bottom|upper|lower)$/.test(s) ? 1 : -1;
  if (row < 0 && col >= 0) return 3 + col;   // "left" / "right" alone: the middle row
  return row >= 0 && col >= 0 ? row * 3 + col : -1;
}
const tictactoe: DefInput = {
  schema: 'def/1', name: 'core-tictactoe-board', version: 1,
  description: 'A standing chalk board with a noughts-and-crosses grid. Two Souls play by hand, taking turns (the first to mark plays X); a third waits for the next game. Wiping it starts a new game.',
  tags: ['signage', 'sign-text', 'board', 'game', 'tictactoe', 'hand-writable'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [post(-0.42), post(0.42), foot(-0.42), foot(0.42),
    { kind: 'box', at: [0, 1.25, 0], size: [0.8, 0.7, 0.04], round: 0.01, tint: 'frame' },
    { kind: 'box', at: [0, 1.25, 0.021], size: [0.74, 0.64, 0.006], round: 0, tint: 'board' },
    { kind: 'box', at: [0, 0.88, 0.05], size: [0.6, 0.025, 0.07], round: 0.005, tint: 'frame' }],
    faces: [{ at: [0, 1.25, 0.026], w: 0.7, h: 0.6, bg: '#2b322e', ink: '#f4f2e8' }] } } as unknown as DefInput['make'],
  params: { frame: { type: 'color', default: '#7d5a3a', doc: 'frame colour' }, board: { type: 'color', default: '#2b322e', doc: 'slate colour' } },
  palette: { frame: '#7d5a3a', board: '#2b322e' },
  state: { text: { type: 'string', max: 9, default: '' }, textBy: { type: 'string', max: 82, default: '' }, players: { type: 'string', max: 82, default: '' } } as DefInput['state'],
  components: { readable: { pages: 1 }, sign: { lines: [] } } as DefInput['components'],
  size: { box: [0.9, 1.68, 0.3] },
  actions: [
    { name: 'mark', label: 'Mark a square on the game board', params: { square: { type: 'string', max: 20, doc: 'which square: 1-9 (top left is 1), or words like "top left", "centre", "bottom right"' } },
      then: [{ op: 'set', field: 'text', value: '' }, { op: 'set', field: 'textBy', value: '' }, { op: 'set', field: 'players', value: '' }] },
    { name: 'erase', label: 'Wipe the game board for a new game', when: [{ field: 'text', not: '' }],
      then: [{ op: 'set', field: 'text', value: '' }, { op: 'set', field: 'textBy', value: '' }, { op: 'set', field: 'players', value: '' }] },
  ] as NonNullable<DefInput['actions']> } as DefInput;

export const WRITABLE_BOARDS: DefInput[] = [whiteboard, noticeBoard, tictactoe];
