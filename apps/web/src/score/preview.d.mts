export type ScoreTone = { start(): Promise<unknown> };
export type PreviewState = { phase: 'idle' | 'gesture-required' | 'starting' | 'playing' | 'unavailable' | 'disposed'; nodeCount: number; ownsPlayback: boolean; muted: boolean; volume: number };
export type Preview = { start(options: {pieceId: string; seed: number; durationSeconds?: number}): Promise<{kind: string}>; stop(): void; snapshot(): PreviewState; setMuted(value: boolean): void; setVolume(value: number): void; dispose(): void };
export function createPreview(tone: ScoreTone, options?: {onState?: (state: PreviewState) => void}): Preview;
