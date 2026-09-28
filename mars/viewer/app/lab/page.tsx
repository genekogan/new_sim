// /lab — Engine Lab: the deterministic engine running live in the browser over
// the proving ground, rendered with the studio's animated people.
import { useEffect, useReducer, useRef, useState } from 'react';
import { LabView, OVERLAYS, type OverlayName } from './lab-view.ts';
import { installHook, removeHook } from './hook.ts';
import { SCENARIOS, dropPanel, PANEL_ID } from './scenarios.ts';
import { LabPanel } from './panel.tsx';
import { SequenceHud } from './sequence-hud.tsx';
import { SocialHud } from './social-hud.tsx';
import './lab.css';

export default function Lab() {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<LabView | null>(null);
  const [, refresh] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const v = new LabView(host.current!);
    const initial =
      new URLSearchParams(location.search).get('scenario') ?? SCENARIOS[0].name;
    const first = SCENARIOS.find((s) => s.name === initial) ?? SCENARIOS[0];
    let live = true;
    // scenarios with async data (year walkabouts) start on the default preset until it arrives
    v.sim.load(first.prepare ? SCENARIOS[0].name : first.name);
    if (first.prepare)
      v.sim.loadAsync(first.name).then(
        () => live && refresh(),
        (e) => live && ((v.error = `${first.name}: ${e.message}`), refresh()),
      );
    installHook(v, refresh);
    v.start();
    setView(v);
    const t = setInterval(refresh, 250);
    return () => {
      live = false;
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
          {failed.map((r) => {
            const expected = !!sim!.scenario.expectedFailure?.(sim!.rt, r.id);
            return (
              <div key={r.id} className={`lab-banner ${expected ? 'expected' : 'error'}`} role="alert">
                {r.id} {r.verb} {expected ? 'EXPECTED CONFLICT (scripted, not a failure)' : 'FAILED'} · {r.diagnostic?.code}:{' '}
                {r.diagnostic?.message}
              </div>
            );
          })}
        </div>
        {sim && <SequenceHud sim={sim} />}
        {sim && <SocialHud sim={sim} />}
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
            view.sim.loadAsync(name).then(
              () => {
                history.replaceState(null, '', `/lab?scenario=${name}`);
                refresh();
              },
              (e) => ((view.error = `${name}: ${e.message}`), refresh()),
            );
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
                  view.components.onTick(view.sim.rt.world);
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
