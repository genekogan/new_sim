// Optional view controller over the existing Lab world; camera policy remains camera-owned.
import { useEffect, useState } from 'react';
import { attachLabCamera } from '../../cinematography/lab-driver.ts';
import type { Policy } from '../../cinematography/types.ts';
import type { EngineHook } from './hook.ts';
import type { LabView } from './lab-view.ts';
import { activityCameraScenario } from '../../cinematography/activity-observation.ts';

export function LabCameraControls({ view }: { view: LabView }) {
  const [mode, setMode] = useState<Policy | 'off'>('off');
  const [camera, setCamera] = useState<ReturnType<typeof attachLabCamera>>();
  const scenario = view.sim.scenario.name;
  const classroom = scenario === 'classroom-4' || scenario === 'classroom-8';
  const supported = classroom || activityCameraScenario(scenario);
  useEffect(() => {
    if (!supported || mode === 'off') return;
    let controller: ReturnType<typeof attachLabCamera> | undefined;
    const start = () => {
      const hook = (window as unknown as { __marsEngine?: EngineHook }).__marsEngine;
      if (!hook?.ready || controller) return;
      controller = attachLabCamera(hook, mode);
      setCamera(controller);
    };
    const ready = setInterval(start, 100);
    start();
    return () => {
      clearInterval(ready);
      controller?.dispose();
      setCamera(undefined);
    };
  }, [view, scenario, supported, mode]);
  if (!supported) return null;
  return <div className="lab-field" data-testid="lab-camera-controls">
    <label>Live camera <select aria-label="Live camera" value={mode} onChange={(e) => setMode(e.target.value as Policy | 'off')}>
      <option value="off">Manual</option>
      <option value="clear">Clear activity coverage</option>
      <option value="restrained">Restrained observation</option>
    </select></label>
    {mode !== 'off' && <>
      <button disabled={!camera} onClick={() => {
        const subject = classroom ? 'guest2' : camera?.preferredSubject();
        if (subject) camera?.takeover(subject, 6);
      }}>{classroom ? 'Follow guest2' : 'Follow activity person'}</button>
      <button disabled={!camera} onClick={() => camera?.release()}>Return camera to auto</button>
      <small>Orbit temporarily takes control for six simulation seconds. Escape returns to auto. Camera changes leave this world running.</small>
    </>}
  </div>;
}
