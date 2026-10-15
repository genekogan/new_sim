// Minimal null-delimited CDP pipe transport. No Playwright, downloads, debug listener or persistent profile.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { ApiError } from '../souls.ts';
import type { Look } from './look.ts';
import { preserveScript, readyExpression, captureExpression } from './look-page.ts';

const unavailable = () => new ApiError(503, 'look.unavailable', 'Cannot start the world renderer. Install Google Chrome on the world host (or set GOD_LOOK_CHROME to its executable) and allow it to run headless.');
/** Validate the PNG header, but report the canvas's actual size instead of refusing a useful picture. */
export function pngSize(bytes: Uint8Array) {
  const png = Buffer.from(bytes);
  if (png.length < 33 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    png.readUInt32BE(8) !== 13 || png.toString('ascii', 12, 16) !== 'IHDR' || !png.readUInt32BE(16) || !png.readUInt32BE(20)) {
    throw new ApiError(503, 'look.failed', 'World screenshot failed: canvas did not return a valid PNG. Retry the look; check the host viewer if it persists.');
  }
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
}
export function chromeExecutable() {
  if (process.env.GOD_LOOK_CHROME) return existsSync(process.env.GOD_LOOK_CHROME) ? process.env.GOD_LOOK_CHROME : null;
  return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync) ?? null;
}

export class PipeCDP {
  private id = 0;
  private buffer = Buffer.alloc(0);
  private pending = new Map<number, { resolve(value: any): void; reject(e: Error): void }>();
  private ended: Error | undefined;
  private input: Writable;
  onEvent: (method: string, params: any, sessionId?: string) => void = () => {};
  constructor(input: Writable, output: Readable) {
    this.input = input;
    output.on('data', (b: Buffer) => {
      if (this.ended) return;
      this.buffer = Buffer.concat([this.buffer, b]);
      if (this.buffer.length > 32 * 1024 * 1024) { this.close(new Error('Chrome response exceeds render limit')); return; }
      for (;;) {
        const end = this.buffer.indexOf(0); if (end < 0) break;
        const frame = this.buffer.subarray(0, end).toString(); this.buffer = this.buffer.subarray(end + 1);
        if (!frame) continue;
        let message; try { message = JSON.parse(frame); } catch { this.close(new Error('Invalid Chrome response')); return; }
        const p = this.pending.get(message.id);
        if (p) { this.pending.delete(message.id); if (message.error) p.reject(new Error(message.error.message)); else p.resolve(message.result); }
        else if (message.method) this.onEvent(message.method, message.params, message.sessionId);
      }
    });
    output.on('end', () => this.close(new Error('Chrome closed the render pipe')));
    output.on('error', e => this.close(e)); input.on('error', e => this.close(e));
  }
  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    if (this.ended) return Promise.reject(this.ended);
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.input.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0', e => { if (e) { this.pending.delete(id); reject(e); } });
    });
  }
  close(error = new Error('Renderer closed')) { this.ended = error; this.buffer = Buffer.alloc(0); for (const p of this.pending.values()) p.reject(error); this.pending.clear(); }
}

async function stopChrome(child: ChildProcess) {
  const kill = (signal: NodeJS.Signals) => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* exited */ } };
  kill('SIGTERM');
  if (child.exitCode === null && child.signalCode === null) await new Promise<void>(resolve => {
    const timer = setTimeout(() => { kill('SIGKILL'); resolve(); }, 1500);
    child.once('close', () => { clearTimeout(timer); resolve(); });
  });
  kill('SIGKILL'); // Dispose remaining helpers even if the browser parent closed first.
}

export async function renderLook(worldUrl: string, shot: Look, expect: number, signal: AbortSignal): Promise<Uint8Array> {
  // This is server configuration, never Host/X-Forwarded-Host or a request field.
  const url = new URL(worldUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash) throw new ApiError(503, 'look.unavailable', 'Configure a 127.0.0.1 HTTP URL for the world renderer');
  const executable = chromeExecutable(); if (!executable) throw unavailable();
  signal.throwIfAborted();
  const profile = mkdtempSync(join(tmpdir(), 'sim-god-look-'));
  const child = spawn(executable, [
    '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
    '--disable-extensions', '--disable-sync', '--metrics-recording-only', '--password-store=basic', '--use-mock-keychain',
    '--disable-dev-shm-usage', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    '--ignore-gpu-blocklist', ...(process.env.EDEN_GOD_GL === 'swiftshader' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []),
    'about:blank',
  ], { detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const cdp = new PipeCDP(child.stdio[3] as Writable, child.stdio[4] as Readable);
  child.once('error', () => cdp.close(unavailable())); child.once('exit', () => cdp.close(new Error('Chrome exited')));
  const abort = () => { cdp.close(signal.reason); child.kill('SIGTERM'); };
  signal.addEventListener('abort', abort, { once: true });
  let started = false;
  try {
    await cdp.send('Browser.getVersion'); started = true;
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method: string, params: object = {}) => cdp.send(method, params, sessionId);
    const evaluate = async (expression: string) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    // Do not let a renderer follow external redirects or load remote resources from a world asset.
    cdp.onEvent = (method, params, session) => {
      if (method !== 'Fetch.requestPaused' || session !== sessionId) return;
      const allowed = new URL(params.request.url).origin === url.origin;
      void send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: params.requestId, ...(!allowed ? { errorReason: 'BlockedByClient' } : {}) }).catch(() => {});
    };
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: shot.width, height: shot.height, deviceScaleFactor: 1, mobile: false });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: preserveScript });
    const q = new URLSearchParams({ shot: '1', eye: shot.eye.join(','), at: shot.at.join(','), settle: '1500',
      ...(shot.hideRoofs ? { hideRoofs: '1', ...(shot.cut !== null ? { cut: String(shot.cut) } : {}) } : {}),
      ...(shot.hour !== undefined ? { hour: shot.hour } : {}), ...(shot.weather !== undefined ? { weather: shot.weather } : {}),
    });
    await send('Page.navigate', { url: `${url.href}?${q}` });
    let stable = 0, lastDrawn = -1;
    while (stable < 2) {
      signal.throwIfAborted();
      // Navigation can replace the about:blank execution context between two commands.
      const state = await evaluate(readyExpression(expect)).catch((e: Error) => ({ ready: false, why: e.message }));
      if (state.why === 'no entity world on this page') throw new Error(state.why);
      stable = state.ready && state.drawn === lastDrawn ? stable + 1 : 0; lastDrawn = state.drawn ?? -1;
      if (stable < 2) await evaluate('new Promise(r => setTimeout(r, 100))');
    }
    const data = await evaluate(captureExpression(shot));
    if (typeof data !== 'string' || !data.startsWith('data:image/png;base64,')) throw new Error('no PNG canvas on the page');
    const png = Buffer.from(data.split(',')[1], 'base64');
    pngSize(png);
    return png;
  } catch (e) {
    if (signal.aborted) throw signal.reason;
    if (!started) throw unavailable();
    if (e instanceof ApiError) throw e;
    throw new ApiError(503, 'look.failed', `World screenshot failed: ${String((e as Error).message).split('\n')[0].slice(0, 200)}. Retry the look; check the host viewer if it persists.`);
  } finally {
    signal.removeEventListener('abort', abort); cdp.close();
    await stopChrome(child); rmSync(profile, { recursive: true, force: true });
  }
}
