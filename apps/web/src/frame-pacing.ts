/** VF1b: when the renderer is slow (software WebGL, an old laptop, the first frames compiling shaders), back-to-back
 * animation frames starve the page's other work: socket messages queue up, the browser stops reading the socket,
 * the server's ping sweep gets no answer and drops the connection ("Reconnecting"). After a slow frame, leave a
 * short gap for queued tasks before asking for the next frame. Fast machines (frames under SLOW_MS) are unchanged. */
export const SLOW_MS = 120, YIELD_MS = 30;
export class FramePacer {
  private last = -Infinity;
  /** Schedule `cb` for the next frame; call at the top of the frame callback. Returns a rAF id or a timer id. */
  next(cb: FrameRequestCallback, now = performance.now()): number {
    const gap = now - this.last; this.last = now;
    if (gap > SLOW_MS && Number.isFinite(gap)) return setTimeout(() => requestAnimationFrame(cb), YIELD_MS) as unknown as number;
    return requestAnimationFrame(cb);
  }
}
