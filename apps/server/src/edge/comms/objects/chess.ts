// Chess set (C8): Roles white/black (`opposing`), public `board`, full legal-move
// validation (check, castling, en passant, promotion), checkmate/stalemate/50-move.
import type {ObjectKind, Refusal, SoulRef} from './types.ts';

type Color = 'white' | 'black';
export type ChessState = {board: string[]; turn: Color; white: SoulRef | null; black: SoulRef | null; castling: string; enPassant: string;
  halfmove: number; fullmove: number; moves: string[]; status: 'waiting' | 'playing' | 'checkmate' | 'stalemate' | 'resigned' | 'draw'; winner: string; check: boolean};

const START = ['rnbqkbnr', 'pppppppp', '........', '........', '........', '........', 'PPPPPPPP', 'RNBQKBNR'];
const SQUARE = '^[a-h][1-8]$';
const sq = (name: string) => (name.charCodeAt(1) - 49) * 8 + (name.charCodeAt(0) - 97);
const nameOf = (i: number) => String.fromCharCode(97 + (i % 8)) + String.fromCharCode(49 + Math.floor(i / 8));
const toFlat = (board: string[]) => [...board].reverse().join('');                       // index = rank*8+file, rank 0 = "1"
const toRows = (flat: string) => Array.from({length: 8}, (_, r) => flat.slice((7 - r) * 8, (7 - r) * 8 + 8));
const isWhite = (p: string) => p >= 'A' && p <= 'Z';
const colorOf = (p: string): Color | null => p === '.' ? null : isWhite(p) ? 'white' : 'black';
const other = (c: Color): Color => c === 'white' ? 'black' : 'white';
const fileOf = (i: number) => i % 8, rankOf = (i: number) => Math.floor(i / 8);

type Pos = {b: string[]; turn: Color; castling: string; ep: number};
type Move = {from: number; to: number; promo?: string; castle?: 'K' | 'Q'; ep?: boolean};

function step(i: number, df: number, dr: number): number {
  const f = fileOf(i) + df, r = rankOf(i) + dr;
  return f < 0 || f > 7 || r < 0 || r > 7 ? -1 : r * 8 + f;
}
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]], BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

export function attacked(b: string[], target: number, by: Color): boolean {
  const own = (p: string, kind: string) => p !== '.' && colorOf(p) === by && p.toLowerCase() === kind;
  const pawnDir = by === 'white' ? -1 : 1;                 // look back toward the attacker's pawns
  for (const df of [-1, 1]) { const s = step(target, df, pawnDir); if (s >= 0 && own(b[s]!, 'p')) return true; }
  for (const [df, dr] of KNIGHT) { const s = step(target, df!, dr!); if (s >= 0 && own(b[s]!, 'n')) return true; }
  for (const [df, dr] of KING) { const s = step(target, df!, dr!); if (s >= 0 && own(b[s]!, 'k')) return true; }
  for (const [dirs, kinds] of [[ROOK, 'rq'], [BISHOP, 'bq']] as const) for (const [df, dr] of dirs) {
    for (let s = step(target, df!, dr!); s >= 0; s = step(s, df!, dr!)) {
      const p = b[s]!;
      if (p === '.') continue;
      if (colorOf(p) === by && kinds.includes(p.toLowerCase())) return true;
      break;
    }
  }
  return false;
}
const kingSq = (b: string[], c: Color) => b.indexOf(c === 'white' ? 'K' : 'k');
export const inCheck = (b: string[], c: Color) => attacked(b, kingSq(b, c), other(c));

