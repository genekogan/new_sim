import { GardenAfternoonHud } from './garden-afternoon-hud.tsx';
import { SeedPlantingHud } from './seed-planting-hud.tsx';
import { ReadingCircleHud } from './reading-circle-hud.tsx';
import { GalleryTourHud } from './gallery-tour-hud.tsx';
import { TableCleanupHud } from './table-cleanup-hud.tsx';
import { ArtSharingHud } from './art-sharing-hud.tsx';
import { CreativeAfternoonHud } from './creative-afternoon-hud.tsx';
import { DrawingHud } from './drawing-hud.tsx';
import { GroupWarmupHud } from './group-warmup-hud.tsx';
import { OpenJamHud } from './open-jam-hud.tsx';
import { LivingDayHud } from './living-day-hud.tsx';
import { GardenCareHud } from './garden-care-hud.tsx';
import { MusicGatheringHud } from './music-gathering-hud.tsx';
import { SleepHud } from './sleep-hud.tsx';
import { LabCameraControls } from './camera-controls.tsx';
// Engine Lab side panel: scenario picker, transport, overlays, cameras,
// expectations, perf and the action/diagnostic log.
import { ClassroomHud } from './classroom-hud.tsx';
import { MusicHud } from './music-hud.tsx';
import { ReadingHud } from './reading-hud.tsx';
import { PreparationHud } from './preparation-hud.tsx';
import { ChessHud } from './chess-hud.tsx';
import { WorkBreakHud } from './work-break-hud.tsx';
import { RestHud } from './rest-hud.tsx';
import { PurposefulRoutineHud } from './purposeful-routine-hud.tsx';
import { GatheringContinuationHud } from './gathering-continuation-hud.tsx';
import { SELECTABLE_SCENARIOS, type Check } from './scenarios.ts';
import { OVERLAYS, type LabView, type OverlayName } from './lab-view.ts';
import { SequencePanel } from './sequence-hud.tsx';
import { CheckpointTour } from './checkpoint-tour.tsx';

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
const OVERLAY_LABEL: Record<OverlayName, string> = {
  grid: 'Walkability / clearance',
  routes: 'Routes + corridors',
  traffic: 'Single-file traffic',
  agents: 'Agent discs + facing',
  obstacles: 'Obstacle footprints',
  prisms: 'Engine obstacle prisms (ground band, translucent, on top)',
  links: 'Stair links',
  labels: 'Action phase labels',
  violations: 'Violation markers',
  slots: 'Interaction slots (green free · amber claimed · orange occupied)',
};

type Props = {
  view: LabView;
  checks: Check[];
  onScenario: (name: string) => void;
  onOverlay: (name: OverlayName, on: boolean) => void;
  onAll: (on: boolean) => void;
  onDrop?: () => void;
  refresh: () => void;
};

