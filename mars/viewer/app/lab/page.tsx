// /lab — Engine Lab: the deterministic engine running live in the browser over
// the proving ground, rendered with the studio's animated people.
import { useEffect, useReducer, useRef, useState } from 'react';
import { LabView, OVERLAYS, type OverlayName } from './lab-view.ts';
import { installHook, removeHook } from './hook.ts';
import { SCENARIOS, dropPanel, PANEL_ID } from './scenarios.ts';
import { LabPanel } from './panel.tsx';
import './lab.css';

export default function Lab() {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<LabView | null>(null);
  const [, refresh] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const v = new LabView(host.current!);
    const initial =
      new URLSearchParams(location.search).get('scenario') ?? SCENARIOS[0].name;
    v.sim.load(
      SCENARIOS.some((s) => s.name === initial) ? initial : SCENARIOS[0].name,
    );
    installHook(v, refresh);
    v.start();
    setView(v);
    const t = setInterval(refresh, 250);
    return () => {
      clearInterval(t);
      removeHook();
      v.dispose();
    };
  }, []);

  const sim = view?.sim;
  const checks = sim ? sim.checks() : [];
  const failed = sim
    ? [...sim.rt.records.values()].filter((r) => r.status === 'failed')
    : [];
  const violations = sim?.rt.violations.length ?? 0;
  const done = sim?.done() ?? false;
  return (
    <div className="lab">
      <div className="lab-stage">
        <div className="lab-canvas" ref={host} />
        <div className="lab-banners">
          {view?.error && <div className="lab-banner error">{view.error}</div>}
          {violations > 0 && (
            <div className="lab-banner error" role="alert">
              {violations} invariant violation{violations > 1 ? 's' : ''} —
              first: {sim!.rt.violations[0].message}
            </div>
          )}
          {failed.map((r) => (
            <div key={r.id} className="lab-banner error" role="alert">
              {r.id} {r.verb} FAILED · {r.diagnostic?.code}:{' '}
              {r.diagnostic?.message}
            </div>
          ))}
        </div>
        {done && !sim!.scenario.continuous && (
          <div
            className={`lab-verdict ${checks.every((c) => c.ok) ? 'ok' : 'bad'}`}
            data-testid="lab-verdict"
          >
            {checks.every((c) => c.ok)
              ? 'Scenario expectations met'
              : 'Scenario expectations NOT met'}
          </div>
        )}
      </div>
      {view && (
        <LabPanel
          view={view}
          checks={checks}
          onScenario={(name) => {
            view.sim.load(name);
            history.replaceState(null, '', `/lab?scenario=${name}`);
            refresh();
          }}
          onOverlay={(name: OverlayName, on: boolean) => {
            view.setOverlay(name, on);
            refresh();
          }}
          onAll={(on) => {
            for (const n of OVERLAYS) view.setOverlay(n, on);
            refresh();
          }}
          onDrop={
            view.sim.scenario.name === 'construction' &&
            !view.sim.rt.world.entities[PANEL_ID]
              ? () => {
                  dropPanel(view.sim.rt);
                  refresh();
                }
              : undefined
          }
          refresh={refresh}
        />
      )}
    </div>
  );
}
