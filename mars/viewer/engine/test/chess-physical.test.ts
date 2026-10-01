import { readChess } from '../objects/chess.ts';
import { boardStatus } from '../games/chess-rules.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chessRuntime } from '../scenarios/chess.ts';
import { Runtime } from '../runtime/runtime.ts';
import { SnapshotError } from '../runtime/snapshot.ts';
import { Spatial } from '../spatial/service.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { READING_SCENE } from '../scenarios/reading.ts';
function finish(rt: Runtime, id: string) {
  for (let i = 0; i < 1200 && rt.isActive(id); i++) rt.step();
  const r = rt.records.get(id)!;
  assert.equal(r.status, 'completed', JSON.stringify(r.diagnostic));
  assert.deepEqual(rt.violations, []);
}
for (const yaw of [0, Math.PI / 2])
  test(`ordinary item transfers at an actual chess board/table retain identity and support, yaw ${yaw}`, () => {
    const rt = chessRuntime(yaw),
      piece = 'white-pawn-f2',
      before = structuredClone(rt.world.entities[piece]),
      count = Object.keys(rt.world.entities).length;
    const take = rt.submit('take_item', {
      actor: 'white-player',
      item: piece,
      hand: 'right',
    });
    finish(rt, take.id);
    assert.deepEqual(rt.world.entities[piece].support, {
      kind: 'in-hand',
      by: 'white-player',
      hand: 'right',
    });
    const put = rt.submit('put_item', {
      actor: 'white-player',
      item: piece,
      surfaceSlot: 'board#f3',
    });
    finish(rt, put.id);
    assert.deepEqual(rt.world.entities[piece].support, {
      kind: 'resting-on',
      on: 'board',
      slot: 'f3',
    });
    assert.equal(rt.world.entities[piece].id, before.id);
    assert.equal(rt.world.entities[piece].def, before.def);
    assert.equal(Object.keys(rt.world.entities).length, count);
    assert.deepEqual(rt.holder('actor:white-player'), []);
    assert.deepEqual(rt.holder(`entity:${piece}`), []);
    assert.deepEqual(rt.holder('surface-slot:board#f3'), []);
    rt.step();
    assert.deepEqual(rt.holder('holds:white-player'), []);
  });

test('two actors play an actual supported four-turn game; rules commit only after physical placements', () => {
  const rt = chessRuntime(),
    n = Object.keys(rt.world.entities).length;
  for (const [actor, from, to] of [
    ['white-player', 'f2', 'f3'],
    ['black-player', 'e7', 'e5'],
    ['white-player', 'g2', 'g4'],
    ['black-player', 'd8', 'h4'],
  ]) {
    const before = readChess(rt, 'board');
    assert.ok(!('code' in before));
    const r = rt.submit('chess_move', {
      actor,
      board: 'board',
      from,
      to,
      tray: 'capture-tray',
    });
    assert.notEqual(r.status, 'failed', JSON.stringify(r.diagnostic));
    rt.step();
    const during = readChess(rt, 'board');
    assert.ok(!('code' in during));
    assert.equal(
      during.position.ply,
      before.position.ply,
      'no turn committed before placement',
    );
    finish(rt, r.id);
    const after = readChess(rt, 'board');
    assert.ok(!('code' in after));
    assert.equal(after.position.ply, before.position.ply + 1);
    assert.equal(after.pending, false);
  }
  const game = readChess(rt, 'board');
  assert.ok(!('code' in game));
  assert.equal(boardStatus(game.position), 'checkmate');
  assert.equal(Object.keys(rt.world.entities).length, n);
});

test('interrupt after pickup physically restores the same token before a player walk acquires control', () => {
  const rt = chessRuntime(),
    original = structuredClone(rt.world.entities['white-pawn-f2']),
    game = readChess(rt, 'board');
  const r = rt.submit('chess_move', {
    actor: 'white-player',
    board: 'board',
    from: 'f2',
    to: 'f3',
    tray: 'capture-tray',
  });
  for (
    let i = 0;
    i < 500 && rt.world.entities['white-pawn-f2'].support?.kind !== 'in-hand';
    i++
  )
    rt.step();
  assert.equal(rt.world.entities['white-pawn-f2'].support?.kind, 'in-hand');
  const directed = rt.submit('walk_to', {
    actor: 'white-player',
    x: -5,
    z: -3,
  });
  for (
    let i = 0;
    i < 1200 && (rt.isActive(r.id) || rt.isActive(directed.id));
    i++
  )
    rt.step();
  assert.equal(r.status, 'cancelled', JSON.stringify(r.diagnostic));
  assert.equal(
    directed.status,
    'completed',
    JSON.stringify(directed.diagnostic),
  );
  assert.deepEqual(
    rt.world.entities['white-pawn-f2'].support,
    original.support,
  );
  assert.deepEqual(rt.world.entities['white-pawn-f2'].pose, original.pose);
  assert.deepEqual(readChess(rt, 'board'), game);
  assert.deepEqual(rt.violations, []);
});

