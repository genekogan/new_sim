// Types for the generated playlist/engine.mjs (tools/score/build-playlist.mjs): only what gen-mesh/music.ts uses.
export type ScorePiece = { id: string; title: string; genre?: string; bpm: number };
export interface ScoreConductor {
  play(piece: ScorePiece, opts?: { seed?: number; cycle?: number }): Promise<void>;
  stop(): void;
  out?: { gain: { rampTo(value: number, seconds: number): void } } | null;
  piece: ScorePiece | null;
}
export interface ScoreNamespace {
  pieces: ScorePiece[];
  Conductor: new (hooks?: object) => ScoreConductor;
}
/** A piece's chunk: its default export registers the piece on the playlist's Sim. */
export type ScorePieceModule = { default(Sim: ScoreNamespace, Tone: unknown): void };
export const PLAYLIST: readonly string[];
export function loadPiece(id: string): Promise<ScorePieceModule>;
export function createPlaylistScore(Tone: unknown): ScoreNamespace;