export function LabPanel({ view, checks, onScenario, onOverlay, onAll, onDrop, refresh }: Props) {
  const sim = view.sim;
  const s = sim.scenario;
  const st = sim.stats();
  const info = view.info();
  return (
    <aside className="lab-panel">
      <h1>Engine Lab</h1>
      <CheckpointTour scenario={s.name} onScenario={onScenario} />
      <LabCameraControls view={view} />
      <p className="lab-sub">
        Deterministic engine · fixed tick 1/20 s · <a href="/studio">studio</a>
      </p>
      <label className="lab-field">
        Scenario
        <select value={s.name} onChange={(e) => onScenario(e.target.value)} aria-label="Scenario">
          {!SELECTABLE_SCENARIOS.some((x) => x.name === s.name) && <option value={s.name}>{s.title}</option>}
          {SELECTABLE_SCENARIOS.map((x) => (
            <option key={x.name} value={x.name}>
              {x.title}
            </option>
          ))}
        </select>
      </label>
      <p className="lab-desc">{s.description}</p>
      <div className="lab-row">
        <button onClick={() => ((sim.paused = !sim.paused), refresh())}>{sim.paused ? 'Play' : 'Pause'}</button>
        <button onClick={() => ((sim.paused = true), sim.step(), refresh())}>Step</button>
        <button onClick={() => onScenario(s.name)}>Reset</button>
        <select value={sim.speed} onChange={(e) => ((sim.speed = Number(e.target.value)), refresh())} aria-label="Speed">
          {SPEEDS.map((v) => (
            <option key={v} value={v}>
              {v}×
            </option>
          ))}
        </select>
      </div>
      {onDrop && (
        <button className="lab-drop" onClick={onDrop}>
          Drop panel into the gap now
        </button>
      )}
      <p className="lab-meta">
        tick {sim.rt.tick} · t {sim.rt.time.toFixed(2)} s {sim.done() ? '· done' : sim.paused ? '· paused' : ''}
      </p>
      {s.name === 'design-studio' && <section className="lab-meta" data-testid="workstation-appearance">
        Computer appearance: <a href="https://sketchfab.com/3d-models/retro-computer-monitor-8926293078874194b551e74c40a3debf" target="_blank" rel="noopener">Retro Computer &amp; Monitor</a> by <a href="https://sketchfab.com/JasperTobias" target="_blank" rel="noopener">JasperTobias</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>. Scaled and rotated; screen shows live simulated work.
        {view.fixtures.workstationAppearanceStates().map(state => <div key={state.id}>
          {state.status === 'failed' ? <span role="alert">{state.diagnostic} · Using the primitive computer appearance.</span> : `Appearance: ${state.status}`}
        </div>)}
      </section>}
      {s.hud && (
        <ul className="lab-meta lab-hud" data-testid="lab-scenario-hud">
          {s.hud(sim.rt).map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
      <PurposefulRoutineHud key={`purposeful-routine:${sim.scenarioEpoch}`} sim={sim} refresh={refresh} />
      <GatheringContinuationHud key={`continuation:${sim.scenarioEpoch}`} sim={sim} refresh={refresh} />
      <ClassroomHud key={s.name} sim={sim} refresh={refresh} />
      <MusicHud key={`music:${sim.scenarioEpoch}`} sim={sim} refresh={refresh} />
      <ChessHud key={`chess:${sim.scenarioEpoch}`} sim={sim} refresh={refresh} />
      <SleepHud key={`sleep-${sim.scenarioEpoch}`} sim={sim} refresh={refresh} />
      <PreparationHud key={`preparation:${sim.scenarioEpoch}`} sim={sim} refresh={refresh} />
      <ReadingHud key={`reading:${sim.scenarioEpoch}`} sim={sim} refresh={refresh} />
      <WorkBreakHud key={sim.scenarioEpoch} sim={sim} refresh={refresh} />
      <RestHud key={`quiet-rest:${sim.scenarioEpoch}`} sim={sim} refresh={refresh} />
      <GardenAfternoonHud key={`garden-afternoon:${sim.scenarioEpoch}`} sim={sim} refresh={refresh} />
      <SeedPlantingHud key={`seed-planting:${sim.scenarioEpoch}`} sim={sim} refresh={refresh} />
      <ReadingCircleHud key={`reading-circle:${sim.scenarioEpoch}`} sim={sim} refresh={refresh} />
      <GalleryTourHud key={`gallery:${sim.scenarioEpoch}`} sim={sim} refresh={refresh} />
      <TableCleanupHud key={`tidy:${sim.scenarioEpoch}`} sim={sim} refresh={refresh} />
      <ArtSharingHud key={`art:${sim.scenarioEpoch}`} sim={sim} refresh={refresh} />
      <CreativeAfternoonHud key={`creative:${sim.scenarioEpoch}`} sim={sim} refresh={refresh} />
      <LivingDayHud key={`day:${sim.scenarioEpoch}`} sim={sim} refresh={refresh} />
      <GardenCareHud key={`garden:${sim.scenarioEpoch}`} sim={sim} refresh={refresh} />
      <DrawingHud key={`drawing:${sim.scenarioEpoch}`} sim={sim} refresh={refresh} />
      <GroupWarmupHud key={`warmup:${sim.scenarioEpoch}`} sim={sim} refresh={refresh} />
      <OpenJamHud key={`jam:${sim.scenarioEpoch}`} sim={sim} refresh={refresh} />
      <MusicGatheringHud key={`dance:${sim.scenarioEpoch}`} sim={sim} refresh={refresh} />
      <h2>Expectations</h2>
      <ul className={`lab-checks${s.admission?.(sim.rt) ? ' lab-admission-checks' : ''}`}>
        {checks.map((c, i) => (
          <li key={i} className={c.ok ? 'ok' : 'bad'}>
            {c.ok ? '✓' : '✗'} {c.message}
          </li>
        ))}
      </ul>
      <SequencePanel sim={sim} />
      <h2>
        Overlays <button onClick={() => onAll(true)}>all</button> <button onClick={() => onAll(false)}>none</button>
      </h2>
      <div className="lab-overlays">
        {OVERLAYS.map((n) => (
          <label key={n}>
            <input type="checkbox" checked={view.overlays.has(n)} onChange={(e) => onOverlay(n, e.target.checked)} /> {OVERLAY_LABEL[n]}
          </label>
        ))}
      </div>
      <div className="lab-row">
        <button onClick={() => view.preset('top')}>Top-down</button>
        <button onClick={() => view.preset('oblique')}>Oblique</button>
        {Object.keys(s.views ?? {}).map((k) => (
          <button key={k} onClick={() => view.preset(k)}>{k}</button>
        ))}
      </div>
      <p className="lab-meta lab-perf">
        step {st.meanMs.toFixed(3)} ms mean · p95 {st.p95Ms.toFixed(3)} · max {st.maxMs.toFixed(2)} · {info.calls} draws · {(info.triangles / 1000).toFixed(0)}k tris
      </p>
      <h2>Log</h2>
      <ol className="lab-log" aria-label="Action and diagnostic log">
        {sim.log
          .slice(-160)
          .reverse()
          .map((l, i) => (
            <li key={i} className={l.level}>
              <span>{l.tick}</span> {l.text}
            </li>
          ))}
      </ol>
    </aside>
  );
}
