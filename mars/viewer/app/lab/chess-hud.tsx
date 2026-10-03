import { useMemo, useState } from 'react';
import type { LabSim } from './sim.ts';
import { readChess } from '../../engine/objects/chess.ts';
import {
  legalMoves,
  boardStatus,
  validatePosition,
} from '../../engine/games/chess-rules.ts';
const preferred = [
  ['f2', 'f3'],
  ['e7', 'e5'],
  ['g2', 'g4'],
  ['d8', 'h4'],
];
export function ChessHud({
  sim,
  refresh,
}: {
  sim: LabSim;
  refresh: () => void;
}) {
  const [chosen, setChosen] = useState(''),
    [feedback, setFeedback] = useState(
      'Choose a turn, then Play to watch its physical execution.',
    );
  const rt = sim.rt,
    key = rt.world.entities.board?.equipment?.config.position;
  // Board decisions change with a committed position, not on every render/tick.
  const position = useMemo(() => {
    try {
      const parsed = validatePosition(JSON.parse(String(key)));
      return parsed.ok ? parsed.position : null;
    } catch {
      return null;
    }
  }, [key]);
  const options = useMemo(
    () => (position ? legalMoves(position).filter((m) => !m.promotion) : []),
    [position],
  );
  const status = useMemo(
    () => (position ? boardStatus(position) : 'invalid'),
    [position],
  );
  if (sim.scenario.name !== 'tabletop-chess') return null;
  const current = readChess(rt, 'board');
  const active = [...rt.records.values()].find(
    (r) => r.verb === 'chess_move' && rt.isActive(r.id),
  );
  const pair = position ? preferred[position.ply] : undefined;
  const proposed =
    options.find((m) => pair && m.from === pair[0] && m.to === pair[1]) ??
    options[0];
  const selected =
    options.find((m) => `${m.from}-${m.to}` === chosen) ?? proposed;
  const actor = position
    ? String(rt.world.entities.board.equipment?.config[position.turn] ?? '')
    : '';
  const submit = (restore = false) => {
    let from = selected?.from,
      to = selected?.to,
      player = actor,
      tray = 'capture-tray';
    if (restore) {
      try {
        const pending = JSON.parse(
          String(rt.world.entities.board.equipment?.config.pending),
        );
        from = pending.move?.from;
        to = pending.move?.to;
        player = pending.actor;
        tray = pending.tray;
      } catch {
        setFeedback(
          'Invalid pending metadata; the engine must diagnose it rather than guess a replacement.',
        );
        return;
      }
    }
    const r = rt.submit('chess_move', {
      actor: player,
      board: 'board',
      from,
      to,
      tray,
      ...(restore ? { restore: true } : {}),
    });
    setFeedback(
      r.diagnostic
        ? `${r.diagnostic.code}: ${r.diagnostic.message}`
        : restore
          ? 'Restoring the exact unfinished move; no turn is committed.'
          : `Physical ${from} to ${to}; turn commits only after placement.`,
    );
    refresh();
  };
  return (
    <section className="lab-hud lab-classroom" data-testid="chess-hud">
      <h3>Tabletop chess</h3>
      <p>
        Two hypothetical standing players use the same physical set. Choose any
        supported legal move; the initial proposals demonstrate a short
        four-turn checkmate. Change a proposal to play another game. Captured
        pieces remain in the tray.
      </p>
      <div data-testid="chess-readout">
        {'code' in current
          ? `${current.code}: ${current.message}`
          : `${status} · ${current.position.turn}'s turn · ${current.position.ply} completed moves · ${current.status}`}
      </div>
      <label>
        Proposed chess move{' '}
        <select
          aria-label="Proposed chess move"
          disabled={!!active || !('pending' in current) || current.pending}
          value={selected ? `${selected.from}-${selected.to}` : ''}
          onChange={(e) => setChosen(e.target.value)}
        >
          {options.map((m) => (
            <option key={`${m.from}-${m.to}`} value={`${m.from}-${m.to}`}>
              {m.from} → {m.to}
              {m.capture ? ' · capture' : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="lab-classroom-controls">
        <button
          disabled={
            !!active || !selected || !('pending' in current) || current.pending
          }
          onClick={() => submit()}
        >
          Play proposed move
        </button>
        <button
          disabled={!active}
          onClick={() => {
            rt.cancel(active!.id);
            setFeedback(
              'Safely restoring held pieces; an already placed move remains committed.',
            );
            refresh();
          }}
        >
          Interrupt chess move
        </button>
        <button
          disabled={!!active || !('pending' in current) || !current.pending}
          onClick={() => submit(true)}
        >
          Restore unfinished chess move
        </button>
        <button
          disabled={!actor}
          onClick={() => {
            const r = rt.submit('walk_to', {
              actor,
              x: actor === 'white-player' ? -3 : 3,
              z: -2,
            });
            setFeedback(
              r.diagnostic
                ? `${r.diagnostic.code}: ${r.diagnostic.message}`
                : 'Player direction waits for owned piece cleanup, then takes control.',
            );
            refresh();
          }}
        >
          Direct current player away
        </button>
      </div>
      <div role="status">
        {active
          ? `${active.params && typeof active.params === 'object' && 'actor' in active.params ? String(active.params.actor) : ''}: ${active.phase ?? active.status}`
          : feedback}
      </div>
      <p className="lab-meta">
        Play advances physical movement; Pause freezes it. Castling and physical
        pawn promotion are unsupported. No chess clock, threefold/fifty-move
        adjudication, seated hand choreography or strong AI. Safe
        completed/cancelled board positions persist; active transfer restoration
        is unsupported. After failed cleanup, resolve the named obstacle or
        ownership problem and explicitly Restore unfinished chess move.
      </p>
    </section>
  );
}
