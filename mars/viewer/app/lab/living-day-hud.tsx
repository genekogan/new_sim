import { useState } from 'react';
import type { LabSim } from './sim.ts';
import {
  startLivingDay,
  readLivingDay,
  retryLivingDay,
  type LivingDayName,
  type LivingDayOptions,
} from '../../engine/scenarios/living-day.ts';
import { readPurposefulRoutine } from '../../engine/activities/purposeful-routine.ts';
import { readLivingIntention } from '../../engine/activities/living-intention.ts';
export function LivingDayHud({
  sim,
  refresh,
}: {
  sim: LabSim;
  refresh: () => void;
}) {
  const [worker, setWorker] = useState<LivingDayOptions['worker']>('original'),
    [workstation, setWorkstation] =
      useState<LivingDayOptions['workstation']>('preferred'),
    [feedback, setFeedback] = useState(
      'Choose bindings; each person keeps a separate commitment.',
    );
  if (!['living-day-4', 'living-day-studio'].includes(sim.scenario.name))
    return null;
  const rt = sim.rt,
    day = readLivingDay(rt),
    routine = day?.routine ? readPurposefulRoutine(rt, day.routine) : undefined;
  const intentions = [...rt.records.values()]
    .filter((r) => r.verb === 'living_intention')
    .map((r) => readLivingIntention(rt, r.id))
    .filter((s) => !!s);
  const submit = (verb: string, params: unknown) => {
    const r = rt.submit(verb, params, { preempt: verb === 'walk_to' });
    setFeedback(
      r.diagnostic
        ? `${r.diagnostic.code}: ${r.diagnostic.message}`
        : `Requested ${verb}; keep Play running for safe physical release.`,
    );
    refresh();
  };
  return (
    <section className="lab-hud lab-classroom" data-testid="living-day-hud">
      <h3>Connected living day · hypothetical</h3>
      <p>
        Intentions run independently. Work retains four seconds of notes before
        the gathering; reading includes a separate courtyard digression; care
        visits two plants and returns to the first. Select actual eligible
        casting and equipment below. An unavailable preference may use only the
        declared alternative; occupied resources stay with their owners.
      </p>
      <label>
        Main participant{' '}
        <select
          aria-label="Day participant"
          disabled={!!day}
          value={worker}
          onChange={(e) =>
            setWorker(e.target.value as LivingDayOptions['worker'])
          }
        >
          <option value="original">Original worker</option>
          <option value="assistant">Project assistant</option>
        </select>
      </label>
      <label>
        Work equipment{' '}
        <select
          aria-label="Day workstation"
          disabled={!!day}
          value={workstation}
          onChange={(e) =>
            setWorkstation(e.target.value as LivingDayOptions['workstation'])
          }
        >
          <option value="preferred">
            Room computer, then auxiliary if unavailable
          </option>
          <option value="alternative">
            Auxiliary computer, then room computer
          </option>
        </select>
      </label>
      <button
        disabled={!!day}
        onClick={() => {
          const r = startLivingDay(rt, sim.scenario.name as LivingDayName, {
            worker,
            workstation,
          });
          const d = 'code' in r ? r : r.diagnostic;
          setFeedback(
            d
              ? `${d.code}: ${d.message}`
              : 'Independent commitments started. Play to watch the day unfold.',
          );
          refresh();
        }}
      >
        Start connected day
      </button>
      <div data-testid="living-day-readout">
        {day?.phase ?? 'Not started'}
        {day?.diagnostic &&
          ` · ${day.diagnostic.code}: ${day.diagnostic.message}`}
      </div>
      {day?.phase === 'waiting' && (
        <button
          onClick={() => {
            const d = retryLivingDay(rt);
            setFeedback(
              d
                ? `${d.code}: ${d.message}`
                : 'Retry requested with the same commitments after intervention.',
            );
            refresh();
          }}
        >
          Retry refused day transition
        </button>
      )}
      {routine && (
        <div data-testid="living-day-routine">
          {routine.bindings.actor} · {routine.mode} · {routine.phase} · notes{' '}
          {routine.progress.workElapsed.toFixed(1)}/
          {routine.bindings.work.duration}s · question{' '}
          {routine.progress.questionAsked ? 'asked' : 'pending'} · meal{' '}
          {routine.progress.meal.filter((p) => p.consumed).length}/2 eaten ·
          sleep {routine.sleep?.elapsed.toFixed(1) ?? '0'}/
          {routine.bindings.sleep?.duration}s
          {routine.waitingReason && <p>Waiting: {routine.waitingReason}</p>}
          {(['pause', 'resume', 'end'] as const).map((intent) => (
            <button
              key={intent}
              disabled={
                !rt.isActive(routine.action) ||
                (intent === 'resume' &&
                  !['waiting', 'paused'].includes(routine.mode))
              }
              onClick={() =>
                submit('purposeful_routine_control', {
                  routine: routine.action,
                  intent,
                })
              }
            >
              {intent} connected routine
            </button>
          ))}
          <button
            onClick={() =>
              submit('walk_to', { actor: routine.bindings.actor, x: 14, z: 6 })
            }
          >
            Direct main participant away
          </button>
        </div>
      )}
      {intentions.map((s) => (
        <div key={s.id} data-testid={`day-intention-${s.actor}`}>
          <b>{s.actor}</b> · {s.mode} · {s.label ?? 'commitments finished'} ·{' '}
          {s.phase}
          {s.diagnostic && (
            <p>
              {s.diagnostic.code}: {s.diagnostic.message}
            </p>
          )}
          {(['pause', 'resume', 'end'] as const).map((intent) => (
            <button
              key={intent}
              disabled={
                !rt.isActive(s.id) ||
                (intent === 'resume' && !['waiting', 'paused'].includes(s.mode))
              }
              onClick={() =>
                submit('living_intention_control', { intention: s.id, intent })
              }
            >
              {intent} {s.actor}
            </button>
          ))}
          <button
            onClick={() =>
              submit('walk_to', {
                actor: s.actor,
                x: s.actor === 'carer' ? -12 : 14,
                z: 7,
              })
            }
          >
            Direct {s.actor} away
          </button>
          <small>
            Completed blocks: {s.completed.join(' · ') || 'none'}; skipped:{' '}
            {s.skipped.join(' · ') || 'none'}
          </small>
        </div>
      ))}
      <p role="status">{feedback}</p>
      <small>
        Pause keeps unfinished purpose after safe release. Resume is explicit
        after intervention. Reset replaces this world. One ground arrangement
        per environment, two permitted workstations, one cold recipe and
        grounded mat; no active reload or free-form needs simulation.
      </small>
    </section>
  );
}
