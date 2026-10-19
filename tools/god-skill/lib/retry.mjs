// Back off instead of hammering (lane P2): a 429, or a 503 that says when to come back, is waited out for any request (the
// world refused it before doing anything: a rate limit, a world starting or closing). A 502/504 or a lost connection is retried only for a GET/HEAD,
// or when the connection was refused outright (nothing was sent), so an edit is never sent twice behind its caller's back
// (the act's clientRef recovery stays with the caller). Waits honour the server's hint (retryAfterMs, retry_after,
// Retry-After) plus up to 20% jitter, else grow exponentially with jitter (0.25-0.5 s, 0.5-1 s, 1-2 s, 2-4 s); at most 4
// retries and 60 s of waiting, then the last answer (or error) goes back to the caller, who prints it.
// `options.timeoutMs` gives every attempt its own AbortSignal.timeout (one signal shared across retries would
// abort a retry as soon as the first attempt's time ran out) and sets an absolute deadline of first send +
// timeoutMs: a wait that would not end before that deadline returns the answer as-is rather than sleeping past it.
// `options.deadlineAt` (an absolute wall-clock end, e.g. the look's one deadline) caps every attempt and wait too;
// `options.signal` (the caller's cancellation) aborts any attempt and any wait.
export const RETRY_LIMITS = Object.freeze({ retries: 4, waitMs: 60_000 });
const idempotent = (method) => !method || method === 'GET' || method === 'HEAD';
const refused = (e) => [e?.code, e?.cause?.code, ...(e?.cause?.errors ?? []).map((x) => x?.code)].includes('ECONNREFUSED');
/** Defaults for every call's runtime ({ sleep, random, now }): tests replace the clock here, never the CLI. */
export const retryDefaults = {};
export async function fetchWithRetry(url, options, runtime = {}, budget = { waited: 0, retries: 0 }) {
  runtime = { ...retryDefaults, ...runtime };
  const send = runtime.fetch ?? fetch, clock = runtime.now ?? Date.now, random = runtime.random ?? Math.random;
  const { timeoutMs, deadlineAt, signal, ...init } = options ?? {};
  const wait = runtime.sleep ?? (ms => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const done = () => { signal?.removeEventListener('abort', stop); resolve(); };
    const timer = setTimeout(done, ms);
    function stop() { clearTimeout(timer); reject(signal.reason); }
    signal?.addEventListener('abort', stop, { once: true });
  }));
  const plain = timeoutMs === undefined && deadlineAt === undefined && signal === undefined;
  const deadline = Math.min(timeoutMs === undefined ? Infinity : clock() + timeoutMs, deadlineAt ?? Infinity);
  const backoff = () => { const cap = 500 * 2 ** budget.retries; return cap / 2 + random() * cap / 2; };
  const room = (delay) => budget.retries < RETRY_LIMITS.retries && budget.waited + delay <= RETRY_LIMITS.waitMs && clock() + delay < deadline;
  const pause = async (delay) => { budget.waited += delay; budget.retries++; await wait(delay); };
  for (;;) {
    signal?.throwIfAborted();
    const attemptMs = Math.min(timeoutMs ?? Infinity, deadlineAt === undefined ? Infinity : deadlineAt - clock());
    const signals = [...(Number.isFinite(attemptMs) ? [AbortSignal.timeout(Math.max(1, attemptMs))] : []), ...(signal ? [signal] : [])];
    let response;
    try { response = await send(url, plain ? options : { ...init, ...(signals.length ? { signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals) } : {}) }); }
    catch (e) {
      // a timeout or the caller's cancellation is the caller's to handle; a lost connection is retried only when safe
      if (signal?.aborted || /abort|timeout/i.test(`${e?.name} ${e?.message}`) || !(idempotent(init.method) || refused(e))) throw e;
      const delay = backoff(); if (!room(delay)) throw e;
      await pause(delay); continue;
    }
    const status = response.status;
    if (!(status === 429 || status === 503 || ((status === 502 || status === 504) && idempotent(init.method)))) return response;
    const data = await response.clone().json().catch(() => ({}));
    const header = response.headers.get('retry-after'), now = clock();
    const numeric = header === null ? NaN : Number(header);
    const hints = [data?.retryAfterMs, data?.retry_after == null ? NaN : Number(data.retry_after) * 1000,
      Number.isFinite(numeric) ? numeric * 1000 : header ? Date.parse(header) - now : NaN]
      .filter(v => v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0).map(Number);
    const hint = hints.length ? Math.max(...hints) : null;
    if (status === 503 && hint === null) return response;   // a 503 without "come back after" is not temporary (look.unavailable)
    const delay = Math.max(1, Math.round(hint === null ? backoff() : hint * (1 + 0.2 * random())));
    if (!room(delay)) return response;
    await response.body?.cancel();
    await pause(delay);
  }
}
