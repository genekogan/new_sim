// VOCAB-MECH: lazy GLB fetch for worlds with many imported types. Measured (tools/god-skill/scripts/vocab-payload.mjs):
// one of every core point def = 187 GLBs, 87 MB; before this, a viewer downloaded all of it before the world was
// usable. Now:
//   - the snapshot plans an EAGER set: the GLBs of things nearest the arrival (the world's centre), up to ~24 MB; the
//     loading bar expects only those;
//   - every other GLB loads when its thing is first in view within NEAR_M of the camera, or in the background a few
//     at a time once the eager set is in (nearest to the camera first), so a world still fills in without waiting;
//   - `?shot` pages (god `look`, thumbnails) and `?assets=eager` load everything at once, as before.
// Content-addressed URLs stay immutable (/assets/<sha>.glb): each GLB is fetched once per browser, whenever it is.
import * as THREE from 'three';
import type { Entity, StoredDef } from '@sim/world-compiler';

const qs = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
export const LAZY = !qs.has('shot') && qs.get('assets') !== 'eager';
export const EAGER_BYTES = Math.max(1, Number(qs.get('eagerMB') ?? 24)) * 1e6;
export const NEAR_M = 120;
const BACKGROUND_DELAY_MS = 6000, BACKGROUND_PARALLEL = 2;

let eager: Set<string> | null = null;            // null: no plan, everything is eager
const waiting = new Map<string, { start: () => void; at: THREE.Vector3 }[]>();
const started = new Set<string>();
const camera = new THREE.Vector3(0, 30, 60);
let background: ReturnType<typeof setTimeout> | null = null, running = 0;

const shasOf = (d: StoredDef | undefined) => (d && d.make.kind === 'mesh' ? JSON.stringify(d.make).match(/[0-9a-f]{64}/g) ?? [] : []);

/** Choose the eager GLBs for a snapshot: nearest-first to `centre` until EAGER_BYTES. Returns the loading bar's sizes. */
export function planEager(snap: { entities: Entity[]; assetBytes?: Record<string, number> }, defOf: (ref: string) => StoredDef | undefined, posOf: (e: Entity) => [number, number] | null, centre: [number, number] = [0, 0]): Record<string, number> {
  const sizes = snap.assetBytes ?? {};
  if (!LAZY) { eager = null; return sizes; }
  const dist = new Map<string, number>();
  for (const e of snap.entities) {
    const shas = shasOf(defOf(e.def)); if (!shas.length) continue;
    const p = posOf(e), d = p ? Math.hypot(p[0] - centre[0], p[1] - centre[1]) : 1e9;
    for (const sha of shas) dist.set(sha, Math.min(dist.get(sha) ?? Infinity, d));
  }
  const order = [...dist.keys()].sort((a, b) => dist.get(a)! - dist.get(b)!);
  const pick = new Set<string>(); let bytes = 0;
  for (const sha of order) { const n = sizes[sha] ?? 0; if (pick.size && (bytes + n > EAGER_BYTES || dist.get(sha)! > NEAR_M * 2)) continue; pick.add(sha); bytes += n; }
  eager = pick;
  scheduleBackground();
  return Object.fromEntries(Object.entries(sizes).filter(([sha]) => pick.has(sha)));
}
export const isEager = (sha: string) => !LAZY || !eager || eager.has(sha) || started.has(sha);

/** Defer one thing's GLB load: returns an invisible hook to add to the thing's group. `start` runs once, when the thing is
 *  in view within NEAR_M of the camera, or when the background loader reaches it. */
export function deferLoad(sha: string, start: () => void, makeHook: (fn: (cam: THREE.Camera) => void) => THREE.Object3D): THREE.Object3D {
  let done = false;
  const at = new THREE.Vector3();
  // once started the hook has done its job: leave the scene (lane PERF: one no-op draw fewer per thing, every frame)
  const go = () => { if (done) return; done = true; started.add(sha); start(); queueMicrotask(() => hook.removeFromParent()); };
  const entry = { start: go, at };
  const list = waiting.get(sha) ?? []; list.push(entry); waiting.set(sha, list);
  const hook = makeHook((cam) => {
    if (done) return;
    hook.getWorldPosition(at); camera.copy(cam.position);
    if (started.has(sha) || at.distanceTo(cam.position) < NEAR_M) go();
  });
  hook.addEventListener('removed', () => { done = true; const l = waiting.get(sha); if (l) { const i = l.indexOf(entry); if (i >= 0) l.splice(i, 1); if (!l.length) waiting.delete(sha); } });
  return hook;
}

/** After the eager set, fetch the rest a few at a time, nearest to the camera first. */
function scheduleBackground() {
  if (background) clearTimeout(background);
  background = setTimeout(function tick() {
    background = null;
    while (running < BACKGROUND_PARALLEL && waiting.size) {
      let best: string | null = null, bd = Infinity;
      for (const [sha, list] of waiting) for (const w of list) { const d = w.at.lengthSq() ? w.at.distanceTo(camera) : 1e9; if (d < bd) { bd = d; best = sha; } }
      if (!best) break;
      const list = waiting.get(best)!; waiting.delete(best); running++;
      for (const w of list) w.start();
      setTimeout(() => { running--; }, 1500);   // the loadAsset promise is per sha; pace by time, not by completion
    }
    if (waiting.size) background = setTimeout(tick, 1500);
  }, BACKGROUND_DELAY_MS);
}
/** New things after arrival (a god's edit) follow the same rule; a deferred thing re-arms the background loader. */
export function noteDeferred() { if (LAZY && !background) scheduleBackground(); }
