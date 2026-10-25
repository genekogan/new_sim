// asset-fetch.ts: GLB bytes from a worker reach the caller whole, the byte bar sees start/headers/progress/done, a
// failed fetch rejects, and a worker that cannot run rejects pending loads as `unavailable` (callers fall back).
import test from 'node:test';
import assert from 'node:assert/strict';

type Msg = { id: number; url: string };
class FakeWorker {
  static mode: 'ok' | 'http' | 'broken' = 'ok';
  onmessage: ((ev: { data: unknown }) => void) | null = null; onerror: (() => void) | null = null;
  terminate() {}
  postMessage(m: Msg) {
    setTimeout(() => {
      if (FakeWorker.mode === 'broken') { this.onerror?.(); return; }
      if (FakeWorker.mode === 'http') { this.onmessage?.({ data: { id: m.id, error: 'HTTP 404', status: 404 } }); return; }
      const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
      this.onmessage?.({ data: { id: m.id, total: 7 } });
      this.onmessage?.({ data: { id: m.id, loaded: 3 } });
      this.onmessage?.({ data: { id: m.id, loaded: 7, buffer: bytes.buffer } });
    }, 1);
  }
}
(globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;

test('worker download: bytes, byte-bar rows, HTTP failure, unavailable worker', async () => {
  const { fetchInWorker } = await import('./asset-fetch.ts');
  const { assetBytes } = await import('../asset-bytes.ts');
  const buf = await fetchInWorker('/w/x/assets/aa.glb')!;
  assert.deepEqual([...new Uint8Array(buf)], [1, 2, 3, 4, 5, 6, 7]);
  await new Promise((r) => setTimeout(r, 150));   // the meter publishes at most every 100 ms
  const snap = assetBytes.snapshot(); assert.equal(snap.loaded, 7); assert.equal(snap.total, 7);
  FakeWorker.mode = 'http';
  await assert.rejects(fetchInWorker('/w/x/assets/bb.glb')!, (e: Error & { status?: number; unavailable?: boolean }) => e.status === 404 && !e.unavailable);
  FakeWorker.mode = 'broken';
  await assert.rejects(fetchInWorker('/w/x/assets/cc.glb')!, (e: Error & { unavailable?: boolean }) => e.unavailable === true);
  assert.equal(fetchInWorker('/w/x/assets/dd.glb'), null);   // after a broken worker: FileLoader from now on
});
