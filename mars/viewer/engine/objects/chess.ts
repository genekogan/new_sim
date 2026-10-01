// Chess intent commits only after ordinary physical transfers. No rig or pose writes.
import { z } from 'zod';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { WorldState } from '../world/types.ts';
import { CATALOG } from '../world/catalog.ts';
import { surfaceSlot, surfaceSlotsOf, slotOccupant } from '../items/model.ts';
import { humanOf } from '../social/actions.ts';
import { heldBy } from '../items/model.ts';
import {
  proposeMove,
  validatePosition,
  type Position,
  type Move,
} from '../games/chess-rules.ts';
type Params = {
  actor: string;
  board: string;
  from: string;
  to: string;
  tray: string;
  restore?: boolean;
};
type Op = { item: string; slot?: string };
type Program = {
  original: Position;
  next: Position;
  move: Move;
  capturedSlot?: string;
  capturedFrom?: string;
  boardPose: string;
  trayPose: string;
  restoreOps?: Op[];
};
type Exec = {
  id: string;
  p: Params;
  program: Program;
  ops: Op[];
  index: number;
  child?: string;
  stopping: boolean;
  cleaning: boolean;
  committed: boolean;
};
const diag = (
  code: string,
  message: string,
  subjects: string[] = [],
): Diagnostic => ({ code: `chess.${code}`, message, subjects });
function config(rt: Runtime, id: string) {
  return rt.world.entities[id]?.equipment?.config;
}
export function readChess(
  rt: Runtime,
  board: string,
): { position: Position; pending: boolean; status: string } | Diagnostic {
  const b = rt.world.entities[board];
  if (!b || CATALOG[b.def]?.capabilities?.boardGame !== 'chess')
    return diag('missing-board', `${board} has no chess board capability`, [
      board,
    ]);
  try {
    const c = config(rt, board),
      parsed = validatePosition(JSON.parse(String(c?.position)));
    if (!parsed.ok) return parsed.diagnostic;
    return {
      position: parsed.position,
      pending: typeof c?.pending === 'string',
      status: typeof c?.status === 'string' ? c.status : 'ready',
    };
  } catch {
    return diag(
      'invalid-position',
      `${board} has no valid recorded chess position`,
      [board],
    );
  }
}
function operations(p: Params, pr: Program): Op[] {
  return [
    ...(pr.move.capture
      ? [
          { item: pr.move.capture },
          { item: pr.move.capture, slot: pr.capturedSlot! },
        ]
      : []),
    { item: pr.move.piece },
    { item: pr.move.piece, slot: `${p.board}#${p.to}` },
  ];
}
function remember(rt: Runtime, ex: Exec) {
  const c = config(rt, ex.p.board);
  if (!c) return;
  c.pending = JSON.stringify({
    actor: ex.p.actor,
    original: ex.program.original,
    move: ex.program.move,
    tray: ex.p.tray,
    index: ex.index,
    cleaning: ex.cleaning,
  });
  c.status = 'active';
  c.action = ex.id;
}
function clearPending(rt: Runtime, ex: Exec) {
  const c = config(rt, ex.p.board);
  if (!c) return;
  delete c.pending;
  c.status = 'ready';
  c.action = '';
}
function onSlot(rt: Runtime, item: string, id: string) {
  const s = rt.world.entities[item]?.support,
    k = id.lastIndexOf('#');
  return (
    s?.kind === 'resting-on' &&
    s.on === id.slice(0, k) &&
    s.slot === id.slice(k + 1)
  );
}
function rollback(rt: Runtime, p: Params, program: Program): Op[] | Diagnostic {
  const q: Op[] = [];
  const restore = (item: string, slot: string) => {
    if (onSlot(rt, item, slot)) return;
    const s = rt.world.entities[item]?.support;
    if (s?.kind === 'in-hand' && s.by === p.actor) q.push({ item, slot });
    else if (s?.kind === 'resting-on') q.push({ item }, { item, slot });
    else
      return diag(
        'cleanup-required',
        `${item} must remain available to ${p.actor} before the interrupted move can be restored`,
        [p.board, p.actor, item],
      );
  };
  const a = restore(program.move.piece, `${p.board}#${p.from}`);
  if (a) return a;
  if (program.move.capture) {
    const b = restore(
      program.move.capture,
      `${p.board}#${program.capturedFrom}`,
    );
    if (b) return b;
  }
  return q;
}
function finish(rt: Runtime, ex: Exec): StepResult {
  if (!ex.cleaning) {
    const c = config(rt, ex.p.board);
    if (!c)
      return {
        status: 'failed',
        diagnostic: diag(
          'missing-board',
          'The board was removed before the move committed',
          [ex.p.board],
        ),
      };
    c.position = JSON.stringify(ex.program.next);
    ex.committed = true;
  }
  clearPending(rt, ex);
  return {
    status: 'completed',
    outputs: {
      board: ex.p.board,
      piece: ex.program.move.piece,
      committed: ex.committed,
      ...(ex.program.move.capture ? { captured: ex.program.move.capture } : {}),
    },
  };
}
function failure(rt: Runtime, ex: Exec, d: Diagnostic): StepResult {
  const c = config(rt, ex.p.board);
  if (c) {
    remember(rt, ex);
    c.status = 'unfinished';
    c.action = '';
  }
  return { status: 'failed', diagnostic: d };
}
// Reservations are also inspected before admission; malformed state must leave
// normal plan diagnostics responsible for refusing it, without mutating the world.
function plannedMove(world: WorldState, p: Params) {
  try {
    const parsed = validatePosition(
      JSON.parse(String(world.entities[p.board]?.equipment?.config.position)),
    );
    if (!parsed.ok) return null;
    const moved = proposeMove(parsed.position, p.from, p.to);
    return moved.ok ? { original: parsed.position, move: moved.move } : null;
  } catch {
    return null;
  }
}
const id = z.string().min(1).max(80),
  sq = z.string().regex(/^[a-h][1-8]$/);
