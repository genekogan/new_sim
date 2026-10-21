// Types for furnish.mjs (L2's furnish recipes), so the server's query.ts typechecks.
export interface FurnishResult { ops: unknown[]; placed: unknown[]; dropped: unknown[]; notes: string[] }
export function furnishBatch(model: unknown, buildingId: string, style?: string, opts?: { rooms?: string[]; recipe?: unknown }): FurnishResult;
type Vec2 = number[];
type Box = { c: Vec2; half: number[]; yaw: number; y0?: number; y1?: number };
type Room = { id: string; floor: number; polygon: Vec2[] };
/** A way key: a point, or the free cell nearest any of `pts` within `r` metres. */
export type WayKey = Vec2 | { pts: Vec2[]; r: number };
export function roomKeys(room: Room, doors: unknown[], links: unknown[]): Vec2[];
export function approachOf(baked: unknown, at: Vec2, yaw: number): WayKey;
export interface WayGrid { x0: number; z0: number; nx: number; nz: number; free: Uint8Array }
export function wayGrid(room: Room, blockers: Box[]): WayGrid;
export function gridWith(grid: WayGrid, ...blockers: Box[]): WayGrid;
export function gridLabels(grid: WayGrid, keys: WayKey[], cells?: number[]): number[];
export function wayLabels(room: Room, keys: WayKey[], blockers: Box[]): number[];
export function connectedPairs(room: Room, keys: WayKey[], blockers: Box[]): number;
