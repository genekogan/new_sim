// The owner inbox poll (the Soul card's and the God box's): read now, then every 2 s. It pauses while the page is hidden
// and reads at once when it is shown again; an answer that started before a newer write (the caller's revision moved on)
// or after stop is dropped, so a stale in-flight read never overwrites a newer inbox.
export type PollDoc = {hidden: boolean; addEventListener(type: 'visibilitychange', fn: () => void): void; removeEventListener(type: 'visibilitychange', fn: () => void): void};
export type PollOptions = {doc?: PollDoc | null; everyMs?: number; schedule?(fn: () => void, ms: number): unknown; cancel?(handle: unknown): void};

export function pollInbox<T>(read: () => Promise<T>, apply: (value: T | null) => void, revision: () => number, opts: PollOptions = {}): () => void {
  const doc = opts.doc !== undefined ? opts.doc : typeof document === 'undefined' ? null : document as PollDoc;
  const every = opts.everyMs ?? 2000;
  const schedule = opts.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancel = opts.cancel ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let stopped = false, timer: unknown = null, inFlight = false;
  const tick = async () => {
    timer = null;
    if (stopped || doc?.hidden) return;  // paused: visibilitychange resumes
    inFlight = true;
    const at = revision();
    try {const value = await read(); if (!stopped && at === revision()) apply(value);}
    catch {if (!stopped && at === revision()) apply(null);}
    inFlight = false;
    if (!stopped && !doc?.hidden && timer == null) timer = schedule(() => void tick(), every);
  };
  const shown = () => {if (!stopped && !doc?.hidden && !inFlight && timer == null) void tick();};
  doc?.addEventListener('visibilitychange', shown);
  void tick();
  return () => {stopped = true; if (timer != null) cancel(timer); timer = null; doc?.removeEventListener('visibilitychange', shown);};
}
