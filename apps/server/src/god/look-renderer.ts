// Minimal null-delimited CDP pipe transport. No Playwright, downloads, debug listener or persistent profile.
import {monitorEventLoopDelay} from 'node:perf_hooks';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, lstat, rm } from 'node:fs/promises';
import { tmpdir, setPriority } from 'node:os';
import {eyesBrowserLaunch,eyesNice} from '../edge/eyes/browser-config.mjs';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { ApiError } from '../souls.ts';
import type { Look } from './look.ts';
import { hostRenderSlot } from './host-render-slot.ts';
import { preserveScript, readyExpression, captureExpression } from './look-page.ts';
import { rendererWorldUrl } from './look-renderer-url.ts';

export const lookAdvice = "This world's host cannot render pictures; take the picture with a local browser (Google Chrome where your agent runs). Never change the world's clock or sky to see night.";
const unavailable = (reason: string) => new ApiError(503, 'look.unavailable', `${reason} ${lookAdvice}`);

/** Dead-owner profiles can be reclaimed across worlds without touching a live renderer.
 * Legacy profiles lack a pid, so retain them for a day (the render deadline is 60 s). */
export async function sweepLookProfiles(directory = tmpdir(), now = Date.now()) {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(entries.map(async entry => {
    const match = /^sim-god-look-(?:(\d+)-)?[a-zA-Z0-9]{6}$/.exec(entry.name);
    if (!match || !entry.isDirectory()) return;
    const path = join(directory, entry.name);
    try {
      if (match[1]) {
        try { process.kill(Number(match[1]), 0); return; }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') return; }
      } else if (now - (await lstat(path)).mtimeMs < 86_400_000) return;
      await rm(path, { recursive: true, force: true });
    } catch (e) { console.warn('[god.look] stale profile cleanup failed:', (e as NodeJS.ErrnoException).code); }
  }));
}
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

