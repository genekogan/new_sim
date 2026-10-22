// Types for build-playlist.mjs: what score/playlist.test.ts uses.
export const OUT: string;
export const PLAYLIST: string[];
export const ENGINE: string[];
export function buildPlaylist(o?: { write?: boolean; log?: (line: string) => void }): { files: Map<string, string>; commit: string; left: string[] };
