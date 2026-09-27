// Studio glue for "Replay take" (2026 only): loads a recorded take on top of
// the campus scene, hides the ambient people while it is open, and drives the
// studio camera from the planned engine camera track when that is switched on.
// The take clock and entity poses never depend on the camera (spec §18).
import * as THREE from 'three';
import { ThreeResources, disposeSkeletons } from '../../lib/three-resources';
import { loadTemplates, type Template } from '../engine-view/people.ts';
import { loadTakeFile, TakeReplay, type TakeManifestEntry } from '../engine-view/take-replay.ts';

export type TakeHost = ReturnType<typeof createTakeHost>;

export function createTakeHost(scene: THREE.Scene, opts: { hideAmbient: (hidden: boolean) => void; onError: (message: string) => void; userFov: number }) {
  const resources = new ThreeResources();
  const abort = new AbortController();
  let templates: Promise<Template[]> | null = null;
  let replay: TakeReplay | null = null;
  let loading: TakeManifestEntry | null = null;
  let driving = false;

  async function open(entry: TakeManifestEntry | null) {
    close();
    if (!entry) return;
    loading = entry;
    try {
      templates ??= loadTemplates(abort.signal, resources);
      const [file, ts] = await Promise.all([loadTakeFile(entry.file, abort.signal), templates]);
      if (loading !== entry) return;
      replay = new TakeReplay(file);
      replay.setTemplates(ts);
      scene.add(replay.group);
      opts.hideAmbient(true);
      replay.update(0);
    } catch (e) {
      if (!abort.signal.aborted) opts.onError(`Take could not load: ${(e as Error).message}`);
    } finally {
      if (loading === entry) loading = null;
    }
  }

  function close() {
    loading = null;
    if (!replay) return;
    disposeSkeletons(replay.group);
    replay.dispose();
    replay = null;
    opts.hideAmbient(false);
  }

  return {
    open,
    close,
    replay: () => replay,
    /** Advance/redraw the take. Call once per frame. */
    update(dt: number) {
      replay?.update(dt);
    },
    /**
     * Put the studio camera on the planned engine camera when it is on. Returns true when it drove
     * the camera this frame (the caller then skips OrbitControls). Switching it off hands the
     * current pose to the user's orbit camera and restores the studio fov.
     */
    drive(camera: THREE.PerspectiveCamera, target: THREE.Vector3) {
      const on = !!replay && replay.engineCamera;
      if (on) {
        const pose = replay!.cameraPose();
        camera.position.fromArray(pose.position);
        target.fromArray(pose.target);
        camera.lookAt(target);
        if (camera.fov !== pose.fov) {
          camera.fov = pose.fov;
          camera.updateProjectionMatrix();
        }
      } else if (driving && camera.fov !== opts.userFov) {
        camera.fov = opts.userFov;
        camera.updateProjectionMatrix();
      }
      driving = on;
      return on;
    },
    info: () => replay?.info() ?? null,
    dispose() {
      close();
      abort.abort();
      resources.dispose();
    },
  };
}
