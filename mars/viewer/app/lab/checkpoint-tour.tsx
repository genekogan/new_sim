type Props = {
  scenario: string;
  onScenario: (name: string) => void;
};

/** Discovery only: existing scenario loading and classroom controls own every action. */
export function CheckpointTour({ scenario, onScenario }: Props) {
  const classroom = scenario === 'classroom-4' || scenario === 'classroom-8';
  if (!classroom) return null;
  const cameraScenario = classroom ? scenario : 'classroom-4';
  return (
    <section aria-labelledby="checkpoint-tour-heading" data-testid="checkpoint-tour">
      <h2 id="checkpoint-tour-heading">Quick tour · hypothetical classroom</h2>
      <div className="lab-row">
        <button onClick={() => onScenario('classroom-4')}>Load 4-guest room</button>
        <button onClick={() => onScenario('classroom-8')}>Load 8-guest room</button>
      </div>
      <p className="lab-meta">Loading a room resets the current world. Then use Play and the live classroom controls below.</p>
      <details>
        <summary>Try talks, interrupted work, chair and table setup</summary>
        <ol className="lab-desc">
          <li>
            <b>Talks → question → rotation → conversations.</b> Choose Start session, wait for seating,
            select an audience guest and Ask question. Watch the floor and shared attention change;
            Next presenter advances the talk. Let both presenters finish to see small conversations
            and departure. Join session admits a free visitor during talks; Leave session releases a participant.
          </li>
          <li>
            <b>Interrupted work and free hands.</b> In a fresh room select worker, choose Work on Sketch notes,
            wait for progress, then Interrupt work. Wait for safe stand-up. Take bowl, wait, then Take spoon.
            Put belongings away returns both to table slots. Once hands are free, Resume Sketch notes
            continues the same worker’s saved progress. Each action is explicit; no automatic resume or food routine.
          </li>
          <li>
            <b>Move, cancel and use a chair.</b> Before starting a session, select a free standing carrier and
            Move spare chair to side. Stop moving chair requests a safe set-down; wait until it rests on
            the ground. Return chair to row restores its authored position. After set-down, Direct to courtyard
            clears the carrier from gathering positions. Start session, select visitor and Join session
            to try the spare seat where it now stands. Occupied, reserved or hands-full moves refuse.
          </li>
          <li>
            <b>Two-person empty table move.</b> In a fresh room select worker and Take bowl, then Take spoon,
            waiting for each pickup to finish. Select guest1 and Table helper guest2; both must be free with
            empty hands. Move empty table to side carries the cleared table; Stop moving table safely sets it
            down, and Return empty table moves it back. After set-down, Start session lets the crew leave for
            their seats. Select worker and Put belongings away to use the table at its new position.
            Tabletop contents must be removed explicitly before moving.
          </li>
        </ol>
      </details>
      <p className="lab-sub">
        <a href={`/cinematography/review.html?scenario=${cameraScenario}`} target="_blank" rel="noopener">Optional live camera review</a>
        {' · '}
        <a href="/app/camera-lab/suite.html" target="_blank" rel="noopener">Recorded six-scene camera replay</a>
      </p>
      <p className="lab-meta">The recorded replay is a camera demonstration, not a playable world.</p>
    </section>
  );
}
