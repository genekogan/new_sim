import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePosition,
  proposeMove,
  legalMoves,
  boardStatus,
  inCheck,
  type Position,
  type Piece,
} from '../games/chess-rules.ts';
function position(
  rows: [Piece['color'], Piece['kind'], string][],
  turn: Position['turn'] = 'white',
): Position {
  return {
    pieces: rows.map(([color, kind, square], i) => ({
      id: `piece-${i}`,
      color,
      kind,
      square,
    })),
    turn,
    ply: 0,
  };
}
const kings = [
  ['white', 'king', 'e1'],
  ['black', 'king', 'e8'],
] as [Piece['color'], Piece['kind'], string][];
function move(p: Position, from: string, to: string) {
  const r = proposeMove(p, from, to);
  assert.ok(r.ok, r.ok ? '' : r.diagnostic.message);
  return r;
}
function refused(p: Position, from: string, to: string, code: string) {
  const before = structuredClone(p),
    r = proposeMove(p, from, to);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.diagnostic.code, `chess.${code}`);
  assert.deepEqual(p, before);
}
test('normal opening has twenty legal moves, stable decisions and independent state', () => {
  const ranks: Piece['kind'][] = [
    'rook',
    'knight',
    'bishop',
    'queen',
    'king',
    'bishop',
    'knight',
    'rook',
  ];
  const rows: [Piece['color'], Piece['kind'], string][] = [];
  for (const color of ['white', 'black'] as const)
    for (let x = 0; x < 8; x++) {
      const file = String.fromCharCode(97 + x);
      rows.push(
        [color, ranks[x], file + (color === 'white' ? 1 : 8)],
        [color, 'pawn', file + (color === 'white' ? 2 : 7)],
      );
    }
  const p = position(rows),
    before = structuredClone(p);
  assert.equal(legalMoves(p).length, 20);
  assert.deepEqual(legalMoves(p), legalMoves(structuredClone(p)));
  assert.equal(boardStatus(p), 'playing');
  const r = move(p, 'e2', 'e4');
  assert.equal(r.position.turn, 'black');
  assert.equal(r.position.ply, 1);
  assert.equal(r.position.enPassant, 'e3');
  assert.deepEqual(p, before);
  assert.equal(legalMoves(r.position).length, 20);
  refused(p, 'e7', 'e5', 'wrong-turn');
  refused(p, 'e2', 'e5', 'illegal-move');
  refused(p, 'b1', 'b3', 'illegal-move');
  refused(p, 'c1', 'g5', 'illegal-move');
  refused(p, 'e1', 'e2', 'occupied-target');
  refused(p, 'a3', 'a4', 'empty-source');
});
test('capture preserves moving identity and names the exact captured token', () => {
  const p = position([
    ...kings,
    ['white', 'rook', 'a1'],
    ['black', 'knight', 'a7'],
  ]);
  const a = p.pieces[2].id,
    b = p.pieces[3].id;
  const r = move(p, 'a1', 'a7');
  assert.equal(r.move.piece, a);
  assert.equal(r.move.capture, b);
  assert.equal(r.position.pieces.find((x) => x.id === a)?.square, 'a7');
  assert.equal(
    r.position.pieces.some((x) => x.id === b),
    false,
  );
  assert.equal(p.pieces.length, 4);
});
test('king exposure, blocked rays, king capture and unsupported castling refuse without mutation', () => {
  const p = position([
    ...kings,
    ['white', 'rook', 'e2'],
    ['black', 'rook', 'e7'],
  ]);
  refused(p, 'e2', 'a2', 'king-exposed');
  refused(p, 'e1', 'e3', 'illegal-move');
  const q = position([...kings, ['white', 'rook', 'a8']]);
  refused(q, 'a8', 'e8', 'king-capture');
  const c = position([...kings, ['white', 'rook', 'h1']]);
  refused(c, 'e1', 'g1', 'castling-unsupported');
  refused(c, 'e1', 'z3', 'invalid-square');
});
test('pawn attacks differ from advances; en-passant captures the recorded opposing token once', () => {
  const p = position(
    [
      ['white', 'king', 'a1'],
      ['black', 'king', 'h8'],
      ['white', 'pawn', 'e5'],
      ['black', 'pawn', 'd7'],
    ],
    'black',
  );
  const a = move(p, 'd7', 'd5').position;
  assert.equal(a.enPassant, 'd6');
  const captured = a.pieces.find((x) => x.square === 'd5')!.id;
  const b = move(a, 'e5', 'd6');
  assert.equal(b.move.capture, captured);
  assert.equal(b.position.enPassant, undefined);
  const stale = move(a, 'a1', 'b1').position;
  assert.equal(stale.enPassant, undefined);
  const attack = position([
    ['white', 'king', 'e4'],
    ['black', 'king', 'h8'],
    ['black', 'pawn', 'd5'],
  ]);
  assert.equal(inCheck(attack, 'white'), true);
  refused(attack, 'e4', 'c4', 'illegal-move');
  assert.ok(move(attack, 'e4', 'd4').ok, 'pawn cannot attack directly ahead');
});
test('promotion retains identity and terminal checkmate/stalemate are explicit', () => {
  const p = position([
    ['white', 'king', 'a1'],
    ['black', 'king', 'h8'],
    ['white', 'pawn', 'b7'],
  ]);
  const r = move(p, 'b7', 'b8');
  assert.equal(r.move.promotion, 'queen');
  assert.equal(r.position.pieces[2].id, p.pieces[2].id);
  assert.equal(r.position.pieces[2].kind, 'queen');
  assert.equal(
    boardStatus(
      position(
        [
          ['white', 'king', 'f6'],
          ['white', 'queen', 'g7'],
          ['black', 'king', 'h8'],
        ],
        'black',
      ),
    ),
    'checkmate',
  );
  assert.equal(
    boardStatus(
      position(
        [
          ['white', 'king', 'f7'],
          ['white', 'queen', 'g6'],
          ['black', 'king', 'h8'],
        ],
        'black',
      ),
    ),
    'stalemate',
  );
});
test('malformed or impossible position returns useful diagnostics, never an apparent empty game', () => {
  for (const p of [
    null,
    {},
    position([
      ['white', 'king', 'a1'],
      ['black', 'king', 'a2'],
    ]),
    position([
      ['white', 'king', 'a1'],
      ['black', 'king', 'h8'],
      ['white', 'pawn', 'e8'],
    ]),
  ])
    assert.equal(validatePosition(p).ok, false);
  const p = position(kings);
  p.pieces[1].id = p.pieces[0].id;
  assert.equal(validatePosition(p).ok, false);
  const q = position(kings);
  q.enPassant = 'c6';
  assert.equal(validatePosition(q).ok, false);
  assert.equal(boardStatus(q), 'invalid');
  assert.deepEqual(legalMoves(q), []);
});
