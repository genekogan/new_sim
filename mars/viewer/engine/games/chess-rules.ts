// Pure board intentions. No actor, pose, support, resource or renderer mutation.
import { z } from 'zod';
import type { Diagnostic } from '../actions/types.ts';
export type Color = 'white' | 'black';
export type Kind = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';
export interface Piece {
  id: string;
  color: Color;
  kind: Kind;
  square: string;
}
export interface Position {
  pieces: Piece[];
  turn: Color;
  ply: number;
  enPassant?: string;
}
export interface Move {
  piece: string;
  from: string;
  to: string;
  capture?: string;
  promotion?: Kind;
}
const square = z.string().regex(/^[a-h][1-8]$/);
const schema = z.strictObject({
  pieces: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(80),
        color: z.enum(['white', 'black']),
        kind: z.enum(['pawn', 'knight', 'bishop', 'rook', 'queen', 'king']),
        square,
      }),
    )
    .min(2)
    .max(32),
  turn: z.enum(['white', 'black']),
  ply: z.number().int().min(0),
  enPassant: square.optional(),
});
const other = (c: Color): Color => (c === 'white' ? 'black' : 'white');
const xy = (s: string): [number, number] => [
  s.charCodeAt(0) - 97,
  Number(s[1]) - 1,
];
const at = (x: number, y: number) => String.fromCharCode(97 + x) + (y + 1);
const failure = (
  code: string,
  message: string,
  subjects: string[] = [],
): { ok: false; diagnostic: Diagnostic } => ({
  ok: false,
  diagnostic: { code: `chess.${code}`, message, subjects },
});
export function validatePosition(
  raw: unknown,
): { ok: true; position: Position } | { ok: false; diagnostic: Diagnostic } {
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    return failure(
      'invalid-position',
      'Chess position does not match the supported board schema',
    );
  const p = parsed.data;
  if (
    new Set(p.pieces.map((x) => x.id)).size !== p.pieces.length ||
    new Set(p.pieces.map((x) => x.square)).size !== p.pieces.length
  )
    return failure(
      'duplicate-piece',
      'Piece identities and occupied squares must be unique',
    );
  for (const c of ['white', 'black'] as const)
    if (p.pieces.filter((x) => x.color === c && x.kind === 'king').length !== 1)
      return failure(
        'invalid-kings',
        'Exactly one king of each color is required',
      );
  if (
    p.pieces.some(
      (x) => x.kind === 'pawn' && (x.square[1] === '1' || x.square[1] === '8'),
    )
  )
    return failure(
      'invalid-pawn',
      'An unpromoted pawn cannot occupy the first or eighth rank',
    );
  const kings = p.pieces
    .filter((x) => x.kind === 'king')
    .map((x) => xy(x.square));
  if (
    Math.max(
      Math.abs(kings[0][0] - kings[1][0]),
      Math.abs(kings[0][1] - kings[1][1]),
    ) < 2
  )
    return failure('adjacent-kings', 'Kings cannot occupy adjacent squares');
  if (p.enPassant) {
    const [x, y] = xy(p.enPassant),
      dir = p.turn === 'white' ? 1 : -1;
    if (
      y !== (p.turn === 'white' ? 5 : 2) ||
      p.pieces.some((v) => v.square === p.enPassant) ||
      !p.pieces.some(
        (v) =>
          v.square === at(x, y - dir) &&
          v.kind === 'pawn' &&
          v.color === other(p.turn),
      )
    )
      return failure(
        'invalid-en-passant',
        'The recorded en-passant target must identify the opposing pawn and an empty eligible square',
      );
  }
  return { ok: true, position: p };
}
function clear(p: Position, from: string, to: string): boolean {
  const [x, y] = xy(from),
    [tx, ty] = xy(to),
    dx = Math.sign(tx - x),
    dy = Math.sign(ty - y);
  for (let a = x + dx, b = y + dy; a !== tx || b !== ty; a += dx, b += dy)
    if (p.pieces.some((v) => v.square === at(a, b))) return false;
  return true;
}
/** Threats deliberately include pinned pieces: a king cannot move into their attack. */
function attacks(p: Position, v: Piece, to: string): boolean {
  const [x, y] = xy(v.square),
    [tx, ty] = xy(to),
    dx = tx - x,
    dy = ty - y,
    ax = Math.abs(dx),
    ay = Math.abs(dy);
  if (!ax && !ay) return false;
  switch (v.kind) {
    case 'pawn':
      return ax === 1 && dy === (v.color === 'white' ? 1 : -1);
    case 'knight':
      return ax * ay === 2;
    case 'king':
      return Math.max(ax, ay) === 1;
    case 'bishop':
      return ax === ay && clear(p, v.square, to);
    case 'rook':
      return (dx === 0 || dy === 0) && clear(p, v.square, to);
    case 'queen':
      return (ax === ay || dx === 0 || dy === 0) && clear(p, v.square, to);
  }
}
export function inCheck(p: Position, color: Color): boolean {
  const king = p.pieces.find((v) => v.color === color && v.kind === 'king');
  return (
    !king ||
    p.pieces.some((v) => v.color !== color && attacks(p, v, king.square))
  );
}
/** Supported normal moves, captures, en-passant and queen promotion. Castling is explicit unsupported scope. */
export function proposeMove(
  p: Position,
  from: string,
  to: string,
):
  | { ok: true; position: Position; move: Move }
  | { ok: false; diagnostic: Diagnostic } {
  const valid = validatePosition(p);
  if (!valid.ok) return valid;
  if (!square.safeParse(from).success || !square.safeParse(to).success)
    return failure('invalid-square', 'Move squares must be a1 through h8', [
      from,
      to,
    ]);
  const v = p.pieces.find((x) => x.square === from),
    dest = p.pieces.find((x) => x.square === to);
  if (!v) return failure('empty-source', `${from} has no piece`, [from]);
  if (v.color !== p.turn)
    return failure('wrong-turn', `It is ${p.turn}'s turn`, [v.id]);
  if (dest?.color === v.color)
    return failure('occupied-target', `${to} is occupied by the same color`, [
      v.id,
      dest.id,
    ]);
  if (dest?.kind === 'king')
    return failure(
      'king-capture',
      'Kings are checked, never physically captured',
      [v.id, dest.id],
    );
  const [x, y] = xy(from),
    [tx, ty] = xy(to),
    dx = tx - x,
    dy = ty - y,
    dir = v.color === 'white' ? 1 : -1;
  if (
    v.kind === 'king' &&
    from === (v.color === 'white' ? 'e1' : 'e8') &&
    Math.abs(dx) === 2 &&
    dy === 0
  )
    return failure(
      'castling-unsupported',
      'This bounded tactical board has no castling rights; castling is unsupported',
      [v.id],
    );
  let captured = dest,
    legal = attacks(p, v, to);
  if (v.kind === 'pawn') {
    legal =
      dx === 0 &&
      !dest &&
      (dy === dir ||
        (y === (v.color === 'white' ? 1 : 6) &&
          dy === 2 * dir &&
          !p.pieces.some((a) => a.square === at(x, y + dir))));
    if (Math.abs(dx) === 1 && dy === dir) {
      if (dest) legal = true;
      else if (p.enPassant === to) {
        captured = p.pieces.find((a) => a.square === at(tx, ty - dir));
        legal =
          !!captured && captured.kind === 'pawn' && captured.color !== v.color;
      }
    }
  }
  if (!legal)
    return failure(
      'illegal-move',
      `${v.kind} cannot move from ${from} to ${to} in this position`,
      [v.id, from, to],
    );
  const promotion =
    v.kind === 'pawn' && (ty === 0 || ty === 7) ? 'queen' : undefined;
  const next: Position = {
    turn: other(p.turn),
    ply: p.ply + 1,
    pieces: p.pieces
      .filter((a) => a.id !== captured?.id)
      .map((a) =>
        a.id === v.id
          ? { ...a, square: to, ...(promotion ? { kind: promotion } : {}) }
          : { ...a },
      ),
    ...(v.kind === 'pawn' && Math.abs(dy) === 2
      ? { enPassant: at(x, y + dir) }
      : {}),
  };
  if (inCheck(next, v.color))
    return failure(
      'king-exposed',
      `${from} to ${to} would leave ${v.color}'s king in check`,
      [v.id],
    );
  return {
    ok: true,
    position: next,
    move: {
      piece: v.id,
      from,
      to,
      ...(captured ? { capture: captured.id } : {}),
      ...(promotion ? { promotion } : {}),
    },
  };
}
export function legalMoves(p: Position): Move[] {
  if (!validatePosition(p).ok) return [];
  const moves: Move[] = [];
  for (const piece of p.pieces
    .filter((v) => v.color === p.turn)
    .sort((a, b) => (a.square < b.square ? -1 : a.square > b.square ? 1 : 0)))
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const q = proposeMove(p, piece.square, at(x, y));
        if (q.ok) moves.push(q.move);
      }
  return moves;
}
export function boardStatus(
  p: Position,
): 'invalid' | 'playing' | 'check' | 'checkmate' | 'stalemate' {
  if (!validatePosition(p).ok) return 'invalid';
  const check = inCheck(p, p.turn);
  return legalMoves(p).length
    ? check
      ? 'check'
      : 'playing'
    : check
      ? 'checkmate'
      : 'stalemate';
}