test('a real capture retains the exact opponent token in a supported tray, with no spawn or deletion', () => {
  const rt = chessRuntime(),
    count = Object.keys(rt.world.entities).length;
  for (const [actor, from, to] of [
    ['white-player', 'e2', 'e4'],
    ['black-player', 'd7', 'd5'],
    ['white-player', 'e4', 'd5'],
  ])
    finish(
      rt,
      rt.submit('chess_move', {
        actor,
        board: 'board',
        from,
        to,
        tray: 'capture-tray',
      }).id,
    );
  assert.deepEqual(rt.world.entities['black-pawn-d7'].support, {
    kind: 'resting-on',
    on: 'capture-tray',
    slot: 'captured-0',
  });
  assert.deepEqual(rt.world.entities['white-pawn-e2'].support, {
    kind: 'resting-on',
    on: 'board',
    slot: 'd5',
  });
  const game = readChess(rt, 'board');
  assert.ok(!('code' in game));
  assert.equal(game.position.pieces.length, 31);
  assert.equal(Object.keys(rt.world.entities).length, count);
});

test('illegal moves, wrong participants, shifted support and missing board refuse without altering the world', () => {
  for (const change of [
    'illegal',
    'wrong-player',
    'board-moved',
    'missing-board',
  ]) {
    const rt = chessRuntime();
    if (change === 'board-moved') rt.world.entities.board.pose.p[0] += 0.2;
    if (change === 'missing-board') delete rt.world.entities.board;
    const before = structuredClone(rt.world),
      r = rt.submit('chess_move', {
        actor: change === 'wrong-player' ? 'black-player' : 'white-player',
        board: 'board',
        from: 'f2',
        to: change === 'illegal' ? 'f5' : 'f3',
        tray: 'capture-tray',
      });
    assert.equal(r.status, 'failed');
    assert.ok(r.diagnostic?.code.startsWith('chess.'));
    assert.deepEqual(rt.world, before);
    assert.deepEqual(rt.holder('chess:board'), []);
  }
});

test('interrupted capture restores both existing pieces and keeps the uncommitted turn', () => {
  const rt = chessRuntime();
  for (const [actor, from, to] of [
    ['white-player', 'e2', 'e4'],
    ['black-player', 'd7', 'd5'],
  ])
    finish(
      rt,
      rt.submit('chess_move', {
        actor,
        board: 'board',
        from,
        to,
        tray: 'capture-tray',
      }).id,
    );
  const before = readChess(rt, 'board'),
    r = rt.submit('chess_move', {
      actor: 'white-player',
      board: 'board',
      from: 'e4',
      to: 'd5',
      tray: 'capture-tray',
    });
  for (
    let i = 0;
    i < 600 && rt.world.entities['white-pawn-e2'].support?.kind !== 'in-hand';
    i++
  )
    rt.step();
  assert.equal(rt.world.entities['black-pawn-d7'].support?.kind, 'resting-on');
  assert.equal(rt.world.entities['white-pawn-e2'].support?.kind, 'in-hand');
  rt.cancel(r.id);
  for (let i = 0; i < 1200 && rt.isActive(r.id); i++) rt.step();
  assert.equal(r.status, 'cancelled', JSON.stringify(r.diagnostic));
  assert.deepEqual(readChess(rt, 'board'), before);
  assert.deepEqual(rt.world.entities['white-pawn-e2'].support, {
    kind: 'resting-on',
    on: 'board',
    slot: 'e4',
  });
  assert.deepEqual(rt.world.entities['black-pawn-d7'].support, {
    kind: 'resting-on',
    on: 'board',
    slot: 'd5',
  });
  assert.deepEqual(rt.violations, []);
});

