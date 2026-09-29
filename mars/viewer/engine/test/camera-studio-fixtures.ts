// Hypothetical, action-free file take for studio camera tests; historical scene data is read-only.
import { loadCampusYear } from '../campus/history.ts';
import { loadCampusFile } from '../campus/history-node.ts';
import { Runtime } from '../runtime/runtime.ts';
import { TakeRecorder } from '../take/recorder.ts';
import { directCamera } from '../camera/synth.ts';
import { toCameraTrack } from '../camera/track.ts';
import type { TakeReplayFile } from '../../app/engine-view/take-replay.ts';

export function kitchenCameraFile(duration = 6): TakeReplayFile {
  const { base, world } = loadCampusYear(2024, loadCampusFile(2024));
  const runtime = new Runtime(world, new Map(), {});
  const recorder = new TakeRecorder(runtime, { rulesVersion: 'camera-studio-test' });
  for (let i = 0; i < duration * 20; i++) runtime.step();
  const take = recorder.finish();
  const camera = directCamera([{ subject: { kind: 'fixture', ref: 'sink' }, motion: { verb: 'hold' }, duration: 6 }], { scene: base, world: take.finalState, sampler: () => ({}), duration: 6 });
  if (!camera.ok) throw new Error(JSON.stringify(camera.diagnostics));
  return { schema: 'mars-take-replay/1', label: 'Camera vocabulary test', hypothetical: true, note: 'Action-free test take; no historical claim', campus: 'mars-2024', steps: [], moments: {}, take, camera: toCameraTrack('kitchen-camera-test', take.id, camera.plan) };
}