export const chessMove: ActionDef<Params, Program, Exec> = {
  verb: 'chess_move',
  description:
    'Take and place the same physical chess token at a usable table; capture into a real tray, commit only after placement, and restore owned pieces on interruption. restore:true explicitly repairs an unfinished owned transfer without committing its turn.',
  schema: z.strictObject({
    actor: id,
    board: id,
    from: sq,
    to: sq,
    tray: id,
    restore: z.boolean().optional(),
  }),
  // Parent keeps one actor commitment across transfer/cleanup; ordinary children alone move it.
  reservations: (w, p) => {
    const claims = [
      { resource: `actor:${p.actor}`, mode: 'exclusive' as const },
      { resource: `chess:${p.board}`, mode: 'exclusive' as const },
      { resource: `entity:${p.board}`, mode: 'exclusive' as const },
      { resource: `entity:${p.tray}`, mode: 'exclusive' as const },
      {
        resource: `surface-slot:${p.board}#${p.from}`,
        mode: 'exclusive' as const,
      },
      {
        resource: `surface-slot:${p.board}#${p.to}`,
        mode: 'exclusive' as const,
      },
    ];
    // Hold the same tokens and rollback locations across child boundaries.
    // Children borrow these claims through the existing Runtime ancestor rules.
    const moved = plannedMove(w, p);
    if (moved) {
      claims.push({
        resource: `entity:${moved.move.piece}`,
        mode: 'exclusive',
      });
      if (moved.move.capture) {
        claims.push({
          resource: `entity:${moved.move.capture}`,
          mode: 'exclusive',
        });
        const current = w.entities[moved.move.capture]?.support;
        if (current?.kind === 'resting-on' && current.slot)
          claims.push({
            resource: `surface-slot:${current.on}#${current.slot}`,
            mode: 'exclusive',
          });
        const captured = moved.original.pieces.find(
          (v) => v.id === moved.move.capture,
        )!;
        claims.push({
          resource: `surface-slot:${p.board}#${captured.square}`,
          mode: 'exclusive',
        });
        const free = surfaceSlotsOf(w, p.tray).find(
          (s) => !slotOccupant(w, s.owner, s.slot),
        );
        if (free)
          claims.push({
            resource: `surface-slot:${free.id}`,
            mode: 'exclusive',
          });
      }
    }
    for (const entity of [w.entities[p.board], w.entities[p.tray]]) {
      if (entity?.support?.kind === 'resting-on')
        claims.push({
          resource: `entity:${entity.support.on}`,
          mode: 'exclusive',
        });
    }
    return [...new Map(claims.map((c) => [c.resource, c])).values()];
  },
  plan(rt, p) {
    const actor = humanOf(rt, p.actor);
    if ('code' in actor) return { ok: false, diagnostic: actor };
    if (actor.human!.level !== 0 || actor.human!.on)
      return {
        ok: false,
        diagnostic: diag(
          'ground-only',
          'Tabletop chess currently requires ordinary ground access',
          [p.actor],
        ),
      };
    const held = heldBy(rt.world, p.actor);
    if (held.length && !p.restore)
      return {
        ok: false,
        diagnostic: diag(
          'hands-occupied',
          'Put held objects down before beginning a chess move',
          [p.actor, ...held.map((x) => x.item.id)],
        ),
      };
    const game = readChess(rt, p.board);
    if ('code' in game) return { ok: false, diagnostic: game };
    if (game.pending && !p.restore)
      return {
        ok: false,
        diagnostic: diag(
          'pending-move',
          'The previous move requires physical cleanup before another move may begin',
          [p.board],
        ),
      };
    const c = config(rt, p.board)!;
    if (p.restore) {
      if (!game.pending || c.status !== 'unfinished' || c.action !== '')
        return {
          ok: false,
          diagnostic: diag(
            'no-unfinished-move',
            'Only a terminal unfinished transfer may be explicitly restored',
            [p.board],
          ),
        };
      let pending: {
        actor?: string;
        tray?: string;
        original?: unknown;
        move?: unknown;
      };
      try {
        pending = JSON.parse(String(c.pending));
      } catch {
        return {
          ok: false,
          diagnostic: diag(
            'invalid-pending',
            'Recorded transfer metadata is invalid; do not guess a replacement position',
            [p.board],
          ),
        };
      }
      const replay = proposeMove(game.position, p.from, p.to);
      if (
        !replay.ok ||
        pending?.actor !== p.actor ||
        pending.tray !== p.tray ||
        JSON.stringify(pending.original) !== JSON.stringify(game.position) ||
        JSON.stringify(pending.move) !== JSON.stringify(replay.move)
      )
        return {
          ok: false,
          diagnostic: diag(
            'restore-binding',
            'Restore must retain the exact pending player, board, move and capture tray',
            [p.board, p.actor, p.tray],
          ),
        };
      const involved = [
        replay.move.piece,
        ...(replay.move.capture ? [replay.move.capture] : []),
      ];
      if (held.some((v) => !involved.includes(v.item.id)))
        return {
          ok: false,
          diagnostic: diag(
            'hands-occupied',
            'Return unrelated held items before restoring the pending chess move',
            [p.actor],
          ),
        };
      for (const item of involved) {
        const support = rt.world.entities[item]?.support;
        if (
          !(support?.kind === 'in-hand' && support.by === p.actor) &&
          !(
            support?.kind === 'resting-on' &&
            [p.board, p.tray].includes(support.on)
          )
        )
          return {
            ok: false,
            diagnostic: diag(
              'cleanup-required',
              `${item} is unavailable to its original player; no foreign ownership is overwritten`,
              [item, p.actor],
            ),
          };
      }
    }
    if (c[game.position.turn] !== p.actor)
      return {
        ok: false,
        diagnostic: diag(
          'wrong-player',
          `${p.actor} is not bound to ${game.position.turn}'s turn`,
          [p.actor, p.board],
        ),
      };
    const moved = proposeMove(game.position, p.from, p.to);
    if (!moved.ok) return moved;
    if (moved.move.promotion)
      return {
        ok: false,
        diagnostic: diag(
          'promotion-unsupported',
          'This physical set does not yet support exchanging a promotion token; no piece is morphed or spawned',
          [p.board, moved.move.piece],
        ),
      };
    for (const piece of game.position.pieces)
      if (
        !(
          p.restore && [moved.move.piece, moved.move.capture].includes(piece.id)
        ) &&
        !onSlot(rt, piece.id, `${p.board}#${piece.square}`)
      )
        return {
          ok: false,
          diagnostic: diag(
            'piece-moved',
            `${piece.id} is not on its recorded square ${piece.square}`,
            [p.board, piece.id],
          ),
        };
    for (const s of [p.from, p.to]) {
      const slot = surfaceSlot(rt.world, `${p.board}#${s}`);
      if ('code' in slot) return { ok: false, diagnostic: slot };
    }
    const b = rt.world.entities[p.board],
      support = b.support;
    if (support?.kind !== 'resting-on' || !support.slot)
      return {
        ok: false,
        diagnostic: diag(
          'unsupported-board',
          'The board must rest on a usable table slot',
          [p.board],
        ),
      };
    const tableSlot = surfaceSlot(rt.world, `${support.on}#${support.slot}`);
    if ('code' in tableSlot) return { ok: false, diagnostic: tableSlot };
    if (b.pose.p.some((v, i) => Math.abs(v - tableSlot.p[i]) > 1e-6))
      return {
        ok: false,
        diagnostic: diag(
          'board-moved',
          'The board no longer matches its supporting table slot',
          [p.board, support.on],
        ),
      };
    const tray = rt.world.entities[p.tray];
    if (!tray)
      return {
        ok: false,
        diagnostic: diag('missing-tray', 'A captured-token tray is required', [
          p.tray,
        ]),
      };
    const capturedSlot = moved.move.capture
      ? surfaceSlotsOf(rt.world, p.tray).find(
          (s) => !slotOccupant(rt.world, s.owner, s.slot),
        )?.id
      : undefined;
    if (!p.restore && moved.move.capture && !capturedSlot)
      return {
        ok: false,
        diagnostic: diag(
          'tray-full',
          'No free captured-token place is available',
          [p.tray],
        ),
      };
    const program: Program = {
      original: game.position,
      next: moved.position,
      move: moved.move,
      capturedSlot,
      capturedFrom: moved.move.capture
        ? game.position.pieces.find((v) => v.id === moved.move.capture)!.square
        : undefined,
      boardPose: JSON.stringify(b.pose),
      trayPose: JSON.stringify(tray.pose),
    };
    if (p.restore) {
      const restore = rollback(rt, p, program);
      if ('code' in restore) return { ok: false, diagnostic: restore };
      program.restoreOps = restore;
    }
    return { ok: true, program };
  },
  start(rt, p, program, action) {
    const ex: Exec = {
      id: action,
      p,
      program,
      ops: program.restoreOps ?? operations(p, program),
      index: 0,
      stopping: false,
      cleaning: program.restoreOps !== undefined,
      committed: false,
    };
    remember(rt, ex);
    return ex;
  },
  yieldTo: (_rt, self) => [self.id],
  onDirective(rt, ex, by, claims, ancestors) {
    if (ancestors.includes(ex.id) || ex.stopping || by.verb === 'chess_move')
      return;
    // A second game/restore request must pass normal admission without cancelling
    // the already owned transfer. Explicit external control still yields safely.
    if (claims.some((c) => c.resource === `actor:${ex.p.actor}`))
      rt.cancel(
        ex.id,
        diag(
          'directed-away',
          `${by.verb} ${by.id} takes precedence after owned piece cleanup`,
          [ex.id, by.id, ex.p.actor],
        ),
      );
  },
  step(rt, ex) {
    if (ex.stopping && !ex.cleaning) {
      if (ex.child && rt.isActive(ex.child)) rt.cancel(ex.child);
      // A placement already released onto its destination is a completed effect, not undone by cancellation.
      if (onSlot(rt, ex.program.move.piece, `${ex.p.board}#${ex.p.to}`))
        return finish(rt, ex);
      const restore = rollback(rt, ex.p, ex.program);
      if ('code' in restore) return failure(rt, ex, restore);
      ex.ops = restore;
      ex.index = 0;
      ex.child = undefined;
      ex.cleaning = true;
      remember(rt, ex);
    }
    if (ex.child) {
      const child = rt.records.get(ex.child)!;
      if (rt.isActive(child.id))
        return {
          status: 'running',
          phase: ex.cleaning ? 'restoring' : child.phase,
        };
      if (child.status !== 'completed')
        return failure(
          rt,
          ex,
          diag(
            'cleanup-required',
            `Transfer ${child.id} ended ${child.status}; retain the pending move and restore the named physical items before continuing`,
            [
              ex.p.board,
              ex.p.actor,
              ex.ops[ex.index].item,
              ...(child.diagnostic?.subjects ?? []),
            ],
          ),
        );
      ex.index++;
      ex.child = undefined;
      remember(rt, ex);
    }
    if (ex.index >= ex.ops.length) return finish(rt, ex);
    if (
      JSON.stringify(rt.world.entities[ex.p.board]?.pose) !==
        ex.program.boardPose ||
      JSON.stringify(rt.world.entities[ex.p.tray]?.pose) !== ex.program.trayPose
    )
      return failure(
        rt,
        ex,
        diag(
          'surface-moved',
          'The board or capture tray moved; pending physical state is retained for intervention',
          [ex.p.board, ex.p.tray],
        ),
      );
    const op = ex.ops[ex.index],
      child = rt.submit(
        op.slot ? 'put_item' : 'take_item',
        op.slot
          ? { actor: ex.p.actor, item: op.item, surfaceSlot: op.slot }
          : { actor: ex.p.actor, item: op.item, hand: 'right' },
        { parent: ex.id, preempt: false },
      );
    ex.child = child.id;
    return {
      status: 'running',
      phase: ex.cleaning ? 'restoring' : op.slot ? 'placing' : 'taking',
    };
  },
  cancel(_rt, ex) {
    ex.stopping = true;
    return { ok: true, deferred: true };
  },
  resumable:
    'Active chess transfers cannot be restored; safely completed or cancelled board positions persist. Failed cleanup retains explicit pending physical state requiring intervention.',
};
export const CHESS_ACTIONS: ActionDef[] = [chessMove];
