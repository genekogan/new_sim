// Studio glue for "Replay take" / "Watch it being built" (every year; docs/engineering/STUDIO_REPLAY.md): loads a
// recorded take on top of the year scene, hides the ambient people while it is open, hides the building a
// year-build take rebuilds (`base.campus` = mars-<year>:build:<assembly>), shifts the take by the scene datum
// (year file `groundY` − take `site.groundY`), and drives the studio camera from the take's planned engine camera
// or a directed track when that is switched on. The take clock and entity poses never depend on the camera (§18).
import * as THREE from 'three';
import { ThreeResources, disposeSkeletons } from '../../lib/three-resources';
import { loadTemplates, type Template } from '../engine-view/people.ts';
import { loadTakeFile, TakeReplay, type TakeManifestEntry } from '../engine-view/take-replay.ts';
import type { TakeChecks } from './take-checks.ts';
import type { Directed } from './direct-camera.ts';

export type TakeHost = ReturnType<typeof createTakeHost>;

export function createTakeHost(
  scene: THREE.Scene,
  opts: { year: number; hideAmbient: (hidden: boolean) => void; hideAssembly: (id: string, hidden: boolean) => boolean; onError: (message: string) => void; userFov: number },
) {
  const resources = new ThreeResources();
  const abort = new AbortController();
  let templates: Promise<Template[]> | null = null;
  let replay: TakeReplay | null = null;
  let entry: TakeManifestEntry | null = null;
  let loading: TakeManifestEntry | null = null;
  let hidden: string | null = null;
  let checks: TakeChecks | null = null;
  let directed: Directed | null = null;
  let driving = false;
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((f) => f());

  async function open(e: TakeManifestEntry | null) {
    close();
    if (!e) return changed();
    loading = e;
    changed();
    try {
      templates ??= loadTemplates(abort.signal, resources);
      const dc = import('./direct-camera.ts');
      const [file, ts] = await Promise.all([loadTakeFile(e.file, abort.signal), templates]);
      if (loading !== e) return;
      const { yearFile, buildOf } = await dc;
      // datum: the take's ground (`site.groundY`; the year-build fork stands on the Kit datum 0) → the scene's ground
      // (the year file's `groundY`, where the studio draws the ground); takes without a site are in scene coordinates
      const sceneGround = file.site ? (await yearFile(opts.year)).groundY : 0;
      if (loading !== e) return;
      replay = new TakeReplay(file, { offsetY: file.site ? sceneGround - file.site.groundY : 0 });
      replay.setTemplates(ts);
      scene.add(replay.group);
      opts.hideAmbient(true);
      const build = buildOf(file.take);
      if (build && build.year === opts.year && opts.hideAssembly(build.assembly, true)) hidden = build.assembly;
      entry = e;
      replay.update(0);
      void import('./take-checks.ts')
        .then(({ takeChecks }) => takeChecks(file, e.finalStateHash ?? null))
        .then((c) => { if (entry === e) { checks = c; changed(); } })
        .catch((err) => opts.onError(`Take check failed: ${(err as Error).message}`));
    } catch (err) {
      if (!abort.signal.aborted) opts.onError(`Take could not load: ${(err as Error).message}`);
    } finally {
      if (loading === e) loading = null;
      changed();
    }
  }

  function close() {
    loading = null;
    entry = null;
    checks = null;
    directed = null;
    if (hidden) opts.hideAssembly(hidden, false);
    hidden = null;
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
    /** The manifest entry open (or loading). */
    entry: () => entry ?? loading,
    loading: () => !!loading,
    /** Final-frame checks (null while computing). */
    checks: () => checks,
    /** The building hidden while the take is open (a year-build take rebuilds it). */
    hiddenAssembly: () => hidden,
    subscribe(f: () => void) {
      listeners.add(f);
      return () => void listeners.delete(f);
    },
    /**
     * Compile directions against the open take in the browser (direct-camera.ts); the result is kept for the panel.
     * `play`: drive the engine camera with the directed track from its first shot.
     */
    async direct(directions: unknown[], o: { correct?: boolean; datetime?: string } = {}) {
      const r = replay;
      if (!r) return null;
      const { directForTake } = await import('./direct-camera.ts');
      const d = await directForTake(r.file, directions, o);
      if (replay === r) { directed = d; changed(); }
      return d;
    },
    directed: () => directed,
    /** Drive the engine camera with the directed track (true) or the take's own (false). */
    playDirected(on: boolean) {
      if (!replay) return;
      replay.setTrack(on && directed?.track ? directed.track : null);
      if (on && directed?.result.ok) {
        replay.engineCamera = true;
        replay.seek(directed.result.report.shots[0]?.t0 ?? 0);
      }
      changed();
    },
    /** Advance/redraw the take. Call once per frame. */
    update(dt: number) {
      replay?.update(dt);
    },
    /**
     * Put the studio camera on the engine camera when it is on. Returns true when it drove the camera this frame
     * (the caller then skips OrbitControls). Switching it off hands the current pose to the user's orbit camera
     * and restores the studio fov.
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
    info: () => (replay ? { ...replay.info(), hiddenAssembly: hidden, checks } : null),
    dispose() {
      close();
      abort.abort();
      resources.dispose();
      listeners.clear();
    },
  };
}
