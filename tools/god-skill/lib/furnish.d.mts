// Types for furnish.mjs (L2's furnish recipes), so the server's query.ts typechecks.
export interface FurnishResult { ops: unknown[]; placed: unknown[]; dropped: unknown[]; notes: string[] }
export function furnishBatch(model: unknown, buildingId: string, style?: string, opts?: { rooms?: string[]; recipe?: unknown }): FurnishResult;
type Vec2 = number[];
type Box = { c: Vec2; half: number[]; yaw: number; y0?: number; y1?: number; tag?: string; raster?: 'conservative' | 'centre' };
/** Labelled on the walk raster where the room stands (a building's world pose), else by the exact rule (clearance.ts). */
type WayOpts = { r?: number; pose?: { x: number; z: number; yaw: number; s?: number } };
type Room = { id: string; floor: number; polygon: Vec2[] };
/** A way key: a point, or the free cell nearest any of `pts` within `r` metres. */
export type WayKey = Vec2 | { pts: Vec2[]; r: number };
export function roomKeys(room: Room, doors: unknown[], links: unknown[]): Vec2[];
export function approachOf(baked: unknown, at: Vec2, yaw: number): WayKey;
export function wayLabels(room: Room, keys: WayKey[], blockers: Box[], o?: WayOpts): number[];
export function connectedPairs(room: Room, keys: WayKey[], blockers: Box[], o?: WayOpts): number;