test('a move keeps token, supporting furniture and rollback slots reserved between physical transfers', () => {
  const rt = chessRuntime();
  const r = rt.submit('chess_move', {
    actor: 'white-player',
    board: 'board',
    from: 'f2',
    to: 'f3',
    tray: 'capture-tray',
  });
  for (const resource of [
    'entity:white-pawn-f2',
    'entity:board',
    'entity:capture-tray',
    'entity:chess-table',
    'surface-slot:board#f2',
    'surface-slot:board#f3',
  ])
    assert.deepEqual(rt.holder(resource), [r.id], resource);
  const stolen = rt.submit(
    'take_item',
    { actor: 'black-player', item: 'white-pawn-f2', hand: 'right' },
    { preempt: false },
  );
  assert.equal(stolen.status, 'failed');
  assert.equal(stolen.diagnostic?.code, 'reservation.conflict');
  finish(rt, r.id);
  for (const resource of [
    'entity:white-pawn-f2',
    'entity:board',
    'entity:capture-tray',
    'entity:chess-table',
    'surface-slot:board#f2',
    'surface-slot:board#f3',
  ])
    assert.deepEqual(rt.holder(resource), [], resource);
});

test('en passant uses the actual captured square for physical cleanup, not the empty destination', () => {
  const position = {
    pieces: [
      {
        id: 'white-king-e1',
        color: 'white' as const,
        kind: 'king' as const,
        square: 'e1',
      },
      {
        id: 'black-king-e8',
        color: 'black' as const,
        kind: 'king' as const,
        square: 'e8',
      },
      {
        id: 'white-pawn-e2',
        color: 'white' as const,
        kind: 'pawn' as const,
        square: 'e5',
      },
      {
        id: 'black-pawn-d7',
        color: 'black' as const,
        kind: 'pawn' as const,
        square: 'd5',
      },
    ],
    turn: 'white' as const,
    ply: 3,
    enPassant: 'd6',
  };
  const rt = chessRuntime(0, position),
    before = readChess(rt, 'board');
  const r = rt.submit('chess_move', {
    actor: 'white-player',
    board: 'board',
    from: 'e5',
    to: 'd6',
    tray: 'capture-tray',
  });
  assert.notEqual(r.status, 'failed', JSON.stringify(r.diagnostic));
  assert.deepEqual(rt.holder('surface-slot:board#d5'), [r.id]);
  assert.deepEqual(rt.holder('surface-slot:capture-tray#captured-0'), [r.id]);
  for (
    let i = 0;
    i < 600 && rt.world.entities['white-pawn-e2'].support?.kind !== 'in-hand';
    i++
  )
    rt.step();
  assert.equal(rt.world.entities['white-pawn-e2'].support?.kind, 'in-hand');
  rt.cancel(r.id);
  for (let i = 0; i < 1200 && rt.isActive(r.id); i++) rt.step();
  assert.equal(r.status, 'cancelled', JSON.stringify(r.diagnostic));
  assert.deepEqual(readChess(rt, 'board'), before);
  assert.deepEqual(rt.world.entities['black-pawn-d7'].support, {
    kind: 'resting-on',
    on: 'board',
    slot: 'd5',
  });
  assert.deepEqual(rt.violations, []);
});

