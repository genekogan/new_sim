import { useState } from 'react';
import type { LabSim } from './sim.ts';
import { preparationParams } from '../../engine/scenarios/preparation.ts';
import { preparationReadout } from './preparation.ts';

export function PreparationHud({
  sim,
  refresh,
}: {
  sim: LabSim;
  refresh: () => void;
}) {
  const [feedback, setFeedback] = useState(
    'Start preparation; Play advances ordinary approach, spoon transfers and mixing.',
  );
  if (
    !['cold-preparation', 'cold-preparation-rotated'].includes(
      sim.scenario.name,
    )
  )
    return null;
  const rt = sim.rt,
    state = preparationReadout(rt);
  if (!state) return null;
  const active = [...rt.records.values()].find(
    (r) => r.verb === 'prepare_food' && rt.isActive(r.id),
  );
  const spoon = rt.world.entities.spoon;
  const holding =
    spoon.support?.kind === 'in-hand' && spoon.support.by === 'cook';
  const busy =
    rt.holder('actor:cook').length > 0 ||
    rt.holder('hand:cook:right').length > 0 ||
    rt.holder('hand:cook:left').length > 0;
  const bowl = rt.world.entities.beans;
  const bowlHeld =
    bowl.support?.kind === 'in-hand' && bowl.support.by === 'cook';
  const servings = Math.floor(
    (rt.world.entities.pot.contents?.fraction ?? 0) * 4,
  );
  const ordinary = (
    verb: string,
    params: Record<string, string>,
    message: string,
  ) => {
    const record = rt.submit(verb, { actor: 'cook', ...params });
    setFeedback(
      record.diagnostic
        ? `${record.diagnostic.code}: ${record.diagnostic.message}`
        : message,
    );
    refresh();
  };
  const begin = (resume: boolean) => {
    const record = rt.submit('prepare_food', preparationParams());
    setFeedback(
      record.diagnostic
        ? `${record.diagnostic.code}: ${record.diagnostic.message}`
        : resume
          ? 'Resuming the same pot, ingredients and deposited quantities.'
          : 'Approaching the same table and taking the spoon.',
    );
    refresh();
  };
  return (
    <section className="lab-hud lab-classroom" data-testid="preparation-hud">
      <h3>Cold meal preparation</h3>
      <p>
        Hypothetical staging. Two full ingredient bowls make two full servings
        in one pot through quarter-bowl deposits and mixing. No heat or
        chopping. Interruption retains completed deposits; the spoon may remain
        held. Resume uses these same objects. Reset replaces this world; active
        reload restoration is unsupported. After preparation, take the emptied
        ingredient bowl, serve with the held spoon and eat; return both objects
        explicitly when finished.
      </p>
      <div data-testid="preparation-readout">
        {state.phase} · {state.status} ·{' '}
        {state.preparation?.complete
          ? 'ready for serving'
          : 'unfinished, not ready for serving'}{' '}
        · mixing {state.mixedTicks}/{state.mixTicks}
      </div>
      <ul data-testid="preparation-quantities">
        {state.items
          .filter((item) => item.contents)
          .map((item) => (
            <li key={item.id}>
              {item.id}: {item.contents!.fraction.toFixed(4)}{' '}
              {item.id === 'pot' ? 'pot' : 'bowl'} remaining ·{' '}
              {item.support?.kind}
            </li>
          ))}
      </ul>
      <div className="lab-classroom-controls">
        <button
          disabled={busy || !!state.preparation}
          onClick={() => begin(false)}
        >
          Start preparation
        </button>
        <button
          disabled={
            busy ||
            !state.preparation?.complete ||
            bowlHeld ||
            (bowl.contents?.fraction ?? 0) !== 0
          }
          onClick={() =>
            ordinary(
              'take_item',
              { item: 'beans', hand: 'left' },
              'Taking the same emptied ingredient bowl for a serving.',
            )
          }
        >
          Take empty bowl
        </button>
        <button
          disabled={busy || holding || !state.preparation?.complete}
          onClick={() =>
            ordinary(
              'take_item',
              { item: 'spoon', hand: 'right' },
              'Taking the same spoon through ordinary pickup.',
            )
          }
        >
          Take spoon
        </button>
        <button
          disabled={
            busy ||
            !bowlHeld ||
            !holding ||
            !state.preparation?.complete ||
            servings < 1 ||
            (bowl.contents?.fraction ?? 0) !== 0
          }
          onClick={() =>
            ordinary(
              'serve',
              { pot: 'pot', bowl: 'beans' },
              'Serving one full portion from the prepared pot.',
            )
          }
        >
          Serve prepared dish
        </button>
        <button
          disabled={
            busy || !bowlHeld || !holding || (bowl.contents?.fraction ?? 0) <= 0
          }
          onClick={() =>
            ordinary(
              'eat',
              { bowl: 'beans', spoon: 'spoon' },
              'Eating the actual served food with the same spoon.',
            )
          }
        >
          Eat serving
        </button>
        <button
          disabled={busy || !bowlHeld}
          onClick={() =>
            ordinary(
              'put_item',
              { item: 'beans', surfaceSlot: 'table#r0c1' },
              'Returning the same bowl to its original table slot.',
            )
          }
        >
          Return bowl
        </button>
        <button
          disabled={!active}
          onClick={() => {
            rt.cancel(active!.id);
            setFeedback(
              'Stopping safely. Completed deposits and mixing progress stay in the same pot.',
            );
            refresh();
          }}
        >
          Interrupt preparation
        </button>
        <button
          disabled={busy || !state.preparation || state.preparation.complete}
          onClick={() => begin(true)}
        >
          Resume same preparation
        </button>
        <button
          disabled={busy || !holding}
          onClick={() => {
            const record = rt.submit('put_item', {
              actor: 'cook',
              item: 'spoon',
              surfaceSlot: 'table#r0c4',
            });
            setFeedback(
              record.diagnostic
                ? `${record.diagnostic.code}: ${record.diagnostic.message}`
                : 'Returning the same spoon to its original table slot through ordinary placement.',
            );
            refresh();
          }}
        >
          Put spoon down
        </button>
      </div>
      <div role="status">
        {state.preparation?.complete
          ? `Preparation complete: ${servings} full servings remain in the pot. ${holding ? 'The same spoon is held; serve/eat or put it down explicitly.' : 'The spoon is supported on the table.'}`
          : feedback}
      </div>
      {state.preparation?.complete && <p>{feedback}</p>}
    </section>
  );
}
