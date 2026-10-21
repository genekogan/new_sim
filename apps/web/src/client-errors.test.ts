// Lane ERR: the page's error beacon reports each kind once (repeats as a count), caps a flood, sends no personal text.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

type Beacon = { b: string; w?: string; e: { k: string; m: string; s: string; n: number }[] };
const beacons: Beacon[] = [];
const win = new EventTarget(), doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
class FakeErrorEvent extends Event { message: string; filename: string; error: unknown; constructor(m: string, f = '', error?: unknown) { super('error'); this.message = m; this.filename = f; this.error = error; } }
class FakeRejection extends Event { reason: unknown; constructor(reason: unknown) { super('unhandledrejection'); this.reason = reason; } }
const g = globalThis as unknown as Record<string, unknown>;
Object.assign(g, { window: g, ErrorEvent: FakeErrorEvent, document: doc, __BUILD__: 'we-test12345678', location: { pathname: '/worlds/w/eden-2026/', search: '' },
  addEventListener: win.addEventListener.bind(win) });
Object.defineProperty(g, 'navigator', { configurable: true, value: { sendBeacon: (url: string, data: string) => { assert.equal(url, '/__sim/client-errors'); beacons.push(JSON.parse(data)); return true; } } });

test('one report per kind with its count, a cap per page, no personal text, sockets, WebGL and arrival', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { watchSocket, report } = await import('./client-errors.ts');
  // 10k throws of one error from one page: one event, its count
  for (let i = 0; i < 10_000; i++) win.dispatchEvent(new FakeErrorEvent('Error: injected test throw', 'https://sim.eden.art/worlds/assets/LiveWorld-Ab12_xYz.js?v=1'));
  mock.timers.tick(3000);
  assert.equal(beacons.length, 1);
  assert.deepEqual(beacons[0], { b: 'we-test12345678', w: 'eden-2026', e: [{ k: 'js', m: 'Error: injected test throw', s: 'LiveWorld', n: 10_000 }] });
  // personal text never leaves the page
  win.dispatchEvent(new FakeRejection(new Error('said "meet me at the well" to gene@example.com with user_2pQ7xYzAbCdEfGhIjKlMnOp at /v1/x?token=abc')));
  win.dispatchEvent(new FakeRejection({ message: 'Kwyjibo is asleep' }));
  // WebGL: a live canvas losing its context counts, a canvas being torn down does not
  const canvas = Object.assign(new EventTarget(), { isConnected: true }), gone = Object.assign(new EventTarget(), { isConnected: false });
  const lost = (t: EventTarget) => { win.dispatchEvent(Object.defineProperty(new Event('webglcontextlost'), 'target', { value: t })); };
  lost(canvas); lost(gone);
  // sockets: an abnormal close counts, a normal one does not, six connects in a minute are a storm
  const sock = () => watchSocket(new EventTarget() as unknown as WebSocket) as unknown as EventTarget;
  const close = (s: EventTarget, code: number) => s.dispatchEvent(Object.assign(new Event('close'), { code }));
  const first = sock(); close(first, 1006); close(sock(), 1000); close(sock(), 1005); sock(); sock(); sock();
  // a failed asset reports its path without the query string
  report('asset', '404', 'https://sim.eden.art/worlds/w/eden-2026/assets/missing.glb?x=1');
  mock.timers.tick(3000);
  const e = beacons[1]!.e;
  const rej = e.filter((x) => x.k === 'rej');
  assert.equal(rej.length, 2);
  assert.ok(!JSON.stringify(rej).match(/meet me|gene@example|user_2pQ7|token=|Kwyjibo/), JSON.stringify(rej));
  assert.equal(rej[1]!.m, 'object', 'a rejection that is no Error sends only its type');
  assert.deepEqual(e.filter((x) => x.k === 'gl').map((x) => x.n), [1]);
  assert.deepEqual(e.filter((x) => x.k === 'ws').map((x) => x.m), ['close 1006']);
  assert.equal(e.filter((x) => x.k === 'storm').length, 1);
  assert.deepEqual(e.find((x) => x.k === 'asset'), { k: 'asset', m: '404', s: 'https://sim.eden.art/worlds/w/eden-2026/assets/missing.glb', n: 1 });
  // an arrival that never finished: reported once after 60 s with the last arrival mark it reached
  performance.mark('sim:ws-welcome');
  mock.timers.tick(54_000); mock.timers.tick(3000);   // 60 s after the page started (two 3 s flushes so far), then its flush
  assert.deepEqual(beacons.at(-1)!.e, [{ k: 'arrival', m: 'not done in 60 s', s: 'ws-welcome', n: 1 }]);
  // the cap: at most 12 kinds per page however many distinct errors it throws
  for (let i = 0; i < 50; i++) report('js', `distinct ${'abcdefghijklmnopqrstuvwxyz'[i % 26]}${i >= 26 ? 'z' : ''}`);
  mock.timers.tick(3000);
  const kinds = beacons.flatMap((x) => x.e).length;
  assert.equal(kinds, 12);
  // hidden: the repeats of an already-sent kind go out as one more count
  win.dispatchEvent(new FakeErrorEvent('Error: injected test throw', 'LiveWorld-Ab12_xYz.js'));
  doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(beacons.at(-1)!.e, [{ k: 'js', m: 'Error: injected test throw', s: 'LiveWorld', n: 1 }]);
  mock.timers.reset();
});
