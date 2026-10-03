import { useEffect, useRef, useState } from 'react';
import type { LabSim } from './sim.ts';
import {
  musicStation,
  readComputerMusic,
  type MusicScore,
} from '../../engine/activities/computer-music.ts';
import { MUSIC_BINDING as binding } from '../../engine/scenarios/computer-music.ts';
import { MusicSound } from './music-sound.ts';
export function MusicHud({
  sim,
  refresh,
}: {
  sim: LabSim;
  refresh: () => void;
}) {
  const [feedback, setFeedback] = useState(
    'Enable sound, start a session, then Play.',
  );
  const [enabled, setEnabled] = useState(false),
    [score, setScore] = useState<MusicScore>('gentle');
  const sound = useRef<MusicSound | null>(null),
    rt = sim.rt;
  useEffect(
    () => () => {
      const prior = sound.current;
      sound.current = null;
      void prior?.dispose();
    },
    [rt],
  );
  if (sim.scenario.name !== 'computer-music') return null;
  const rec = [...rt.records.values()]
    .filter((r) => r.verb === 'computer_music')
    .at(-1);
  const active = rec && rt.isActive(rec.id),
    session = rec ? readComputerMusic(rt, rec.id) : undefined,
    state = musicStation(rt, binding.station);
  const unfinished =
    state && !('code' in state) && state.status === 'unfinished';
  const begin = (resume = false) => {
    const prior = [...rt.records.values()]
      .filter((r) => r.verb === 'computer_music')
      .map((r) => readComputerMusic(rt, r.id))
      .filter((s) => s !== undefined)
      .at(-1);
    const p = {
      ...binding,
      // Resume the remaining invitations; do not reclaim someone directed away.
      listeners:
        resume && prior
          ? prior.bindings.listeners.filter(
              (l) =>
                !prior.listeners.find((old) => old.actor === l.actor)
                  ?.withdrawn,
            )
          : binding.listeners,
      score: resume && state && !('code' in state) ? state.score : score,
      period:
        resume && state && !('code' in state) ? state.period : binding.period,
      resume,
    };
    const next = rt.submit('computer_music', p);
    setFeedback(
      next.diagnostic
        ? `${next.diagnostic.code}: ${next.diagnostic.message}`
        : resume
          ? 'Returning to the same score and computer purpose.'
          : 'Performer and listeners are approaching their usable positions.',
    );
    refresh();
  };
  const audio = async () => {
    if (sound.current) {
      const old = sound.current;
      sound.current = null;
      setEnabled(false);
      await old.dispose();
      return;
    }
    try {
      const next = new MusicSound(sim, binding.station);
      sound.current = next;
      await next.enable();
      if (sim.rt !== rt || sound.current !== next) return;
      setEnabled(true);
    } catch (error) {
      const old = sound.current;
      sound.current = null;
      void old?.dispose();
      setEnabled(false);
      setFeedback(
        `audio.unavailable: ${String(error)}. Simulation remains usable with sound disabled.`,
      );
    }
  };
  return (
    <section className="lab-hud lab-classroom" data-testid="music-hud">
      <h3>Computer music and listening</h3>
      <p>
        Hypothetical digital music-making. The computer generates the original
        score; two guests independently approach and listen. Interrupt stands
        everyone up before releasing resources. Sound follows simulation
        progress and is silent while paused.
      </p>
      <div data-testid="music-readout">
        {state && 'code' in state
          ? `${state.code}: ${state.message}`
          : state
            ? `${state.status} · ${state.score} · ${state.elapsed.toFixed(1)}/${state.duration}s · ${state.note === null ? 'silent' : `note ${state.note}`}`
            : 'Computer ready for an original score.'}
      </div>
      <div>
        {session?.listeners.map((l) => (
          <div key={l.actor}>
            {l.actor}: {l.state}
          </div>
        ))}
      </div>
      <div className="lab-classroom-controls">
        <label>
          Score{' '}
          <select
            aria-label="Music score"
            disabled={!!active || !!unfinished}
            value={score}
            onChange={(event) => setScore(event.target.value as MusicScore)}
          >
            <option value="gentle">Gentle</option>
            <option value="bright">Bright</option>
          </select>
        </label>
        <button onClick={() => void audio()}>
          {enabled ? 'Mute sound' : 'Enable sound'}
        </button>
        <button disabled={!!active || !!unfinished} onClick={() => begin()}>
          Start music session
        </button>
        <button
          disabled={!active}
          onClick={() => {
            rt.cancel(rec!.id);
            setFeedback(
              'Safely stopping; the computer retains the unfinished score.',
            );
            refresh();
          }}
        >
          Interrupt music
        </button>
        <button disabled={!!active || !unfinished} onClick={() => begin(true)}>
          Resume music
        </button>
        <button
          onClick={() => {
            const r = rt.submit('walk_to', {
              actor: 'listener-a',
              x: -6,
              z: -4,
            });
            setFeedback(
              r.diagnostic
                ? `${r.diagnostic.code}: ${r.diagnostic.message}`
                : 'The first listener is leaving; the other commitments remain.',
            );
            refresh();
          }}
        >
          Direct listener away
        </button>
        <button
          onClick={() => {
            const r = rt.submit('walk_to', {
              actor: binding.performer,
              x: 6,
              z: -4,
            });
            setFeedback(
              r.diagnostic
                ? `${r.diagnostic.code}: ${r.diagnostic.message}`
                : 'Player control takes precedence; the music purpose remains unfinished.',
            );
            refresh();
          }}
        >
          Direct performer away
        </button>
      </div>
      <div role="status">
        {state && !('code' in state) && state.status === 'completed'
          ? 'Score complete. Performer and listeners have stood up; the computer retains the completed purpose.'
          : feedback}
      </div>
    </section>
  );
}
