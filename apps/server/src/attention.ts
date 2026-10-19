// Attention (lane P3, tranche 2026-10-19): is anyone here? A world nobody watches and nobody acts in runs its clock at a
// slower wall pace (WorldHost.setPace): the same ticks in the same order, fewer per wall second, so an unwatched world
// costs a fraction of the CPU. Anyone arriving puts it back to full pace at once.
//
// Watched = any open WebSocket (viewers on /ws, Souls' event streams), any HTTP request in flight (a god's `listen`
// long-poll, a Soul's call), or any request in the last `graceMs`. Passive reads that only report on the world (its
// health and the homepage's numbers, asked by the launcher without a token) do not count.
import type { IncomingMessage, Server } from 'node:http';

const PASSIVE = /\/(?:healthz|v1\/god\/status|v1\/world\/souls)\/?$/;
/** A request that only reports on the world: health, and the homepage's numbers asked without a token. */
export const passiveRequest = (req: Pick<IncomingMessage, 'url' | 'headers'>) =>
  !req.headers.authorization && PASSIVE.test((req.url ?? '').split('?')[0]);

/** Pace for an unwatched world: SIM_UNWATCHED_PACE (0 < pace <= 1; 1 turns the slowdown off), default 0.25 (5 ticks/s). */
export function unwatchedPace(env: Record<string, string | undefined> = process.env): number {
  const v = Number(env.SIM_UNWATCHED_PACE ?? 0.25);
  return v > 0 && v <= 1 ? v : 0.25;
}

export class Attention {
  open = 0;
  inflight = 0;
  lastActive: number;
  watched = true;
  readonly graceMs: number;
  private onChange: (watched: boolean) => void;
  private now: () => number;
  private timer: NodeJS.Timeout | null = null;
  constructor(onChange: (watched: boolean) => void, graceMs = 30_000, now: () => number = Date.now) {
    this.onChange = onChange; this.graceMs = graceMs; this.now = now;
    this.lastActive = now();
  }
  /** Count this server's WebSockets and requests. */
  watch(server: Server, everyMs = 5_000) {
    server.on('upgrade', (_req: IncomingMessage, socket) => {
      this.open++; this.touch();
      let gone = false; const left = () => { if (gone) return; gone = true; this.open--; this.lastActive = this.now(); };
      socket.once('close', left);
    });
    server.on('request', (req: IncomingMessage, res) => {
      if (passiveRequest(req)) return;
      this.inflight++; this.touch();
      let done = false; res.once('close', () => { if (done) return; done = true; this.inflight--; this.lastActive = this.now(); });
    });
    this.timer = setInterval(() => this.check(), everyMs); this.timer.unref();
    return this;
  }
  /** Someone is here now. */
  touch() { this.lastActive = this.now(); if (!this.watched) { this.watched = true; this.onChange(true); } }
  /** Nobody connected, nothing in flight, nothing for `graceMs`: unwatched. */
  check() {
    const w = this.open > 0 || this.inflight > 0 || this.now() - this.lastActive < this.graceMs;
    if (w !== this.watched) { this.watched = w; this.onChange(w); }
    return w;
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