test('a failed child retains the unfinished physical token, then explicit restoration cleans it without committing a turn', () => {
  const rt = chessRuntime(),
    original = readChess(rt, 'board');
  const r = rt.submit('chess_move', {
    actor: 'white-player',
    board: 'board',
    from: 'f2',
    to: 'f3',
    tray: 'capture-tray',
  });
  let placement: string | undefined;
  for (let i = 0; i < 600; i++) {
    rt.step();
    placement = [...rt.records.values()].find(
      (v) => v.parent === r.id && v.verb === 'put_item' && rt.isActive(v.id),
    )?.id;
    if (placement) break;
  }
  assert.ok(
    placement,
    'physical placement must actually start before disruption',
  );
  rt.cancel(placement);
  for (let i = 0; i < 100 && rt.isActive(r.id); i++) rt.step();
  assert.equal(r.status, 'failed');
  assert.equal(r.diagnostic?.code, 'chess.cleanup-required');
  assert.equal(rt.world.entities['white-pawn-f2'].support?.kind, 'in-hand');
  const retry = rt.submit('chess_move', {
    actor: 'white-player',
    board: 'board',
    from: 'f2',
    to: 'f3',
    tray: 'capture-tray',
  });
  assert.equal(retry.status, 'failed');
  assert.equal(retry.diagnostic?.code, 'chess.hands-occupied');
  const wrong = rt.submit('chess_move', {
    actor: 'black-player',
    board: 'board',
    from: 'f2',
    to: 'f3',
    tray: 'capture-tray',
    restore: true,
  });
  assert.equal(wrong.status, 'failed');
  assert.equal(wrong.diagnostic?.code, 'chess.restore-binding');
  const recovery = rt.submit('chess_move', {
    actor: 'white-player',
    board: 'board',
    from: 'f2',
    to: 'f3',
    tray: 'capture-tray',
    restore: true,
  });
  finish(rt, recovery.id);
  assert.equal(recovery.outputs?.committed, false);
  assert.deepEqual(readChess(rt, 'board'), original);
  assert.deepEqual(rt.world.entities['white-pawn-f2'].support, {
    kind: 'resting-on',
    on: 'board',
    slot: 'f2',
  });
  assert.deepEqual(rt.violations, []);
  finish(
    rt,
    rt.submit('chess_move', {
      actor: 'white-player',
      board: 'board',
      from: 'f2',
      to: 'f3',
      tray: 'capture-tray',
    }).id,
  );
});

test('explicit restoration refuses active or absent pending state without changing the world', () => {
  const rt = chessRuntime(),
    before = structuredClone(rt.world);
  const p = {
    actor: 'white-player',
    board: 'board',
    from: 'f2',
    to: 'f3',
    tray: 'capture-tray',
    restore: true,
  };
  const absent = rt.submit('chess_move', p);
  assert.equal(absent.status, 'failed');
  assert.equal(absent.diagnostic?.code, 'chess.no-unfinished-move');
  assert.deepEqual(rt.world, before);
  const active = rt.submit('chess_move', { ...p, restore: false });
  assert.ok(rt.isActive(active.id));
  const during = structuredClone(rt.world),
    refused = rt.submit('chess_move', p);
  assert.equal(refused.status, 'failed');
  assert.equal(refused.diagnostic?.code, 'chess.no-unfinished-move');
  assert.deepEqual(rt.world, during);
  finish(rt, active.id);
});

test('unavailable, tilted or unsupported equipment refuses before claiming or moving tokens', () => {
  for (const [kind, code] of [
    ['unavailable', 'chess.unavailable'],
    ['tilted', 'chess.flat-support-required'],
    ['tray-moved', 'chess.surface-moved'],
    ['tray-unsupported', 'chess.support-required'],
  ]) {
    const rt = chessRuntime();
    if (kind === 'unavailable')
      rt.world.entities.board.equipment!.config.available = false;
    if (kind === 'tilted') rt.world.entities.board.pose.pitch = 0.2;
    if (kind === 'tray-moved')
      rt.world.entities['capture-tray'].pose.p[0] += 0.1;
    if (kind === 'tray-unsupported')
      rt.world.entities['capture-tray'].support = { kind: 'ground' };
    const before = structuredClone(rt.world),
      r = rt.submit('chess_move', {
        actor: 'white-player',
        board: 'board',
        from: 'f2',
        to: 'f3',
        tray: 'capture-tray',
      });
    assert.equal(r.status, 'failed');
    assert.equal(r.diagnostic?.code, code);
    assert.deepEqual(rt.world, before);
    assert.deepEqual(rt.holder('chess:board'), []);
  }
});

