import { useState } from 'react';
import type { LabSim } from './sim.ts';
import {
  readGardenAfternoon,
  startGardenAfternoon,
  controlGardenAfternoon,
  gardenAfternoonDirection,
  type GardenAfternoonBranch,
} from '../../engine/scenarios/garden-afternoon.ts';
export function GardenAfternoonHud({
  sim,
  refresh,
}: {
  sim: LabSim;
  refresh: () => void;
}) {
  const [feedback, setFeedback] = useState<{ epoch: number; text: string }>();
  if (
    !['garden-afternoon', 'garden-afternoon-rotated'].includes(
      sim.scenario.name,
    )
  )
    return null;
  const rt = sim.rt,
    epoch = sim.scenarioEpoch,
    angle = sim.scenario.name.endsWith('-rotated') ? Math.PI / 2 : 0,
    s = readGardenAfternoon(rt);
  const fresh = () => sim.rt === rt && sim.scenarioEpoch === epoch;
  const reply = (
    result:
      | { diagnostic?: { code: string; message: string } }
      | { code: string; message: string },
    text: string,
  ) => {
    const d = 'code' in result ? result : result.diagnostic;
    setFeedback({ epoch, text: d ? `${d.code}: ${d.message}` : text });
    refresh();
  };
  const pending = (id: string) =>
    [...rt.records.values()].some(
      (r) =>
        r.verb === 'living_intention_control' &&
        rt.isActive(r.id) &&
        (r.params as { intention?: string }).intention === id,
    );
  const admission = (
    branch: GardenAfternoonBranch,
    intent: 'pause' | 'resume' | 'end',
  ) => {
    const b = readGardenAfternoon(rt)?.branches[branch];
    return b && !pending(b.id)
      ? rt.registry
          .get('living_intention_control')
          ?.plan(rt, { intention: b.id, intent })
      : undefined;
  };
  return (
    <section
      className="lab-hud lab-classroom"
      data-testid="garden-afternoon-hud"
    >
      <h3>Garden and reading afternoon</h3>
      <p>
        Hypothetical anonymous gardener and reader. The gardener plants finite
        seeds, walks to the courtyard, then waters the same bed. The reader
        reads four seconds, walks independently and returns to the same
        unfinished book. These walks are independent; no synchronized
        conversation is claimed.
      </p>
      <button
        disabled={!!s}
        onClick={() => {
          if (fresh() && !readGardenAfternoon(rt))
            reply(
              startGardenAfternoon(rt, angle),
              'Both existing intentions started. Play advances ordinary physical actions.',
            );
        }}
      >
        Start garden afternoon
      </button>
      {(['gardener', 'reader'] as const).map((branch) => {
        const b = s?.branches[branch],
          walk = gardenAfternoonDirection(branch, angle),
          walkPlan = rt.registry.get('walk_to')?.plan(rt, walk),
          directPending = () =>
            [...rt.records.values()].some(
              (r) =>
                r.verb === 'walk_to' &&
                !r.parent &&
                rt.isActive(r.id) &&
                (r.params as { actor?: string }).actor === walk.actor,
            );
        return (
          <div key={branch} data-testid={`garden-afternoon-${branch}`}>
            <h4>{branch}</h4>
            <p>
              {b
                ? `${b.id} · ${b.status === 'cancelled' ? 'ended' : b.intention?.mode} · ${b.intention?.label ?? 'finished'} · ${b.status === 'cancelled' ? 'ended' : b.intention?.phase}`
                : 'Not started'}
            </p>
            <p>Completed: {b?.intention?.completed.join(' → ') || 'none'}</p>
            <div className="lab-classroom-controls">
              {(['pause', 'resume', 'end'] as const).map((intent) => {
                const plan = admission(branch, intent);
                return (
                  <button
                    key={intent}
                    disabled={plan?.ok !== true}
                    onClick={() => {
                      if (
                        !fresh() ||
                        !b ||
                        readGardenAfternoon(rt)?.branches[branch].id !== b.id ||
                        admission(branch, intent)?.ok !== true
                      )
                        return;
                      reply(
                        controlGardenAfternoon(rt, branch, intent),
                        `${intent} accepted for ${branch}; Play completes any ordinary safe cleanup.`,
                      );
                    }}
                  >
                    {intent[0].toUpperCase() + intent.slice(1)} {branch}
                  </button>
                );
              })}
              <button
                disabled={
                  !b?.active ||
                  pending(b.id) ||
                  directPending() ||
                  walkPlan?.ok !== true ||
                  ['ending', 'draining'].includes(b.intention?.mode ?? '')
                }
                onClick={() => {
                  const now = readGardenAfternoon(rt)?.branches[branch];
                  if (
                    !fresh() ||
                    !now?.active ||
                    now.id !== b?.id ||
                    pending(now.id) ||
                    directPending() ||
                    ['ending', 'draining'].includes(
                      now.intention?.mode ?? '',
                    ) ||
                    !rt.registry.get('walk_to')?.plan(rt, walk).ok
                  )
                    return;
                  reply(
                    rt.submit('walk_to', walk),
                    `Player directs ${branch} to the courtyard. Only that intention yields; explicit Resume continues its retained purpose.`,
                  );
                }}
              >
                Direct {branch} away
              </button>
            </div>
            {b?.diagnostic && (
              <p role="status">
                {b.diagnostic.code}: {b.diagnostic.message}
              </p>
            )}
          </div>
        );
      })}
      <div data-testid="garden-afternoon-materials">
        {s && (
          <>
            <p>
              {'code' in s.seedbed
                ? `${s.seedbed.code}: ${s.seedbed.message}`
                : `planter-a · ${s.seedbed.deposits}/4 deposits · ${s.seedbed.deposited} planted · purpose ${s.seedbed.purpose ?? 'not started'} · source ${s.seedbed.source ?? 'seed-bowl'}`}
            </p>
            <p>
              seed-bowl · {s.seeds?.contents?.food}{' '}
              {s.seeds?.contents?.fraction} · {JSON.stringify(s.seeds?.support)}
              ; water-bowl · {s.water?.contents?.food}{' '}
              {s.water?.contents?.fraction} · {JSON.stringify(s.water?.support)}
            </p>
            <p>
              {'code' in s.garden
                ? s.garden.message
                : `Same bed received ${s.garden.waterReceived} water; ${s.garden.cycles} completed care cycle.`}
            </p>
            <p>
              {'code' in s.book
                ? s.book.message
                : `book · ${s.book.status} · ${s.book.elapsed}/${s.book.duration} seconds · ${s.book.task ?? 'unstarted'}`}
            </p>
          </>
        )}
      </div>
      <p role="status">
        {feedback?.epoch === epoch
          ? feedback.text
          : 'Start, then Play. Local Pause safely returns held material while the other branch continues.'}
      </p>
      <p>
        Pause retains each intention for explicit Resume. End stops that branch
        permanently in this afternoon and preserves unfinished material/book
        effects; Reset stages a fresh world. Seed deposits are conserved
        fractions, not seconds. Visible seed markers represent planted material,
        not growth. Same bowls and book; no refill, washing, deletion, new
        seedlings or active save/load.
      </p>
    </section>
  );
}
