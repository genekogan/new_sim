// Current-source browser fixtures: never substitute the byte-frozen source-era Node scene.
import { loadCampusFile } from '../engine/campus/history-node.ts';
import { loadCampusYear } from '../engine/campus/history.ts';
import { Runtime } from '../engine/runtime/runtime.ts';
import { TakeRecorder } from '../engine/take/recorder.ts';
import { compileTakeCamera } from '../app/studio/direct-camera-compile.ts';
import { toCameraTrack } from '../engine/camera/track.ts';
import type { CameraDirection } from '../engine/camera/direct.ts';
import type { TakeReplayFile } from '../app/engine-view/take-replay.ts';

export const CURRENT_COUNTER = 'chiba-kitchen-kitchen-counter-f36f13fb';
export const CURRENT_KITCHEN_DIRECTION: CameraDirection = {
  subject: { kind: 'fixture', ref: CURRENT_COUNTER },
  motion: { verb: 'fly_through', from: [1.829, 1.44, -0.9] },
  context: { interior: 'chiba-kitchen', lookAt: CURRENT_COUNTER },
  duration: 20,
};

export function currentCameraFile(duration = 30): TakeReplayFile {
  const { base: scene, world } = loadCampusYear(2024, loadCampusFile(2024));
  const runtime = new Runtime(world, new Map(), {});
  const recorder = new TakeRecorder(runtime, { rulesVersion: 'current-source-browser-camera-test' });
  for (let i = 0; i < duration * 20; i++) runtime.step();
  const take = recorder.finish();
  const compiled = compileTakeCamera({ take, scene, directions: [CURRENT_KITCHEN_DIRECTION], opts: {} });
  if (!compiled.result.ok) throw new Error(JSON.stringify(compiled.result.diagnostics));
  return { schema: 'mars-take-replay/1', label: 'Current museum camera test', hypothetical: true,
    note: 'Action-free test take against current museum geometry; no historical activity claim', campus: 'mars-2024',
    steps: [], moments: {}, take, camera: toCameraTrack('current-museum-camera-test', take.id, compiled.result.plan) };
}
