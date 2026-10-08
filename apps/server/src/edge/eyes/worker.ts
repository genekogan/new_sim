// Eyes (M3): the server side of the ONE long-lived render worker. The worker is a child process
// (render-worker.mjs) holding one headless Chromium page with the viewer in eyes mode; requests are queued here and
// sent one at a time. Never one browser per request. If the worker is down, render() refuses at once and the route
// answers 503 with the caption only.
import {fork, type ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export type RenderJob = {mode: 'eyes' | 'map'; w: number; h: number; quality: number; pose: {p: [number, number, number]; yaw: number; pitch: number; vfov: number}; self: string; show: string[]; span?: number};
export type RenderResult = {jpeg: Buffer; ms: number; queueMs: number; frameTick: number | null};
export type RendererStatus = {state: 'off' | 'starting' | 'ready' | 'down'; renderer: string | null; detail: string | null; queue: number; renders: number; failures: number;
  latencyMs: {p50: number | null; p95: number | null; last: number | null}; since: string | null};
export interface EyesRenderer {status(): RendererStatus; render(job: RenderJob): Promise<RenderResult>; close(): void}
export class EyesUnavailable extends Error {readonly reason: string; constructor(reason: string) {super(reason); this.reason = reason;}}

type Pending = {id: number; job: RenderJob; resolve(r: RenderResult): void; reject(e: Error): void; queuedAt: number; timer?: NodeJS.Timeout};
const WORKER = fileURLToPath(new URL('./render-worker.mjs', import.meta.url));

/** Renderer that is simply absent (EDGE_EYES unset): captions still work. */
export const NO_RENDERER: EyesRenderer = {
  status: () => ({state: 'off', renderer: null, detail: 'eyes render worker not configured on this server (EDGE_EYES unset)', queue: 0, renders: 0, failures: 0, latencyMs: {p50: null, p95: null, last: null}, since: null}),
  render: () => Promise.reject(new EyesUnavailable('no render worker on this server')),
  close: () => {},
};

export class EyesWorker implements EyesRenderer {
  private child: ChildProcess | null = null;
  private state: RendererStatus['state'] = 'starting';
  private renderer: string | null = null; private detail: string | null = null; private since: string | null = null;
  private queue: Pending[] = []; private inflight: Pending | null = null; private seq = 0;
  private renders = 0; private failures = 0; private recent: number[] = [];
  private closed = false; private backoffMs = 5000; private restartTimer: NodeJS.Timeout | null = null;
  private readonly opts: {viewerUrl: string; env?: Record<string, string | undefined>; timeoutMs?: number; maxQueue?: number; script?: string};
  constructor(opts: EyesWorker['opts']) {this.opts = opts; this.spawn();}

  private spawn() {
    if (this.closed) return;
    this.state = 'starting'; this.detail = 'launching headless browser';
    const child = fork(this.opts.script ?? WORKER, [], {env: {...process.env, ...this.opts.env, EDGE_EYES_URL: this.opts.viewerUrl}, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'advanced'});
    this.child = child;
    child.stderr?.on('data', d => {const line = String(d).trim(); if (line) console.error('[eyes-worker]', line.slice(0, 400));});
    child.on('message', (msg: {t: string; [k: string]: unknown}) => {
      if (msg.t === 'status') {
        this.state = msg.ready ? 'ready' : 'starting'; this.renderer = (msg.renderer as string) ?? this.renderer; this.detail = (msg.detail as string) ?? null;
        if (msg.ready) {this.since ??= new Date().toISOString(); this.backoffMs = 5000; this.pump();}
      } else if (msg.t === 'result') {
        const p = this.inflight; if (!p || p.id !== msg.id) return;
        this.inflight = null; if (p.timer) clearTimeout(p.timer);
        if (msg.ok) {
          const ms = Number(msg.ms); this.renders++; this.recent.push(ms); if (this.recent.length > 200) this.recent.shift();
          p.resolve({jpeg: Buffer.from(msg.jpeg as Uint8Array), ms, queueMs: Date.now() - p.queuedAt - ms, frameTick: typeof msg.frameTick === 'number' ? msg.frameTick : null});
        } else {this.failures++; p.reject(new EyesUnavailable(String(msg.error ?? 'render failed')));}
        this.pump();
      }
    });
    child.on('exit', code => {
      if (this.child !== child) return;
      this.child = null; this.state = this.closed ? 'off' : 'down'; this.since = null; this.detail = `worker exited (${code ?? 'signal'})`;
      const lost = [this.inflight, ...this.queue].filter(Boolean) as Pending[]; this.inflight = null; this.queue = [];
      for (const p of lost) {if (p.timer) clearTimeout(p.timer); p.reject(new EyesUnavailable('render worker restarted'));}
      if (!this.closed) {this.restartTimer = setTimeout(() => this.spawn(), this.backoffMs); this.backoffMs = Math.min(120_000, this.backoffMs * 2);}
    });
  }
  private pump() {
    if (this.inflight || this.state !== 'ready' || !this.child) return;
    const p = this.queue.shift(); if (!p) return;
    this.inflight = p;
    p.timer = setTimeout(() => {if (this.inflight === p) {this.inflight = null; this.failures++; p.reject(new EyesUnavailable('render timed out')); this.child?.kill('SIGKILL');}}, this.opts.timeoutMs ?? 90_000);
    this.child.send({t: 'render', id: p.id, job: p.job});
  }
  status(): RendererStatus {
    const s = [...this.recent].sort((a, b) => a - b), q = (f: number) => s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(f * s.length))]) : null;
    return {state: this.state, renderer: this.renderer, detail: this.detail, queue: this.queue.length + (this.inflight ? 1 : 0), renders: this.renders, failures: this.failures,
      latencyMs: {p50: q(0.5), p95: q(0.95), last: this.recent.length ? Math.round(this.recent.at(-1)!) : null}, since: this.since};
  }
  render(job: RenderJob): Promise<RenderResult> {
    if (this.state !== 'ready') return Promise.reject(new EyesUnavailable(`render worker is ${this.state}${this.detail ? ': ' + this.detail : ''}`));
    if (this.queue.length >= (this.opts.maxQueue ?? 6)) return Promise.reject(new EyesUnavailable('render queue is full'));
    return new Promise((resolve, reject) => {this.queue.push({id: ++this.seq, job, resolve, reject, queuedAt: Date.now()}); this.pump();});
  }
  close() {
    this.closed = true; if (this.restartTimer) clearTimeout(this.restartTimer);
    const c = this.child; this.child = null; this.state = 'off';
    for (const p of [this.inflight, ...this.queue].filter(Boolean) as Pending[]) {if (p.timer) clearTimeout(p.timer); p.reject(new EyesUnavailable('server closing'));}
    this.inflight = null; this.queue = [];
    if (c) {try {c.send({t: 'close'});} catch {/* gone */} setTimeout(() => {try {c.kill('SIGKILL');} catch {/* gone */}}, 5000).unref();}
  }
}