function pseudo(pos: Pos): Move[] {
  const {b, turn} = pos, out: Move[] = [];
  const mine = (i: number) => colorOf(b[i]!) === turn, theirs = (i: number) => colorOf(b[i]!) === other(turn);
  for (let i = 0; i < 64; i++) {
    if (!mine(i)) continue;
    const kind = b[i]!.toLowerCase();
    if (kind === 'p') {
      const dir = turn === 'white' ? 1 : -1, startRank = turn === 'white' ? 1 : 6, lastRank = turn === 'white' ? 7 : 0;
      const push = (to: number) => { if (rankOf(to) === lastRank) for (const promo of 'qrbn') out.push({from: i, to, promo}); else out.push({from: i, to}); };
      const one = step(i, 0, dir);
      if (one >= 0 && b[one] === '.') {
        push(one);
        const two = step(i, 0, 2 * dir);
        if (rankOf(i) === startRank && b[two] === '.') out.push({from: i, to: two});
      }
      for (const df of [-1, 1]) {
        const t = step(i, df, dir);
        if (t < 0) continue;
        if (theirs(t)) push(t);
        else if (t === pos.ep) out.push({from: i, to: t, ep: true});
      }
    } else if (kind === 'n' || kind === 'k') {
      for (const [df, dr] of kind === 'n' ? KNIGHT : KING) { const t = step(i, df!, dr!); if (t >= 0 && !mine(t)) out.push({from: i, to: t}); }
      if (kind === 'k') {
        const home = turn === 'white' ? 4 : 60, [k, q] = turn === 'white' ? ['K', 'Q'] : ['k', 'q'];
        const enemy = other(turn);
        if (i === home && !inCheck(b, turn)) {
          if (pos.castling.includes(k!) && b[home + 1] === '.' && b[home + 2] === '.' && b[home + 3]!.toLowerCase() === 'r' && !attacked(b, home + 1, enemy) && !attacked(b, home + 2, enemy)) out.push({from: i, to: home + 2, castle: 'K'});
          if (pos.castling.includes(q!) && b[home - 1] === '.' && b[home - 2] === '.' && b[home - 3] === '.' && b[home - 4]!.toLowerCase() === 'r' && !attacked(b, home - 1, enemy) && !attacked(b, home - 2, enemy)) out.push({from: i, to: home - 2, castle: 'Q'});
        }
      }
    } else {
      const dirs = kind === 'r' ? ROOK : kind === 'b' ? BISHOP : [...ROOK, ...BISHOP];
      for (const [df, dr] of dirs) for (let t = step(i, df!, dr!); t >= 0; t = step(t, df!, dr!)) {
        if (mine(t)) break;
        out.push({from: i, to: t});
        if (theirs(t)) break;
      }
    }
  }
  return out;
}

function play(pos: Pos, m: Move): Pos {
  const b = [...pos.b], piece = b[m.from]!;
  b[m.to] = m.promo ? (pos.turn === 'white' ? m.promo.toUpperCase() : m.promo) : piece;
  b[m.from] = '.';
  if (m.ep) b[step(m.to, 0, pos.turn === 'white' ? -1 : 1)] = '.';
  if (m.castle) { const home = pos.turn === 'white' ? 4 : 60; const [rf, rt] = m.castle === 'K' ? [home + 3, home + 1] : [home - 4, home - 1]; b[rt!] = b[rf!]!; b[rf!] = '.'; }
  let castling = pos.castling;
  const strip = (chars: string) => { for (const c of chars) castling = castling.replace(c, ''); };
  if (piece === 'K') strip('KQ'); if (piece === 'k') strip('kq');
  for (const s of [m.from, m.to]) { if (s === 0) strip('Q'); if (s === 7) strip('K'); if (s === 56) strip('q'); if (s === 63) strip('k'); }
  const ep = piece.toLowerCase() === 'p' && Math.abs(m.to - m.from) === 16 ? (m.from + m.to) / 2 : -1;
  return {b, turn: other(pos.turn), castling, ep};
}

export function legalMoves(pos: Pos): Move[] { return pseudo(pos).filter(m => !inCheck(play(pos, m).b, pos.turn)); }
const posOf = (s: ChessState): Pos => ({b: [...toFlat(s.board)], turn: s.turn, castling: s.castling, ep: s.enPassant === '-' ? -1 : sq(s.enPassant)});
const seated = (s: ChessState, id: string): Color | null => s.white?.soulId === id ? 'white' : s.black?.soulId === id ? 'black' : null;

