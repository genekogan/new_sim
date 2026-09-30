// Async advisory coordination. Inject time at boundary; render loop never awaits.
import type { DirectorProvider, Request, Reply } from './types.ts';
export class Advisory {
  provider: DirectorProvider;
  timeoutMs: number;
  controller?: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  busy = false;
  disposed = false;
  lastRequest = -Infinity;
  fingerprint = '';
  accepted = 0;
  calls = 0;
  failures = 0;
  accounting: Reply[] = [];
  constructor(provider: DirectorProvider, timeoutMs = 1500) {
    this.provider = provider;
    this.timeoutMs = timeoutMs;
  }
  ask(
    request: Request,
    nowMs: number,
    apply: (reply: Reply, request: Request) => void,
  ): boolean {
    const fingerprint = JSON.stringify([
      request.session,
      request.version,
      request.epoch,
      request.current,
    ]);
    if (
      this.disposed ||
      this.busy ||
      nowMs - this.lastRequest < 1000 ||
      this.fingerprint === fingerprint
    )
      return false;
    this.lastRequest = nowMs;
    this.fingerprint = fingerprint;
    this.busy = true;
    this.calls++;
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => {
      controller.abort();
      this.failures++;
    }, this.timeoutMs);
    this.timer = timer;
    // Abort asks transport to settle. Keep busy until it actually does, even if a
    // broken provider ignores abort; local camera continues and requests cannot pile up.
    this.provider
      .choose(structuredClone(request), controller.signal)
      .then((reply) => {
        this.accounting.push(reply);
        if (!this.disposed && !controller.signal.aborted) {
          apply(reply, request);
          this.accepted++;
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) this.failures++;
      })
      .finally(() => {
        clearTimeout(timer);
        if (this.timer === timer) this.timer = undefined;
        if (this.controller === controller) this.controller = undefined;
        this.busy = false;
      });
    return true;
  }
  dispose() {
    this.disposed = true;
    this.controller?.abort();
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
