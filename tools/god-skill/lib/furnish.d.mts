// Types for furnish.mjs (L2's furnish recipes), so the server's query.ts typechecks.
export interface FurnishResult { ops: unknown[]; placed: unknown[]; dropped: unknown[]; notes: string[] }
export function furnishBatch(model: unknown, buildingId: string, style?: string, opts?: { rooms?: string[] }): FurnishResult;
