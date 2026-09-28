// Vehicles (EUC, bicycle): profiles, riding verbs, invariants. See docs/engineering/VEHICLES.md.
export { EUC_PROFILE, BICYCLE_PROFILE, VEHICLE_PROFILES, vehicleProfile, turnRadiusAt, speedForRadius, type VehicleProfile } from './profiles.ts';
export { mount, dismount, rideTo, rideLoop, vehicle, VEHICLE_ACTIONS, MOUNT_REACH, STOP_GAP, PASS_GAP, PASS_SPEED } from './actions.ts';
export { planCurve, vehicleGrids, type Curve } from './curve.ts';
export { vehicleRider, vehicleClearance, vehicleMotion, VEHICLE_INVARIANTS } from './invariants.ts';
export { vehicleCollision, footprintOf, pathConflict, outranks, YIELD_GAP, V_STOP_GAP, FOOTPRINT_PARTS, type Footprint, type Lane } from './traffic.ts';