test('completed board and capture state persist exactly; dropping active transfer is explicitly unsafe', () => {
  const rt = chessRuntime();
  finish(
    rt,
    rt.submit('chess_move', {
      actor: 'white-player',
      board: 'board',
      from: 'e2',
      to: 'e4',
      tray: 'capture-tray',
    }).id,
  );
  const copy = Runtime.restore(
    JSON.parse(JSON.stringify(rt.snapshot())),
    createRegistry(),
    { spatial: new Spatial(READING_SCENE) },
    ENGINE_INVARIANTS,
  );
  assert.deepEqual(copy.world, rt.world);
  assert.deepEqual(readChess(copy, 'board'), readChess(rt, 'board'));
  const action = copy.submit('chess_move', {
    actor: 'black-player',
    board: 'board',
    from: 'd7',
    to: 'd5',
    tray: 'capture-tray',
  });
  const before = copy.stateHash();
  assert.throws(
    () => copy.snapshot({ allowDrop: true }),
    (e: unknown) =>
      e instanceof SnapshotError &&
      e.code === 'snapshot.drop-unsafe' &&
      e.subjects.includes('board'),
  );
  assert.equal(copy.stateHash(), before);
  finish(copy, action.id);
  finish(
    copy,
    copy.submit('chess_move', {
      actor: 'white-player',
      board: 'board',
      from: 'e4',
      to: 'd5',
      tray: 'capture-tray',
    }).id,
  );
  const again = Runtime.restore(
    JSON.parse(JSON.stringify(copy.snapshot())),
    createRegistry(),
    { spatial: new Spatial(READING_SCENE) },
    ENGINE_INVARIANTS,
  );
  assert.deepEqual(again.world, copy.world);
  assert.deepEqual(again.world.entities['black-pawn-d7'].support, {
    kind: 'resting-on',
    on: 'capture-tray',
    slot: 'captured-0',
  });
});

test('same bound decisions reproduce tick-exact world state and physical events', () => {
  const a = chessRuntime(),
    b = chessRuntime();
  for (const rt of [a, b])
    for (const [actor, from, to] of [
      ['white-player', 'e2', 'e4'],
      ['black-player', 'd7', 'd5'],
      ['white-player', 'e4', 'd5'],
    ])
      finish(
        rt,
        rt.submit('chess_move', {
          actor,
          board: 'board',
          from,
          to,
          tray: 'capture-tray',
        }).id,
      );
  assert.equal(a.tick, b.tick);
  assert.equal(a.stateHash(), b.stateHash());
  assert.deepEqual(a.events, b.events);
  assert.deepEqual(a.violations, []);
});

test('a genuinely blocked table route fails coherently and clears only through explicit owned restoration', () => {
  const scene = structuredClone(READING_SCENE);
  for (const [id, x, z, hx, hz] of [
    ['south', 0, -0.9, 1.55, 0.05],
    ['north', 0, 0.9, 1.55, 0.05],
    ['east', 1.5, 0, 0.05, 0.9],
    ['west', -1.5, 0, 0.05, 0.9],
  ] as const)
    scene.obstacles.push({
      id: `blocked-table-${id}`,
      obb: { c: [x, z], half: [hx, hz], yaw: 0 },
      y0: 0,
      y1: 2.2,
      kind: 'wall',
    });
  const rt = chessRuntime(0, undefined, scene),
    before = readChess(rt, 'board'),
    pawn = structuredClone(rt.world.entities['white-pawn-f2']);
  const r = rt.submit('chess_move', {
    actor: 'white-player',
    board: 'board',
    from: 'f2',
    to: 'f3',
    tray: 'capture-tray',
  });
  for (let i = 0; i < 1200 && rt.isActive(r.id); i++) rt.step();
  assert.equal(r.status, 'failed');
  assert.equal(r.diagnostic?.code, 'chess.cleanup-required');
  assert.ok(
    r.diagnostic.subjects?.some((s) => s.startsWith('blocked-table-')),
    JSON.stringify(r.diagnostic),
  );
  assert.deepEqual(rt.world.entities['white-pawn-f2'].pose, pawn.pose);
  assert.deepEqual(rt.world.entities['white-pawn-f2'].support, pawn.support);
  assert.deepEqual(rt.holder('actor:white-player'), []);
  assert.deepEqual(rt.violations, []);
  finish(
    rt,
    rt.submit('chess_move', {
      actor: 'white-player',
      board: 'board',
      from: 'f2',
      to: 'f3',
      tray: 'capture-tray',
      restore: true,
    }).id,
  );
  assert.deepEqual(readChess(rt, 'board'), before);
});

test('an unrelated prop cannot masquerade as the recorded token; appearance and game role bind through capabilities', () => {
  const rt = chessRuntime();
  rt.world.entities['white-pawn-f2'].def = 'bowl';
  const before = structuredClone(rt.world),
    r = rt.submit('chess_move', {
      actor: 'white-player',
      board: 'board',
      from: 'f2',
      to: 'f3',
      tray: 'capture-tray',
    });
  assert.equal(r.status, 'failed');
  assert.equal(r.diagnostic?.code, 'chess.token-mismatch');
  assert.deepEqual(rt.world, before);
});