function findMove(s: ChessState, params: Record<string, unknown>): Move | Refusal {
  const from = sq(params.from as string), to = sq(params.to as string), promo = (params.promotion as string | undefined) ?? 'q';
  const pos = posOf(s), piece = pos.b[from]!;
  if (colorOf(piece) !== s.turn) return {code: 'chess.not-your-piece', reason: `There is no ${s.turn} piece on ${params.from}.`};
  const candidates = legalMoves(pos).filter(m => m.from === from && m.to === to && (!m.promo || m.promo === promo));
  if (!candidates.length) return {code: 'chess.illegal', reason: `${params.from}-${params.to} is not a legal move${inCheck(pos.b, s.turn) ? ' (you are in check)' : ''}.`};
  return candidates[0]!;
}

export const chessKind: ObjectKind<ChessState> = {
  kind: 'chess',
  description: 'A chess table. Sit as white or black; when both seats are taken the game starts and white moves first. Onlookers may read the board.',
  listed: false,
  roles: [{id: 'white', relations: [{name: 'opposing', to: 'black'}]}, {id: 'black', relations: [{name: 'opposing', to: 'white'}]}],
  schema: {
    board: {type: 'string[]', visibility: 'public', description: '8 ranks from rank 8 to rank 1; uppercase white, lowercase black, "." empty'},
    turn: {type: 'string', visibility: 'public'}, white: {type: 'soul?', visibility: 'public'}, black: {type: 'soul?', visibility: 'public'},
    castling: {type: 'string', visibility: 'public'}, enPassant: {type: 'string', visibility: 'public'},
    halfmove: {type: 'integer', visibility: 'public'}, fullmove: {type: 'integer', visibility: 'public'},
    moves: {type: 'string[]', visibility: 'public'}, status: {type: 'string', visibility: 'public'}, winner: {type: 'string', visibility: 'public'}, check: {type: 'boolean', visibility: 'public'},
  },
  initial: () => ({board: [...START], turn: 'white', white: null, black: null, castling: 'KQkq', enPassant: '-', halfmove: 0, fullmove: 1, moves: [], status: 'waiting', winner: '', check: false}),
  rolesOf: (s, id) => { const c = seated(s, id); return c ? [c] : []; },
  personal: (s, id) => { const c = seated(s, id); return c ? {color: c, yourTurn: s.status === 'playing' && s.turn === c} : {}; },
  actions: {
    sit: {
      label: 'Sit at the chess table', roles: 'anyone', reach: 'place',
      params: {color: {type: 'string', enum: ['white', 'black'], optional: true, description: 'default: the free seat'}},
      available: (s, ctx) => seated(s, ctx.soul.soulId) ? {code: 'chess.already-seated', reason: 'You are already seated.'} : s.white && s.black ? {code: 'chess.seats-taken', reason: 'Both seats are taken.'} : null,
      validate(s, p, ctx) {
        if (seated(s, ctx.soul.soulId)) return {code: 'chess.already-seated', reason: 'You are already seated.'};
        const color = (p.color as Color | undefined) ?? (s.white ? 'black' : 'white');
        return s[color] ? {code: 'chess.seat-taken', reason: `${s[color]!.name} is already playing ${color}.`} : null;
      },
      apply(s, p, ctx) {
        const color = (p.color as Color | undefined) ?? (s.white ? 'black' : 'white');
        s[color] = {soulId: ctx.soul.soulId, name: ctx.soul.name};
        const opponent = s[other(color)];
        if (opponent && s.status === 'waiting') s.status = 'playing';
        return {state: s, result: {color, status: s.status},
          events: opponent ? [{to: [opponent.soulId], text: `${ctx.soul.name} sat down as ${color}. ${s.status === 'playing' ? `The game begins; ${s.turn} to move.` : ''}`.trim(), data: {color, status: s.status}, untrusted: true}] : []};
      },
    },
    move: {
      label: 'Move a piece', roles: ['white', 'black'], reach: 'place',
      params: {from: {type: 'string', pattern: SQUARE, description: 'square like e2'}, to: {type: 'string', pattern: SQUARE, description: 'square like e4'},
        promotion: {type: 'string', enum: ['q', 'r', 'b', 'n'], optional: true, description: 'promotion piece, default q'}},
      available: (s, ctx) => s.status !== 'playing' ? {code: 'chess.not-playing', reason: s.status === 'waiting' ? 'Waiting for an opponent.' : 'The game is over.'}
        : !ctx.roles.includes(s.turn) ? {code: 'chess.not-your-turn', reason: `It is ${s.turn}'s turn.`} : null,
      validate(s, p, ctx) {
        const blocked = chessKind.actions.move!.available!(s, ctx);
        if (blocked) return blocked;
        const m = findMove(s, p);
        return 'code' in m ? m : null;
      },
      apply(s, p, ctx) {
        const m = findMove(s, p) as Move, pos = posOf(s), piece = pos.b[m.from]!, capture = pos.b[m.to] !== '.' || !!m.ep;
        const next = play(pos, m), mover = s.turn;
        const uci = `${p.from}${p.to}${m.promo ?? ''}`;
        s.board = toRows(next.b.join('')); s.turn = next.turn; s.castling = next.castling || '-'; s.enPassant = next.ep >= 0 ? nameOf(next.ep) : '-';
        s.halfmove = piece.toLowerCase() === 'p' || capture ? 0 : s.halfmove + 1;
        if (mover === 'black') s.fullmove++;
        s.moves.push(uci);
        s.check = inCheck(next.b, next.turn);
        const replies = legalMoves(next);
        if (!replies.length) { s.status = s.check ? 'checkmate' : 'stalemate'; s.winner = s.check ? mover : ''; }
        else if (s.halfmove >= 100) s.status = 'draw';
        const opponent = s[next.turn];
        const tail = s.status === 'checkmate' ? ' Checkmate.' : s.status === 'stalemate' ? ' Stalemate.' : s.status === 'draw' ? ' Draw by the fifty-move rule.' : s.check ? ' Check.' : '';
        return {state: s, result: {move: uci, check: s.check, status: s.status, winner: s.winner},
          events: opponent ? [{to: [opponent.soulId], text: `${ctx.soul.name} played ${uci}.${tail}${s.status === 'playing' ? ' Your move.' : ''}`, data: {move: uci, status: s.status, check: s.check}, untrusted: true}] : []};
      },
    },
    resign: {
      label: 'Resign the game', roles: ['white', 'black'], reach: 'anywhere', params: {},
      available: s => s.status === 'playing' ? null : {code: 'chess.not-playing', reason: 'No game in progress.'},
      validate: s => s.status === 'playing' ? null : {code: 'chess.not-playing', reason: 'No game in progress.'},
      apply(s, _p, ctx) {
        const color = ctx.roles[0] as Color;
        s.status = 'resigned'; s.winner = other(color);
        const opponent = s[other(color)];
        return {state: s, result: {winner: s.winner}, events: opponent ? [{to: [opponent.soulId], text: `${ctx.soul.name} resigned; you win.`, untrusted: true}] : []};
      },
    },
    leave: {
      label: 'Leave the chess table', roles: ['white', 'black'], reach: 'anywhere', params: {},
      validate: () => null,
      apply(s, _p, ctx) {
        const color = ctx.roles[0] as Color, opponent = s[other(color)];
        if (s.status === 'playing') { s.status = 'resigned'; s.winner = other(color); }
        s[color] = null;
        if (s.status === 'waiting' || !opponent) s.status = 'waiting';
        return {state: s, events: opponent ? [{to: [opponent.soulId], text: `${ctx.soul.name} left the table.`, untrusted: true}] : []};
      },
    },
    reset: {
      label: 'Set up a new game', roles: 'anyone', reach: 'place', params: {},
      available: s => s.status === 'playing' ? {code: 'chess.in-progress', reason: 'A game is in progress.'} : null,
      validate: s => s.status === 'playing' ? {code: 'chess.in-progress', reason: 'A game is in progress.'} : null,
      apply(s) {
        const fresh = chessKind.initial({}, {tick: 0, now: 0, nameOf: () => ''});
        fresh.white = s.white; fresh.black = s.black;
        fresh.status = s.white && s.black ? 'playing' : 'waiting';
        return {state: fresh};
      },
    },
  },
};
