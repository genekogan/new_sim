// Vehicle movement profiles (spec §10 "movement profiles for … EUCs, bicycles"; §17 riding).
// A vehicle is a disc of `radius` on one ground level. Planning inflates it by `trackMargin`
// (room for the path follower's cross-track error), turning is curvature-limited with a minimum
// radius that grows with speed, and cornering speed keeps lateral acceleration ≤ `latAccel`.
import type { AgentProfile } from '../spatial/types.ts';

export type VehicleProfile = AgentProfile & {
  /** Hard speed limit (m/s); `speed` is the default cruise speed. */
  maxSpeed: number;
  /** Longitudinal acceleration (m/s²) for speeding up and planned slowing. */
  accel: number;
  /** Braking deceleration (m/s²) for stops (people on the path, arrival). */
  brake: number;
  /** Minimum turn radius (m) at or below `slowSpeed`… */
  minTurnRadius: number;
  slowSpeed: number;
  /** …growing linearly to `turnRadius` at `fastSpeed` and above. */
  turnRadius: number;
  fastSpeed: number;
  /** Lateral acceleration limit in corners (m/s²). */
  latAccel: number;
  /** Extra planning clearance beyond `radius` (m): the follower's cross-track allowance. */
  trackMargin: number;
  /** Rider's feet above the vehicle's base (m), e.g. EUC pedals. */
  riderY: number;
  /** Vehicles never use links (stairs, ladders, ramps) or leave their level. */
  links: false;
};

export const EUC_PROFILE: VehicleProfile = {
  id: 'euc',
  radius: 0.35,
  height: 2.0,
  speed: 3,
  maxSpeed: 5,
  turnRate: 2.0, // rad/s: the rider twists the wheel round at a standstill
  stepHeight: 0.05, // kerbs above 5 cm block
  accel: 1.2,
  brake: 2.0,
  minTurnRadius: 0.6,
  slowSpeed: 1.0,
  turnRadius: 1.5,
  fastSpeed: 3.0,
  latAccel: 2.0,
  trackMargin: 0.15,
  riderY: 0.15,
  links: false,
};

export const BICYCLE_PROFILE: VehicleProfile = {
  id: 'bicycle',
  radius: 0.4,
  height: 1.9,
  speed: 4,
  maxSpeed: 6,
  turnRate: 1.0, // rad/s: the rider walks the bike round at a standstill
  stepHeight: 0.08,
  accel: 1.0,
  brake: 2.0,
  minTurnRadius: 1.2,
  slowSpeed: 1.5,
  turnRadius: 2.0,
  fastSpeed: 4.0,
  latAccel: 2.0,
  trackMargin: 0.15,
  riderY: 0,
  links: false,
};

/** Vehicle profile by catalog def id. */
export const VEHICLE_PROFILES: Record<string, VehicleProfile> = { euc: EUC_PROFILE, bicycle: BICYCLE_PROFILE };

export const vehicleProfile = (defId: string): VehicleProfile | undefined => VEHICLE_PROFILES[defId];

/** Minimum turn radius (m) at speed v. */
export function turnRadiusAt(pr: VehicleProfile, v: number): number {
  if (v <= pr.slowSpeed) return pr.minTurnRadius;
  if (v >= pr.fastSpeed) return pr.turnRadius;
  return pr.minTurnRadius + ((v - pr.slowSpeed) / (pr.fastSpeed - pr.slowSpeed)) * (pr.turnRadius - pr.minTurnRadius);
}

/** Highest speed at which an arc of radius rho is drivable (turn radius and lateral acceleration). */
export function speedForRadius(pr: VehicleProfile, rho: number): number {
  const lat = Math.sqrt(pr.latAccel * rho);
  let turn: number;
  if (rho >= pr.turnRadius) turn = Infinity;
  else if (rho < pr.minTurnRadius) turn = 0;
  else turn = pr.slowSpeed + ((rho - pr.minTurnRadius) / (pr.turnRadius - pr.minTurnRadius)) * (pr.fastSpeed - pr.slowSpeed);
  return Math.min(pr.maxSpeed, lat, turn);
}
