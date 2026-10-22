// Types for sync-sim-score.mjs: what score/playlist.test.ts uses.
export const VENDOR: string;
export function checkVendored(): { prov: { source: { commit: string }; files: { path: string; sha256: string; bytes: number }[] }; problems: string[] };
