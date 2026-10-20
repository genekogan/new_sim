// ANI: animals give way to people. Gene 2026-10-20: "the horses just walk right through the souls".
// Animals are scenery drawn on the client from a pure function of wall-clock time (behavior.ts for god worlds,
// eden-imports/animals.ts for old Eden); the server never simulates them. So the cheapest fix is visual: when an
// animal's routine spot comes within `clear` metres of a Soul's drawn figure, the drawn animal is eased out of the
// way (it walks around the Soul, or steps aside while grazing) and eases back onto its routine once the Soul has
// passed. No physics, no server state, nothing replayed: a few multiply-adds per animal per frame against the
// handful of Souls on screen, and the routine itself stays a pure function of time.

export type Person = readonly [number, number];
export type GiveWayState = { ox: number; oz: number; t: number; yaw: number; dist: number; px: number; pz: number };
export const giveWayState = (): GiveWayState => ({ ox: 0, oz: 0, t: Number.NaN, yaw: Number.NaN, dist: 0, px: Number.NaN, pz: Number.NaN });

/** A Soul's figure as a disc (m): shoulders plus a little personal space. */
export const PERSON_R = 0.45;
/** How close an animal of body length `length` (m) may come to a Soul's centre before it gives way. */
export const clearFor = (length: number) => PERSON_R + Math.max(0.15, length * 0.5);
/** The offset shrinks back to the routine at this pace (m/s): an unhurried walk. */
const BACK = 1.2;

let provider: (() => readonly Person[]) | null = null, frame = Number.NaN, list: readonly Person[] = [];
/** The live view tells the animals where people are now (Souls' figures, x/z); null = nobody. */
export function setPeopleSource(fn: (() => readonly Person[]) | null) { provider = fn; frame = Number.NaN; list = []; }
/** People this frame (`t` = the frame's world time; the provider is asked once per frame however many animals ask). */
export function peopleNow(t: number): readonly Person[] {
  if (t !== frame) { frame = t; try { list = provider?.() ?? []; } catch { list = []; } gridOf = null; }
  return list;
}
// A crowd (more than a few dozen people) is bucketed once per frame into 4 m cells, so each animal looks at the
// people in the cells round it instead of at everyone.
const CELL = 4, FEW = 24, near: Person[] = [], NOBODY: readonly Person[] = [];
/** ?giveway=0: animals walk through people as before (before/after comparisons) */
const OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('giveway') === '0';
let gridOf: readonly Person[] | null = null; const grid = new Map<number, Person[]>();
const cellKey = (ix: number, iz: number) => (ix + 32768) * 65536 + (iz + 32768);
/** The people this frame who may be within `r` of (x, z) (a superset; the returned array is reused next call). */
export function peopleNear(t: number, x: number, z: number, r: number): readonly Person[] {
  if (OFF) return NOBODY;
  const all = peopleNow(t);
  if (all.length <= FEW) return all;
  if (gridOf !== all) {
    gridOf = all; grid.clear();
    for (const q of all) { const k = cellKey(Math.floor(q[0] / CELL), Math.floor(q[1] / CELL)); const b = grid.get(k); if (b) b.push(q); else grid.set(k, [q]); }
  }
  near.length = 0;
  for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++)
    for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) { const b = grid.get(cellKey(ix, iz)); if (b) for (const q of b) near.push(q); }
  return near;
}
/** How far from its routine spot an animal must look for people (`clear` plus its current offset, plus a margin). */
export const lookFor = (st: GiveWayState, clear: number) => clear + Math.hypot(st.ox, st.oz) + 0.5;

export type GiveWay = { x: number; z: number; yaw: number;
  /** speed of the drawn animal (m/s) and the extra distance it has walked giving way, ever (add to the stride distance) */
  speed: number; extra: number;
  /** false: nobody near and back on the routine (x, z, yaw are the routine's own) */
  active: boolean };

/** Where to draw an animal whose routine puts it at (x, z) facing `yaw` (walking or not), given the people about. `st` keeps the drawn
 *  offset from the routine: it shrinks back to zero at a walk, and the drawn spot is kept out of every person's disc by
 *  pushing it out radially and sliding it round the side the routine is heading for (so a head-on meeting walks
 *  round the Soul, never back through it). `free` (optional) refuses a spot inside a wall or water: the animal then
 *  holds where it was. With nobody near and the offset gone, the routine pose is returned untouched. */
