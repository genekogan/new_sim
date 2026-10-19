// Types for the server's tests (apps/server/src/god/mirror.test.ts); the CLI itself is plain JS.
export type Mirror = { world: string; seq: number; buildsRev: number; guard?: string; libraryHash?: string; rows: any[]; snapshot: any; h?: unknown };
export const CACHE: string;
export function mirrorHash(s: string): string;
export function applyMirror(base: Mirror | null, payload: unknown, world: string): Mirror | null;
export function mirrorState(world?: string): { since: number; builds: number; have: string; lib: string } | null;
