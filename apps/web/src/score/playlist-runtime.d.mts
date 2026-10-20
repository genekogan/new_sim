// Types for the generated playlist-runtime.mjs (tools/score/import-playlist.mjs): only what gen-mesh/music.ts uses.
export type ScorePiece = { id: string; title: string; genre?: string; bpm: number };
export interface ScoreConductor {
  play(piece: ScorePiece, opts?: { seed?: number }): Promise<void>;
  stop(): void;
  out?: { gain: { rampTo(value: number, seconds: number): void } } | null;
  piece: ScorePiece | null;
}
export interface ScoreNamespace {
  pieces: ScorePiece[];
  Conductor: new (hooks?: object) => ScoreConductor;
}
export const PLAYLIST: readonly string[];
export function createPlaylistScore(Tone: unknown): ScoreNamespace;