export function giveWay(st: GiveWayState, x: number, z: number, yaw: number, moving: boolean, people: readonly Person[], clear: number, t: number,
  free?: (x: number, z: number) => boolean): GiveWay {
  const dt = Number.isFinite(st.t) ? Math.min(0.25, Math.max(0, t - st.t)) : 0; st.t = t;
  let ox = st.ox, oz = st.oz;
  const off0 = Math.hypot(ox, oz);
  if (off0 > 0) { const k = Math.max(0, off0 - BACK * dt) / off0; ox *= k; oz *= k; }   // ease back onto the routine
  const reach = clear + off0 + 0.5;
  // push the drawn spot out of everyone's disc; `flip` slides round the other side (when the first side is walled)
  const push = (flip: boolean): [number, number, boolean] => {
    let px = ox, pz = oz, hit = false;
    for (let pass = 0; pass < 2 && (pass === 0 || hit); pass++) {   // a second pass only to settle two people at once
      for (const q of people) {
        const vx = x + px - q[0], vz = z + pz - q[1];
        if (vx > reach || vx < -reach || vz > reach || vz < -reach) continue;   // most people are far: no sqrt
        const d = Math.hypot(vx, vz);
        if (d >= clear) continue;
        hit = true;
        let nx: number, nz: number;
        if (d > 1e-4) { nx = vx / d; nz = vz / d; } else { nx = Math.cos(yaw); nz = -Math.sin(yaw); }   // dead centre: step aside
        // walking into the person: slide round them, on the side the heading already leans to (one fixed side when
        // dead ahead). Standing (grazing, resting): just step back out, so a passing Soul nudges it aside.
        const pen = clear - d, hx = Math.sin(yaw), hz = Math.cos(yaw);
        let tx = 0, tz = 0;
        if (moving && -(nx * hx + nz * hz) > 0.2) {
          const lean = -nz * hx + nx * hz;   // heading . (-nz, nx)
          const s = (Math.abs(lean) < 1e-6 ? -1 : Math.sign(lean)) * (flip ? -1 : 1);
          tx = -nz * s * pen; tz = nx * s * pen;
        }
        px += nx * pen + tx; pz += nz * pen + tz;
      }
    }
    return [px, pz, hit];
  };
  let [cx, cz, touched] = push(false);
  if (touched && free && !free(x + cx, z + cz)) {
    [cx, cz] = push(true);
    // walled on both sides: hold where it was drawn last frame
    if (!free(x + cx, z + cz)) { cx = Number.isFinite(st.px) ? st.px - x : st.ox; cz = Number.isFinite(st.pz) ? st.pz - z : st.oz; }
  }
  ox = cx; oz = cz;
  st.ox = ox; st.oz = oz;
  const off = Math.hypot(ox, oz);
  if (!touched && off < 1e-3) {
    st.ox = 0; st.oz = 0; st.yaw = Number.NaN; st.px = Number.NaN;   // st.dist stays: the stride phase must not jump
    return { x, z, yaw, speed: 0, extra: st.dist, active: false };
  }
  const dx = x + ox, dz = z + oz;
  // face where the drawn animal is going; blend back to the routine heading as the offset shrinks
  let moved = 0, vy = Number.NaN;
  if (Number.isFinite(st.px) && dt > 0) { const mx = dx - st.px, mz = dz - st.pz; moved = Math.hypot(mx, mz); if (moved / dt > 0.15) vy = Math.atan2(mx, mz); }
  st.px = dx; st.pz = dz; st.dist += moved;
  if (!Number.isFinite(st.yaw)) st.yaw = yaw;
  if (Number.isFinite(vy)) st.yaw = turn(st.yaw, vy, Math.min(1, dt * 6));
  const w = Math.min(1, off / 0.35);
  return { x: dx, z: dz, yaw: turn(yaw, st.yaw, w), speed: dt > 0 ? moved / dt : 0, extra: st.dist, active: true };
}
const turn = (a: number, b: number, k: number) => { const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * k; };
