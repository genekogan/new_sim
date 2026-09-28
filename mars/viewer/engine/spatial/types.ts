// Spatial description consumed by navigation and validation. It is derived
// from (static base geometry + current world entities) so construction changes
// automatically change what is walkable and what blocks (spec §10).
import type { OBB2, Vec2 } from '../core/math.ts';

/** A solid prism: ground footprint + vertical extent (world y). */
export type Obstacle = { id: string; obb: OBB2; y0: number; y1: number; label?: string; kind?: 'wall' | 'solid' | 'glass' | 'component' | 'vehicle' | 'fixture' };

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
};

export type Level = { id: number; y: number; label: string };

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
