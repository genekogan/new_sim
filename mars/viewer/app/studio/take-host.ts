// Studio glue for "Replay take" / "Watch it being built" (every year; docs/engineering/STUDIO_REPLAY.md): loads a
// recorded take on top of the year scene, hides the ambient people while it is open, hides the building a
// year-build take rebuilds (`base.campus` = mars-<year>:build:<assembly>), shifts the take by the scene datum
// (year file `groundY` − take `site.groundY`), and drives the studio camera from the take's planned engine camera
// or a directed track when that is switched on. The take clock and entity poses never depend on the camera (§18).
import * as THREE from 'three';
import { ThreeResources, disposeSkeletons } from '../../lib/three-resources';
import { loadTemplates, type Template } from '../engine-view/people.ts';
import { cameraLabel, loadTakeFile, TakeReplay, type ActiveTrack, type CameraOption, type ChapterSetEntry, type TakeManifestEntry, type TakeReplayFile } from '../engine-view/take-replay.ts';
import type { ChapterSetReplay, SetCheckIn, SetWorkerOut } from './chapter-set.ts';
import type { TakeChecks } from './take-checks.ts';
import type { Directed } from './direct-camera.ts';

export type TakeHost = ReturnType<typeof createTakeHost>;
/** What the transport drives: a single take (TakeReplay) or a chapter set played back to back (ChapterSetReplay). */
export type Transport = TakeReplay | ChapterSetReplay;

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
  /** Chapter the directed track was compiled against (a set), else null. */
  let directedChapter: { k: number; id: string; label: string; url: string } | null = null;
  let driving = false;
  // a chapter set ("Watch it being built" of a long build, STUDIO_REPLAY.md "Chapter sets: playback")
  let setReplay: ChapterSetReplay | null = null;
  let setEntry: ChapterSetEntry | null = null;
  let setLoading: ChapterSetEntry | null = null;
  let worker: Worker | null = null;
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

  /** Scene ground − take ground (see open()). */
  async function datum(file: TakeReplayFile) {
    if (!file.site) return 0;
    const { yearFile } = await import('./direct-camera.ts');
    return (await yearFile(opts.year)).groundY - file.site.groundY;
  }

  /**
   * Open a chapter set: chapter 0 as a take (datum, hidden building, ambient people hidden), then the chapters in turn
   * (ChapterSetReplay), and the whole-set checks in a worker (chapter-set.worker.ts). `entries`: the chapters' manifest
   * entries by position (their `finalStateHash` / `chapter.startHash` guard every boundary).
   */
  async function openSet(s: ChapterSetEntry | null, entries: (TakeManifestEntry | null)[] = []) {
    close();
    if (!s) return changed();
    setLoading = s;
    changed();
    try {
      templates ??= loadTemplates(abort.signal, resources);
      const [{ ChapterSetReplay }, { buildOf }, ts] = await Promise.all([import('./chapter-set.ts'), import('./direct-camera.ts'), templates]);
      if (setLoading !== s) return;
      const r = await ChapterSetReplay.open(s, entries, { signal: abort.signal, datum, templates: ts });
      if (setLoading !== s) return r.dispose();
      setReplay = r;
      setEntry = s;
      r.onChange = changed;
      scene.add(r.group);
      opts.hideAmbient(true);
      const first = r.firstTake();
      const build = first && buildOf(first);
      if (build && build.year === opts.year && opts.hideAssembly(build.assembly, true)) hidden = build.assembly;
      worker = new Worker(new URL('./chapter-set.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<SetWorkerOut>) => { if (setReplay === r) { r.onCheck(e.data); changed(); } };
      worker.onerror = (e) => { if (setReplay === r) { r.onCheck({ type: 'error', message: e.message || 'worker error' }); changed(); } };
      worker.postMessage({ set: s, entries } satisfies SetCheckIn);
    } catch (err) {
      if (!abort.signal.aborted) opts.onError(`Chapter set could not load: ${(err as Error).message}`);
    } finally {
      if (setLoading === s) setLoading = null;
      changed();
    }
  }

  function close() {
    setLoading = null;
    setEntry = null;
    worker?.terminate();
    worker = null;
    if (setReplay) {
      disposeSkeletons(setReplay.group);
      setReplay.dispose();
      setReplay = null;
      opts.hideAmbient(false);
    }
    loading = null;
    entry = null;
    checks = null;
    directed = null;
    directedChapter = null;
    if (hidden) opts.hideAssembly(hidden, false);
    hidden = null;
    if (!replay) return;
    disposeSkeletons(replay.group);
    replay.dispose();
    replay = null;
    opts.hideAmbient(false);
  }

  const transport = (): Transport | null => replay ?? setReplay;

  return {
    open,
    openSet,
    close,
    replay: () => replay,
    /** The chapter set open (ChapterSetReplay), else null. */
    setReplay: () => setReplay,
    /** The chapter set open (or loading). */
    set: () => setEntry ?? setLoading,
    /** Whichever is open: the single take or the chapter set (clock, speed, engine camera). */
    transport,
    /** The manifest entry open (or loading). */
    entry: () => entry ?? loading,
    loading: () => !!loading || !!setLoading,
    /** Final-frame checks (null while computing). */
    checks: () => checks,
    /** The building hidden while the take is open (a year-build take rebuilds it). */
    hiddenAssembly: () => hidden,
    subscribe(f: () => void) {
      listeners.add(f);
      return () => void listeners.delete(f);
    },
    /** Parse against the same active file/chapter as direct(); a changed selection discards the result. */
    async parseDirections(text: string) {
      const r = replay, sr = setReplay;
      const ch = !r && sr ? sr.chapterFile() : null;
      const file = r?.file ?? ch?.file;
      if (!file) return null;
      const { parseForTake } = await import('./direct-camera.ts');
      const parsed = await parseForTake(file, text);
      if (replay !== r || setReplay !== sr || (ch && sr?.chapterFile()?.id !== ch.id)) return null;
      return parsed;
    },
    /**
     * Compile directions against the open take in the browser (direct-camera.ts); the result is kept for the panel.
     * `play`: drive the engine camera with the directed track from its first shot.
     */
    async direct(directions: unknown[], o: { correct?: boolean; datetime?: string } = {}) {
      const r = replay, sr = setReplay;
      // a chapter set: the chapter on screen (its take, its local times; the track plays within that chapter)
      const ch = !r && sr ? sr.chapterFile() : null;
      const file = r?.file ?? ch?.file;
      if (!file) return null;
      const { directForTake } = await import('./direct-camera.ts');
      const d = await directForTake(file, directions, o);
      if (replay === r && setReplay === sr) {
        directed = d;
        directedChapter = ch ? { k: ch.k, id: ch.id, label: ch.label, url: ch.url } : null;
        sr?.setDirected(null);
        changed();
      }
      return d;
    },
    directed: () => directed,
    /** For a set: the chapter the directed track belongs to (compiled against its take), else null. */
    directedChapter: () => directedChapter,
    /**
     * The replay bar's camera picker: every track the take file carries (planned first, then `cameras` in id order)
     * plus the directed track compiled on this page when it is not saved in the file yet.
     */
    cameras(): CameraOption[] {
      if (!replay) return [];
      const out = replay.fileTracks();
      const d = directed?.track;
      if (d && !out.some((c) => c.id === d.id)) out.push({ id: d.id, kind: d.kind, label: `${cameraLabel(d)} · unsaved`, own: false, saved: false });
      return out;
    },
    /**
     * Drive the engine camera with a track by id (see cameras()): the file's tracks through `fileCamera`, or the
     * unsaved directed one. A directed track starts at its first shot, as "Play directed track" does.
     */
    useCamera(id: string) {
      if (!replay) return;
      const d = directed?.track;
      let t: ActiveTrack;
      if (d?.id === id && !replay.fileTracks().some((c) => c.id === id)) {
        replay.setTrack(d);
        t = d;
      } else t = replay.useFileTrack(id);
      replay.engineCamera = true;
      const shots = (t.data as { shots?: { t0: number }[] }).shots;
      if (t.kind === 'directed' && shots?.length) replay.seek(shots[0].t0);
      changed();
    },
    /**
     * "Save track": the open take's file with the directed track added to its `cameras` (`withFileCamera`), as JSON
     * named like the file it came from, for the owner to put into public/engine/takes/ (the browser cannot write there).
     * The open replay carries the track from now on (the picker lists it as saved).
     */
    saveDirected(): { name: string; json: string; trackId: string; cameras: string[] } | null {
      const d = directed?.track;
      if (setReplay && directedChapter && d) {
        const f = setReplay.withTrack(directedChapter.k, d);
        changed();
        return { name: directedChapter.url.split('/').pop() ?? `${f.take.id}.json`, json: JSON.stringify(f), trackId: d.id, cameras: Object.keys(f.cameras ?? {}) };
      }
      if (!replay || !entry || !d) return null;
      const f = replay.withTrack(d);
      changed();
      return { name: entry.file.split('/').pop() ?? `${replay.take.id}.json`, json: JSON.stringify(f), trackId: d.id, cameras: Object.keys(f.cameras ?? {}) };
    },
    /** Drive the engine camera with the directed track (true) or the take's own (false). */
    playDirected(on: boolean) {
      if (setReplay) {
        // the directed track plays within its chapter: go there (its first shot) and drive the camera while it is on screen
        const c = directedChapter;
        if (on && c && directed?.result.ok && directed.track) {
          setReplay.seek(setReplay.startOf(c.k) + (directed.result.report.shots[0]?.t0 ?? 0));
          setReplay.setDirected(directed.track, c.k);
          setReplay.engineCamera = true;
        } else setReplay.setDirected(null);
        changed();
        return;
      }
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
      transport()?.update(dt);
    },
    /**
     * Put the studio camera on the engine camera when it is on. Returns true when it drove the camera this frame
     * (the caller then skips OrbitControls). Switching it off hands the current pose to the user's orbit camera
     * and restores the studio fov.
     */
    drive(camera: THREE.PerspectiveCamera, target: THREE.Vector3) {
      const r = transport();
      const on = !!r && r.engineCamera;
      if (on) {
        const pose = r!.cameraPose();
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
    /** Chapter set readout (ChapterSetReplay.info + the hidden building), null when no set is open. */
    setInfo: () => (setReplay ? { ...setReplay.info(), hiddenAssembly: hidden } : null),
    /** Redraw timing of the open replay (TakeReplay.perf / ChapterSetReplay.perf: with boundary swaps and chapter loads). */
    perf: (reset = false) => transport()?.perf(reset) ?? null,
    dispose() {
      close();
      abort.abort();
      resources.dispose();
      listeners.clear();
    },
  };
}
