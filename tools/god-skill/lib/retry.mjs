// Retry only explicit 429 refusals. Transport failures retain each caller's recovery policy.
// `options.timeoutMs` gives every attempt its own AbortSignal.timeout (one signal shared across retries would
// abort a retry as soon as the first attempt's time ran out) and sets an absolute deadline of first send +
// timeoutMs: a 429 whose wait would not end before that deadline is returned as-is rather than slept past.
// `options.deadlineAt` (an absolute wall-clock end, e.g. the look's one deadline) caps every attempt and wait too;
// `options.signal` (the caller's cancellation) aborts any attempt and any 429 wait.
export async function fetchWithRetry(url, options, runtime = {}, budget = { waited: 0, retries: 0 }) {
  const send = runtime.fetch ?? fetch, clock = runtime.now ?? Date.now;
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
  for (;;) {
    signal?.throwIfAborted();
    const attemptMs = Math.min(timeoutMs ?? Infinity, deadlineAt === undefined ? Infinity : deadlineAt - clock());
    const signals = [...(Number.isFinite(attemptMs) ? [AbortSignal.timeout(Math.max(1, attemptMs))] : []), ...(signal ? [signal] : [])];
    const response = await send(url, plain ? options : { ...init, ...(signals.length ? { signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals) } : {}) });
    if (response.status !== 429 || budget.retries >= 4) return response;
    const data = await response.clone().json().catch(() => ({}));
    const header = response.headers.get('retry-after'), now = clock();
    const numeric = header === null ? NaN : Number(header);
    const delays = [data.retryAfterMs, data.retry_after == null ? NaN : Number(data.retry_after) * 1000,
      Number.isFinite(numeric) ? numeric * 1000 : header ? Date.parse(header) - now : NaN]
      .filter(v => v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0).map(Number);
    const delay = Math.max(1, delays.length ? Math.max(...delays) : 250 * 2 ** budget.retries);
    if (budget.waited + delay > 60_000 || now + delay >= deadline) return response;
    await response.body?.cancel();
    budget.waited += delay; budget.retries++;
    await wait(delay);
  }
}