/** Short-lived captures share the installed Eyes runtime policy, never its persistent service. */
export function contextChromeLaunch(profile:string,env=process.env,platform=process.platform){
 if(platform==='linux'){const requested=env.EDEN_GOD_GL??env.EDGE_EYES_GPU??'swiftshader',mode=requested==='auto'?'swiftshader':requested;const policy=eyesBrowserLaunch(mode,env,platform,profile);return{args:policy.args,env:policy.env??env};}
 return{args:['--ignore-gpu-blocklist',...(env.EDEN_GOD_GL==='swiftshader'?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[])],env};
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
        else if (message.method) {
          try { this.onEvent(message.method, message.params, message.sessionId); }
          catch (e) { this.close(e instanceof Error ? e : new Error(String(e))); return; }
        }
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

/** Chrome's fresh, owned profile already opens about:blank. Reuse it when unambiguous;
 * a missing/changed initial page or failed attach falls back to an owned new page. */
export async function attachLookPage(cdp: Pick<PipeCDP, 'send'>): Promise<{ sessionId: string }> {
  try {
    const { targetInfos = [] } = await cdp.send('Target.getTargets');
    const pages = targetInfos.filter((t: { type: string }) => t.type === 'page');
    if (pages.length === 1 && pages[0].url === 'about:blank' && !pages[0].attached) {
      return await cdp.send('Target.attachToTarget', { targetId: pages[0].targetId, flatten: true });
    }
  } catch { /* The initial target may close before attach, or discovery may be unavailable. */ }
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  return cdp.send('Target.attachToTarget', { targetId, flatten: true });
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

export async function renderLook(worldUrl: string, shot: Look, expect: number, signal: AbortSignal, context?:unknown, contextResult?:(metadata:Record<string,unknown>)=>void): Promise<Uint8Array> {
 const release=await hostRenderSlot(signal);try{return await renderIsolated(worldUrl,shot,expect,signal,context,contextResult);}finally{release();}
}
async function renderIsolated(worldUrl:string,shot:Look,expect:number,signal:AbortSignal,context?:unknown,contextResult?:(metadata:Record<string,unknown>)=>void):Promise<Uint8Array>{
  // This is server configuration, never Host/X-Forwarded-Host or a request field.
  let url: URL;
  try { url = rendererWorldUrl(worldUrl, Boolean(context), process.env.SIM_SITE_URL); }
  catch (e) { throw unavailable((e as Error).message); }
  const executable = chromeExecutable(); if (!executable) throw unavailable('No Google Chrome executable was found on the world host.');
  signal.throwIfAborted();
  const profile = await mkdtemp(join(tmpdir(), `sim-god-look-${process.pid}-`));
  if (signal.aborted) { await rm(profile, { recursive: true, force: true }); throw signal.reason; }
  const policy=contextChromeLaunch(profile);
  const histogram=process.env.SIM_CONTEXT_TRACE==='1'?monitorEventLoopDelay({resolution:5}):null;histogram?.enable();let lastPhase=performance.now();
  const trace=(phase:string)=>{if(!histogram)return;const now=performance.now();console.info('[context-phase]',JSON.stringify({phase,at:Date.now(),ms:now-lastPhase,eventLoopMaxMs:histogram.max/1e6}));lastPhase=now;histogram.reset();};
  const child = spawn(executable, [
    '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
    '--disable-extensions', '--disable-sync', '--metrics-recording-only', '--password-store=basic', '--use-mock-keychain',
    '--disable-dev-shm-usage', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    ...policy.args,
    'about:blank',
  ], { env:policy.env, detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  if(child.pid)try{setPriority(child.pid,eyesNice());}catch{/* A host may disallow lowering priority. */}
  trace('spawned');
  const cdp = new PipeCDP(child.stdio[3] as Writable, child.stdio[4] as Readable);
  let startupFailed = false, disposing = false;
  child.once('error', (e: NodeJS.ErrnoException) => {
    console.error('[god.look] Chrome executable failed to start:', e.code);
    cdp.close(unavailable('The Google Chrome executable failed to start on the world host.'));
  });
  child.once('exit', (code, exitSignal) => {
    if ((!disposing || startupFailed) && !signal.aborted) console.error(`[god.look] Chrome exited: code=${code} signal=${exitSignal}`);
    cdp.close(new Error('Chrome executable exited'));
  });
  const abort = () => { cdp.close(signal.reason); child.kill('SIGTERM'); };
  signal.addEventListener('abort', abort, { once: true });
  let started = false;
  try {
    await cdp.send('Browser.getVersion'); started = true;trace('browser-ready');
    const { sessionId } = await attachLookPage(cdp);
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
    await send('Page.navigate', { url: context?`${url.href.replace(/\/$/,'')}/context-view?shot=1&quality=full&at=${shot.at.join(',')}&eye=${shot.eye.join(',')}`:`${url.href}?${q}` });
    if(context){
      while(!await evaluate('typeof window.contextRender === \'function\'').catch(()=>false)){signal.throwIfAborted();await new Promise(r=>setTimeout(r,100));}
      trace('page-ready');const result=await evaluate(`window.contextRender(${JSON.stringify(context)})`);if(result?.photo&&typeof result.photo==='object')contextResult?.(result.photo);if(!result?.data)throw new ApiError(503,'context.unavailable',String(result?.reason??'empty context capture'));
      trace('captured');const bytes=Buffer.from(String(result.data).split(',')[1]??'','base64');pngSize(bytes);return bytes;
    }
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
    if (!started) { startupFailed = true; throw unavailable('The Google Chrome executable failed to start on the world host.'); }
    if (e instanceof ApiError) throw e;
    throw new ApiError(503, 'look.failed', `World screenshot failed: ${String((e as Error).message).split('\n')[0].slice(0, 200)}. Retry the look; check the host viewer if it persists.`);
  } finally {
    disposing = true; signal.removeEventListener('abort', abort); cdp.close();
    await stopChrome(child); await rm(profile, { recursive: true, force: true });trace('stopped');histogram?.disable();
  }
}
