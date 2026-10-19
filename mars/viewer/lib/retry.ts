// Lane B1: a bounded retry with backoff for model downloads. A body or body part whose request failed once (a dropped
// connection on a phone) used to stay a stand-in figure for good; it is now asked for again after 2, 5 and 10 s. Only
// failures that may pass are retried: a network error (fetch rejects with a TypeError) or HTTP 408/429/5xx. A 404, a
// parse error or an abort fails at once, so a missing file still falls back (or shows the stand-in) without delay.
export const RETRY_DELAYS_MS: readonly number[] = [2000, 5000, 10000];

/** True when a load error may pass on a later try (network error or HTTP 408/429/5xx). */
export function transientLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ((error as {name?: unknown}).name === 'AbortError') return false;
  if (error instanceof TypeError) return true;
  const e = error as {status?: unknown; response?: {status?: unknown}};
  const status = typeof e.status === 'number' ? e.status : typeof e.response?.status === 'number' ? e.response.status : null;
  return status !== null && (status === 408 || status === 429 || status >= 500);
}

export type RetryOptions = {
  delays?: readonly number[];
  signal?: AbortSignal;
  retryable?: (error: unknown) => boolean;
  /** Test hook: how a delay is waited out. */
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason); return; }
  const done = () => { signal?.removeEventListener('abort', stop); resolve(); };
  const timer = setTimeout(done, ms);
  const stop = () => { clearTimeout(timer); reject(signal!.reason); };
  signal?.addEventListener('abort', stop, {once: true});
});

/** Run `attempt`; while it fails with a retryable error, wait the next delay and run it again (1 + delays.length tries). */
export async function withRetry<T>(attempt: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {delays = RETRY_DELAYS_MS, signal, retryable = transientLoadError, wait = sleep} = options;
  for (let i = 0; ; i++) {
    try { return await attempt(); } catch (error) {
      if (i >= delays.length || signal?.aborted || !retryable(error)) throw error;
      await wait(delays[i], signal);
      signal?.throwIfAborted();
    }
  }
}
