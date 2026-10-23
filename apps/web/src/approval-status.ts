/** Keep a handed-off approval page current without starting another world or relying on another tab's lifetime. */
export function watchApproval<T extends { status: string }>(read: () => Promise<T>, changed: (value: T) => void,
  failed: (error: Error) => void, delay = 4000): () => void {
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  async function check() {
    let again = true;
    try {
      const value = await read();
      if (stopped) return;
      changed(value);
      again = value.status === 'pending' || value.status === 'creating';
    } catch (error) { if (!stopped) failed(error instanceof Error ? error : new Error(String(error))); }
    if (!stopped && again) timer = setTimeout(() => void check(), delay);
  }
  void check();
  return () => { stopped = true; clearTimeout(timer); };
}
