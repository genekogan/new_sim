import { useEffect, useRef, useState } from 'react';
import type { LabSim } from './sim.ts';
import {
  startCreativeAfternoon,
  readCreativeAfternoon,
  controlCreativeAfternoon,
} from '../../engine/scenarios/creative-afternoon.ts';
import { MusicSound } from './music-sound.ts';
export function CreativeAfternoonHud({
  sim,
  refresh,
}: {
  sim: LabSim;
  refresh: () => void;
}) {
  const [feedback, setFeedback] = useState(
      'Start the afternoon, then Play. Each person retains a different purpose.',
    ),
    [enabled, setEnabled] = useState(false),
    sound = useRef<MusicSound | null>(null),
    rt = sim.rt;
  useEffect(
    () => () => {
      const prior = sound.current;
      sound.current = null;
      void prior?.dispose();
    },
    [rt],
  );
  if (sim.scenario.name !== 'creative-afternoon') return null;
  const day = readCreativeAfternoon(rt),
    active = !!day && !['completed', 'ending', 'ended'].includes(day.phase),
    mode = day?.intention?.mode ?? day?.sharing?.mode ?? day?.jam?.mode,
    paused = mode === 'paused' || mode === 'waiting',
    drawing =
      day?.drawing && !('code' in day.drawing) ? day.drawing : undefined;
  function reply(result: ReturnType<typeof controlCreativeAfternoon>) {
    const d = 'code' in result ? result : result.diagnostic;
    setFeedback(
      d
        ? `${d.code}: ${d.message}`
        : 'Accepted. Keep Play running for ordinary physical execution.',
    );
    refresh();
  }
  async function audio() {
    const prior = sound.current;
    if (prior) {
      sound.current = null;
      setEnabled(false);
      await prior.dispose();
      return;
    }
    const next = new MusicSound(sim, 'music-computer');
    sound.current = next;
    try {
      await next.enable();
      if (sound.current === next && sim.rt === rt) setEnabled(true);
    } catch (error) {
      void next.dispose();
      sound.current = null;
      setEnabled(false);
      setFeedback(`audio.unavailable: ${String(error)}`);
    }
  }
  return (
    <section
      className="lab-hud lab-classroom"
      data-testid="creative-afternoon-hud"
    >
      <h3>Creative afternoon · make, share, return</h3>
      <p>
        Hypothetical Drawing Klerb/Open Jacks-inspired staging. The artist draws
        three marks, shares that actual pad, joins a two-performer digital music
        exchange, then returns to finish the same study. The reader takes a
        separate break and returns to the same book; the gardener performs
        finite care independently.
      </p>
      <div data-testid="creative-afternoon-readout">
        {day
          ? `${day.phase} · ${mode ?? 'between activities'} · ${drawing?.completedMarks.length ?? 0}/8 retained marks`
          : 'Not started'}
      </div>
      <div className="lab-classroom-controls">
        <button
          disabled={!!day}
          onClick={() => reply(startCreativeAfternoon(rt))}
        >
          Start creative afternoon
        </button>
        <button onClick={() => void audio()}>
          {enabled ? 'Mute afternoon sound' : 'Enable afternoon sound'}
        </button>
        <button
          disabled={!active || paused || !rt.isActive(day!.current)}
          onClick={() => reply(controlCreativeAfternoon(rt, 'pause'))}
        >
          Pause artist commitment
        </button>
        <button
          disabled={!active || !paused}
          onClick={() => reply(controlCreativeAfternoon(rt, 'resume'))}
        >
          Resume artist commitment
        </button>
        <button
          disabled={!active}
          onClick={() => reply(controlCreativeAfternoon(rt, 'end'))}
        >
          End creative afternoon
        </button>
        <button
          disabled={!active || !rt.isActive(day!.current)}
          onClick={() =>
            reply(rt.submit('walk_to', { actor: 'sketcher', x: 4, z: -5 }))
          }
        >
          Direct artist away
        </button>
      </div>
      {day?.commitments.map(
        (c) =>
          c && (
            <div key={c.id}>
              <p>
                {c.actor} · {c.mode} · {c.label ?? 'completed'} ·{' '}
                {c.completed.length} completed blocks
              </p>
              <button
                disabled={
                  !rt.isActive(c.id) ||
                  ['paused', 'ending', 'completed'].includes(c.mode)
                }
                onClick={() =>
                  reply(
                    rt.submit('living_intention_control', {
                      intention: c.id,
                      intent: 'pause',
                    }),
                  )
                }
              >
                Pause {c.actor}
              </button>
              <button
                disabled={!rt.isActive(c.id) || c.mode !== 'paused'}
                onClick={() =>
                  reply(
                    rt.submit('living_intention_control', {
                      intention: c.id,
                      intent: 'resume',
                    }),
                  )
                }
              >
                Resume {c.actor}
              </button>
              {c.diagnostic && (
                <p role="status">
                  {c.diagnostic.code}: {c.diagnostic.message}
                </p>
              )}
            </div>
          ),
      )}
      <p role="status">
        {day?.diagnostic
          ? `${day.diagnostic.code}: ${day.diagnostic.message}`
          : day?.phase === 'completed'
            ? 'All three purposes complete. Drawing, reading progress and plant care remain in this world.'
            : feedback}
      </p>
      <p>
        Sharing controls below expose questions and late arrivals. Pause
        releases only the selected commitment; others continue. End drains all
        afternoon commitments. Reset replaces this world. Fixed flat-ground
        arrangement, one bounded drawing and original computer scores; no active
        save/load.
      </p>
    </section>
  );
}
