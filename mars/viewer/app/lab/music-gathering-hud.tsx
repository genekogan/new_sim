import { adoptLivingDayMusic } from '../../engine/scenarios/living-day.ts';
import { useEffect, useRef, useState } from 'react';
import type { LabSim } from './sim.ts';
import { musicStation } from '../../engine/activities/computer-music.ts';
import { latestMusicGathering } from '../../engine/activities/music-gathering.ts';
import { MUSIC_GATHERING_BINDING } from '../../engine/scenarios/music-gathering.ts';
import { MusicSound } from './music-sound.ts';
export function MusicGatheringHud({
  sim,
  refresh,
}: {
  sim: LabSim;
  refresh: () => void;
}) {
  const [feedback, setFeedback] = useState(
    'Enable sound, Start music gathering, then Play. A second dancer can join while the score continues.',
  );
  const [enabled, setEnabled] = useState(false),
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
  const connected = sim.scenario.name.startsWith('living-day-');
  if (sim.scenario.name !== 'music-dance' && !connected) return null;
  const session = latestMusicGathering(rt),
    rec = session ? rt.records.get(session.action) : undefined,
    active = rec && rt.isActive(rec.id);
  const unstarted = session?.mode === 'ended' && !session.music;
  const state = musicStation(rt, MUSIC_GATHERING_BINDING.station),
    unfinished = state && !('code' in state) && state.status === 'unfinished';
  const begin = (resume = false) => {
    const next = rt.submit(
      'music_gathering',
      resume && session
        ? { ...session.bindings, resume: true, resumeFrom: session.action }
        : MUSIC_GATHERING_BINDING,
    );
    if (connected && !next.diagnostic) adoptLivingDayMusic(rt, next.id);
    setFeedback(
      next.diagnostic
        ? `${next.diagnostic.code}: ${next.diagnostic.message}`
        : resume
          ? 'Returning to the same score; explicit departures remain respected.'
          : 'People are approaching supported music and floor places.',
    );
    refresh();
  };
  const control = (actor: string, command: 'join' | 'leave') => {
    const next = rt.submit('music_gathering_control', {
      gathering: rec!.id,
      actor,
      command,
    });
    setFeedback(
      next.diagnostic
        ? `${next.diagnostic.code}: ${next.diagnostic.message}`
        : `${actor}: ${command === 'join' ? 'approaching the dance floor' : 'lowering hands before leaving'}. The score and other people continue.`,
    );
    refresh();
  };
  const audio = async () => {
    if (sound.current) {
      const prior = sound.current;
      sound.current = null;
      setEnabled(false);
      await prior.dispose();
      return;
    }
    try {
      const next = new MusicSound(sim, MUSIC_GATHERING_BINDING.station);
      sound.current = next;
      await next.enable();
      if (sim.rt === rt && sound.current === next) setEnabled(true);
    } catch (error) {
      const prior = sound.current;
      sound.current = null;
      void prior?.dispose();
      setEnabled(false);
      setFeedback(
        `audio.unavailable: ${String(error)}. Gathering remains usable without sound.`,
      );
    }
  };
  return (
    <section
      className="lab-hud lab-classroom"
      data-testid="music-gathering-hud"
    >
      <h3>Music and grounded dance</h3>
      {connected && (
        <p>
          The independent gathering begins after the connected day reaches rest.
          Enable sound now; Pause/Resume this gathering preserves its own score
          while other commitments continue.
        </p>
      )}
      <p>
        Hypothetical four-person gathering with an original computer score, one
        seated listener and two authored dance places. Dance uses a planted
        stance and rhythmic arm movement on clear ground. Pause gathering safely
        lowers hands and stands listeners up; Resume gathering retains the same
        score. Player directions take precedence.
      </p>
      <div data-testid="music-gathering-readout">
        {state && 'code' in state
          ? `${state.code}: ${state.message}`
          : state
            ? `${state.status} · ${state.score} · ${state.elapsed.toFixed(1)}/${state.duration}s · ${state.note === null ? 'silent' : `note ${state.note}`}`
            : 'Computer ready.'}{' '}
        · floor: {session?.floorHolder ?? 'waiting for music'}
      </div>
      <div className="lab-classroom-controls">
        <button onClick={() => void audio()}>
          {enabled ? 'Mute sound' : 'Enable sound'}
        </button>
        <button
          disabled={connected || !!active || !!unfinished}
          onClick={() => begin()}
        >
          Start music gathering
        </button>
        <button
          disabled={!active}
          onClick={() => {
            rt.cancel(rec!.id);
            setFeedback(
              'Safely releasing this gathering; its unfinished computer score remains.',
            );
            refresh();
          }}
        >
          Pause gathering
        </button>
        <button
          disabled={!!active || (!unfinished && !unstarted)}
          onClick={() => begin(true)}
        >
          Resume gathering
        </button>
      </div>
      {MUSIC_GATHERING_BINDING.dancers.map((d) => {
        const member = session?.dancers.find((m) => m.actor === d.actor),
          present = !!member?.child && rt.isActive(member.child);
        return (
          <div key={d.actor} data-testid={`music-gathering-${d.actor}`}>
            {d.actor}:{' '}
            {member?.state ?? (d.join === false ? 'invited' : 'ready')}
            <button
              disabled={!active || session?.mode !== 'gathering' || present}
              onClick={() => control(d.actor, 'join')}
            >
              Join {d.actor}
            </button>
            <button
              disabled={
                !active ||
                session?.mode !== 'gathering' ||
                !present ||
                member?.withdrawn
              }
              onClick={() => control(d.actor, 'leave')}
            >
              Leave {d.actor}
            </button>
            <button
              disabled={!active}
              onClick={() => {
                const next = rt.submit('walk_to', {
                  actor: d.actor,
                  x: -6,
                  z: d.actor === 'dancer-a' ? -1 : 3,
                });
                setFeedback(
                  next.diagnostic
                    ? `${next.diagnostic.code}: ${next.diagnostic.message}`
                    : `${d.actor} follows the player direction; other commitments remain.`,
                );
                refresh();
              }}
            >
              Direct {d.actor} away
            </button>
          </div>
        );
      })}
      <button
        disabled={!active}
        onClick={() => {
          const next = rt.submit('walk_to', {
            actor: MUSIC_GATHERING_BINDING.performer,
            x: 6,
            z: -4,
          });
          setFeedback(
            next.diagnostic
              ? `${next.diagnostic.code}: ${next.diagnostic.message}`
              : 'Performer follows the player direction; safely stopping the gathering retains the unfinished score.',
          );
          refresh();
        }}
      >
        Direct musician away
      </button>
      <div role="status">
        {session?.mode === 'ended' &&
        state &&
        !('code' in state) &&
        state.status === 'completed'
          ? 'Score complete. Music, chairs, floor places and actor resources have been released.'
          : feedback}
      </div>
      <p>
        Play advances the world; global Pause freezes the clock and silences
        audio. Reset clears this live gathering. Active reload restoration,
        travelling choreography and fine foot/finger performance are outside
        this example.
      </p>
    </section>
  );
}
