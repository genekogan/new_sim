// Floors (2026-10-26, Gene's Chiba report): the floor plates of mesh defs whose footprint sidecars carry none. The
// mars-two build cut every non-authored building's raised wooden floor out of its obstacles and never wrote it as a
// floor, so a Soul inside Chiba stood on the terrain 0.37 m under the gallery deck and sat inside the presenter box
// standing on it. Worlds keep the def revisions they placed (stored by hash, never rewritten), so, as SEAT_HEIGHTS does
// for seats, these apply to every revision of the def by name. Measured from the def's own model (up-facing plate,
// def frame: metres, origin at the base centre, +y up) with team/scratch/mars-floors-20261026/deck-tris.mjs.
type Vec2 = [number, number];

/** One floor plate: a rectangle in the def frame at height `y` above the def's base, with the words agents read. */
export type FloorPlate = { id: string; label: string; y: number; polygon: Vec2[]; openings?: string };

const rect = (x0: number, x1: number, z0: number, z1: number): Vec2[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

export const FLOOR_PLATES: Readonly<Record<string, readonly FloorPlate[]>> = Object.freeze({
  // the auditorium / gallery deck under the presenter box, the projector table and the navy sofas (placed at y 0.373)
  'core-mars-chiba': [{ id: 'chiba-deck', label: 'raised gallery floor', y: 0.374, polygon: rect(-1.64, 11.25, -5.39, 5.8) }],
});

/** A floor this close above the terrain is walked onto as a step (level 0); a higher one is a floor of its own that
 *  stairs, a ramp or a ladder reach. */
export const STEP_UP = 0.45;

/** Whether a floor plate at world height `y` over terrain at `ground` is walked onto as a step (the ground's level 0):
 *  from just under the terrain (a plate laid into it) up to STEP_UP above it. */
export function plateIsStep(y: number, ground: number): boolean { const d = y - ground; return d >= -0.35 && d <= STEP_UP + 1e-9; }

/** The floor plates of a def (by name, every revision); empty when it has none listed. */
export function floorPlatesOf(defName: string, asset?: string): readonly FloorPlate[] {
  // The live Mars fidelity patch gives Chiba a local def name while changing UVs
  // only. Its content-addressed geometry is checked by mesh-floors extraction.
  if (asset === '99d5c2f524280ef10ca5ef88e9095434ff30a177d42bc67ff5e8d451836e89af') return FLOOR_PLATES['core-mars-chiba'];
  return FLOOR_PLATES[defName] ?? [];
}
