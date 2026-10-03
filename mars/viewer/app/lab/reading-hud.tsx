import { useState } from 'react';
import type { LabSim } from './sim.ts';
import { readBook } from '../../engine/objects/reading.ts';
import { READING_BINDING as binding } from '../../engine/scenarios/reading.ts';
export function ReadingHud({
  sim,
  refresh,
}: {
  sim: LabSim;
  refresh: () => void;
}) {
  const [feedback, setFeedback] = useState(
    'Start reading, interrupt safely, then resume the retained bookmark.',
  );
  if (sim.scenario.name !== 'quiet-reading') return null;
  const rt = sim.rt,
    state = readBook(rt, 'book');
  const active = [...rt.records.values()].find(
    (r) => r.verb === 'read_book' && rt.isActive(r.id),
  );
  const begin = (resume = false) => {
    const r = rt.submit('read_book', { ...binding, resume });
    setFeedback(
      r.diagnostic
        ? `${r.diagnostic.code}: ${r.diagnostic.message}`
        : resume
          ? 'Returning to the same bookmark.'
          : 'Approaching the book.',
    );
    refresh();
  };
  return (
    <section className="lab-hud lab-classroom" data-testid="reading-hud">
      <h3>Quiet reading</h3>
      <p>
        Hypothetical staging. Four compressed sections at one usable table; the
        same book stays in its slot. Play advances reading. Stop stands the
        reader up before releasing the chair and book.
      </p>
      <div data-testid="reading-readout">
        {'code' in state
          ? `${state.code}: ${state.message}`
          : `${state.status} · section ${state.page}/${state.pages} · ${state.elapsed.toFixed(1)}/${state.duration || binding.duration}s`}
      </div>
      <div className="lab-classroom-controls">
        <button
          disabled={
            !!active || !('status' in state) || state.status === 'unfinished'
          }
          onClick={() => begin()}
        >
          Start reading
        </button>
        <button
          disabled={!active}
          onClick={() => {
            rt.cancel(active!.id);
            setFeedback('Safely leaving the chair; bookmark retained.');
            refresh();
          }}
        >
          Interrupt reading
        </button>
        <button
          disabled={
            !!active || !('status' in state) || state.status !== 'unfinished'
          }
          onClick={() => begin(true)}
        >
          Resume reading
        </button>
        <button
          onClick={() => {
            const r = rt.submit('walk_to', {
              actor: binding.actor,
              x: 3,
              z: -3,
            });
            setFeedback(
              r.diagnostic
                ? `${r.diagnostic.code}: ${r.diagnostic.message}`
                : 'Player direction takes precedence; bookmark will be retained.',
            );
            refresh();
          }}
        >
          Direct reader away
        </button>
      </div>
      <div role="status">
        {'status' in state && state.status === 'completed'
          ? 'Reading complete. The reader has stood up; the same book and completed bookmark remain.'
          : feedback}
      </div>
    </section>
  );
}
