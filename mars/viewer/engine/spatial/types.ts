// Spatial description consumed by navigation and validation. It is derived
// from (static base geometry + current world entities) so construction changes
// automatically change what is walkable and what blocks (spec §10).
import type { OBB2, Vec2 } from '../core/math.ts';

/** A solid prism: ground footprint + vertical extent (world y). */
/**
 * `raster: 'centre'` (door-raster/1, lane RT 2026-10-20): the walk raster blocks only the cells whose centre lies inside the
 * box, not every cell the box touches. For wall pieces at least a cell thick (a god building's walls): the conservative
 * raster grows a turned wall by up to half a cell diagonal on each face, so a 1 m doorway at an odd yaw kept 0.35 m of
 * clearance and a 0.9 m interior door less than the 0.34 m a body plans with. Absent: the conservative raster, as before
 * (old world-edit logs carry no field and replay unchanged).
 */
export type Obstacle = { id: string; obb: OBB2; y0: number; y1: number; label?: string; kind?: 'wall' | 'solid' | 'glass' | 'component' | 'vehicle' | 'fixture'; raster?: 'centre' };

/** A horizontal walkable surface (ground patch, deck, landing). */
export type Surface = { id: string; level: number; y: number; obb: OBB2; label?: string };

/**
 * Contextual traversal between levels (stairs, ladders) — cf. Recast off-mesh
 * connections / Unity NavMeshLink. Entry and exit are regions with a required
 * facing; the traversal itself follows `path` (per-step positions).
 */
export type Link = {
  id: string;
  kind: 'stairs' | 'ladder' | 'ramp' | 'climb' | 'beam';
  from: { level: number; p: Vec2; y: number };
  to: { level: number; p: Vec2; y: number };
  /** Usable width (m). */
  width: number;
  /** Heading (radians) to face while ascending from `from` → `to`. */
  heading: number;
  /** Explicit 3D step path for traversal animation (bottom → top). */
  path: [number, number, number][];
  usable: boolean;
  /** Why not usable (e.g. 'steps 6–9 not installed'). */
  reason?: string;
  /**
   * Where a body stands just before entering at each end (god-built stairs whose foot or head is close
   * to a wall are entered from the side). Absent: 0.7 m back along `heading` from that end.
   */
  approach?: { from?: Vec2; to?: Vec2 };
  /**
   * Rack-structure access (construction/frame.ts): `climb` = an installed upright's bracing used as a
   * ladder, `beam` = a connected beam walked as a narrow walkway. Both are narrower than a person's
   * routing disc (width < 2 × radius), so the generic route planner never uses them; only the frame
   * verbs (climb_frame, beam_walk, hand_up) traverse them. Optional and additive.
   */
  maxSpeed?: number;
  /** People allowed on it at once (a climb is single-occupant). */
  occupancy?: number;
  /** What may be carried on it: nothing, or only small loads (catalog `handling.smallLoad`). */
  carry?: 'none' | 'small';
  /** Entities that form it (the upright; the beam and its partner beam). */
  members?: string[];
  /**
   * upper-floors/1: a flight that turns (a dog-leg stair with a landing): the body faces along its own step path while
   * climbing, instead of keeping `heading` throughout. Absent: unchanged (straight flights face `heading`).
   */
  faceAlong?: boolean;
};

export type Level = {
  id: number; y: number; label: string;
  /**
   * upper-floors/1: the world rectangle [minX, minZ, maxX, maxZ] this level's grid covers (a building's upper floors), on the
   * shared lattice. Absent: the whole scene bounds (every other level). A cropped level costs its own area, not the campus's.
   */
  crop?: [number, number, number, number];
};

export type SpatialScene = {
  bounds: [minX: number, minZ: number, maxX: number, maxZ: number];
  levels: Level[];
  surfaces: Surface[];
  obstacles: Obstacle[];
  links: Link[];
};

/** Movement profile (spec §10). */
export type AgentProfile = { id: string; radius: number; height: number; speed: number; turnRate: number; stepHeight: number };

export const HUMAN_PROFILE: AgentProfile = { id: 'human', radius: 0.28, height: 1.8, speed: 1.35, turnRate: 4.0, stepHeight: 0.22 };
