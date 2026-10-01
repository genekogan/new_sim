type Props = {
  scenario: string;
  onScenario: (name: string) => void;
};

/** Discovery only: existing scenario loading and classroom controls own every action. */
export function CheckpointTour({ scenario, onScenario }: Props) {
  const classroom = scenario === 'classroom-4' || scenario === 'classroom-8';
  const eight = scenario === 'classroom-8' || scenario === 'work-break-8';
  const studio = scenario === 'design-studio';
  const music = scenario === 'computer-music';
  const reading = scenario === 'quiet-reading';
  const chess = scenario === 'tabletop-chess';
  const preparation = scenario === 'cold-preparation' || scenario === 'cold-preparation-rotated';
  const gathering = classroom || scenario === 'work-break-4' || scenario === 'work-break-8';
  // Keep measurement/construction controls in their established compact layout.
  // Every newly playable room retains the tour when switching between experiences.
  if (!gathering && !studio && !reading && !music && !chess && !preparation) return null;
  const cameraScenario = eight ? 'classroom-8' : 'classroom-4';
  return (
    <section aria-labelledby="checkpoint-tour-heading" data-testid="checkpoint-tour">
      <h2 id="checkpoint-tour-heading">Quick tour · playable checkpoint</h2>
      <div className="lab-row">
        <button onClick={() => onScenario('classroom-4')}>Load 4-guest room</button>
        <button onClick={() => onScenario('classroom-8')}>Load 8-guest room</button>
        <button onClick={() => onScenario('design-studio')}>Try an independent design studio</button>
        <button onClick={() => onScenario(eight ? 'work-break-8' : 'work-break-4')}>Try a continuing day</button>
        <button onClick={() => onScenario('computer-music')}>Try computer music and listening</button>
        <button onClick={() => onScenario('quiet-reading')}>Try reading with a bookmark</button>
        <button onClick={() => onScenario('tabletop-chess')}>Try physical tabletop chess</button>
        <button onClick={() => onScenario('cold-preparation')}>Try cold meal preparation</button>
      </div>
      <p className="lab-meta">Loading a room resets the current world. These rooms and participants are hypothetical. Use Play and the activity controls below; Reset starts the selected room again.</p>
      {preparation && <p className="lab-desc">Start preparation and Play. Transfer finite ingredients and mix in the same pot. Interrupt requests safe release; Resume retains deposits. Then take the emptied bowl, serve and eat with the same spoon, and return both objects. Two servings, one cold batch, grounded table only; no heat or chopping. The rotated-table preset uses the same activity.</p>}
      {chess && <p className="lab-desc">Choose a proposed move and Play. Two people physically take turns; capture preserves the same token in a tray. Change proposals for a different game. Interrupt or Direct current player away exercises owned cleanup and control handoff. Standing tabletop play, no castling or physical promotion.</p>}
      {music && <p className="lab-desc">Enable sound, Start music session and Play. Interrupt retains the recorded score after safe stand-up; Resume continues the same computer purpose. Direct listener away preserves the other commitments. Pause and Reset silence playback; Reset replaces the scene. Current computer/seated poses, two supplied listener chairs, no acoustic-instrument simulation.</p>}
      {reading && <p className="lab-desc">Start reading and Play. Interrupt reading retains a bookmark after safe stand-up; Resume reading continues the same reader and book. Direct reader away exercises player precedence. This first reading arrangement supports a flat book on a grounded table and a compatible real chair; held-book reading is not supported.</p>}
      {studio && <p className="lab-desc">Independent studio: Start notes, interrupt after progress, then Start session and Start purposeful routine during presentations. Watch a critique, questions, shared soup, quiet rest and return to the same project notes. Commit attendee continuations adds separate guest discussion and presenter follow-up work. The attributed computer uses the same workstation rules. This room has one fixed arrangement; Mars furniture setup and live automatic camera controls are not supported here.</p>}
      {gathering && <details>
        <summary>Try talks, interrupted work, chair and table setup</summary>
        <ol className="lab-desc">
          <li>
            <b>Keep an intention across activities.</b> Try a continuing day loads the same room with
            work and serving equipment. Start notes, interrupt after some progress, wait for stand-up,
            then Start session. Once talks begin, Start purposeful routine joins the worker, asks a
            question, follows both presenters and conversations, shares food, rests, and finishes the
            same notes. Pause routine retains progress; Resume continues after safe release. End routine
            leaves the gathering running for others. Commit attendee continuations lets two guests keep discussing the talks while presenter1 waits for these exact notes and then uses the computer for follow-up work. Each commitment has separate Pause, Resume and End controls. These are directed examples, not autonomous choices.
          </li>
          <li>
            <b>Prepare a usable room.</b> In a fresh room select worker and Take bowl, then Take spoon,
            waiting for each pickup. Prepare side layout uses the default free crew to move the cleared
            table and spare chair in order. Stop room setup waits for safe set-down and keeps the partial
            arrangement; retry or Restore default layout. Once ready, Start session and select visitor
            to Join session during presentations. Pause when choosing an intervention. After joining,
            select worker and Put belongings away on the relocated table, then Direct to courtyard.
            Only these two authored ground layouts are supported.
          </li>
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
      </details>}
      <p className="lab-meta">The full Scenario selector also exposes movement, body measurement and construction checks. The 2022 east-house build checks the loaded layout before starting; an unsupported layout names its missing staging positions and blockers. Historical source-era fixtures are separate validation evidence.</p>
      <p className="lab-sub"><a href="/studio">Explore Mars · Walk WASD through designated Chiba auditorium tiers</a></p>
      <p className="lab-sub">
        <a href={`/cinematography/review.html?scenario=${cameraScenario}`} target="_blank" rel="noopener">Optional live camera review</a>
        {' · '}
        <a href="/app/camera-lab/suite.html" target="_blank" rel="noopener">Recorded six-scene camera replay</a>
      </p>
      <p className="lab-meta">Live automatic camera controls are available in the 4- and 8-guest classroom rooms: choose Live camera, then Follow guest2 or Return camera to auto. The recorded replay is a camera demonstration, not a playable world.</p>
    </section>
  );
}
