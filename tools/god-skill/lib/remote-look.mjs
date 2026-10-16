// W2: the agent needs only Node and a god token when its Chrome cannot run.
import { existsSync, writeFileSync } from 'node:fs';
import { resolve, win32 } from 'node:path';
import { load } from './state.mjs';
import { fetchWithRetry } from './retry.mjs';

const needsLocalBrowser = args => !!args.views || args.frames > 1 || !!args.studio;
const localBrowserError = () => Error('look: sheets (--views/--site), motion frames and kit workbench require local Playwright and Google Chrome; the remote renderer supports single views only');

export async function remoteLook(args, runtime = {}) {
  if (needsLocalBrowser(args)) throw localBrowserError();
  runtime.signal?.throwIfAborted();
  const now = runtime.now ?? Date.now, t0 = now();
  const token = (runtime.load ?? load)().token;
  if (!token) throw Error('look: remote rendering needs a god token; run pair (or mint on a local dev world)');
  const body = Object.fromEntries(['eye', 'at', 'hideRoofs', 'cut', 'span', 'hour', 'weather', 'width', 'height'].filter(k => args[k] !== undefined).map(k => [k, args[k]]));
  const r = await fetchWithRetry(`${args.worldUrl.replace(/\/$/, '')}/v1/god/look`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    // One look deadline (E1) cancels the request through runtime.signal; 429s back off inside it (1.1).
    redirect: 'error', timeoutMs: args.timeoutMs ?? Number(process.env.EDEN_GOD_LOOK_TIMEOUT_MS ?? 120_000), deadlineAt: runtime.deadlineAt, signal: runtime.signal,
  }, runtime);
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw Error(`look: ${e.code ?? r.status}: ${e.message ?? 'world renderer refused the screenshot'}${e.retry_after ? `; retry in ${e.retry_after}s` : ''}`);
  }
  const png = Buffer.from(await r.arrayBuffer());
  runtime.signal?.throwIfAborted();
  if (!r.headers.get('content-type')?.startsWith('image/png') || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('look: world renderer did not return a PNG');
  writeFileSync(resolve(args.out), png);
  return { file: resolve(args.out), ms: now() - t0, via: 'remote', size: r.headers.get('x-look-size') ?? undefined };
}

/** Every place Playwright's `chrome` channel looks (playwright-core registry: the Windows prefixes LOCALAPPDATA,
 * PROGRAMFILES, PROGRAMFILES(X86), HOMEDRIVE), plus the usual Linux links. null = unknown platform: try local. */
export function chromeCandidates(platform = process.platform, env = process.env) {
  if (platform === 'darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  if (platform === 'linux') return ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
  if (platform !== 'win32') return null;
  const prefixes = [env.LOCALAPPDATA, env.PROGRAMFILES, env['PROGRAMFILES(X86)'], ...(env.HOMEDRIVE ? [`${env.HOMEDRIVE}\\Program Files`, `${env.HOMEDRIVE}\\Program Files (x86)`] : []), 'C:\\Program Files', 'C:\\Program Files (x86)'];
  return [...new Set(prefixes.filter(Boolean).map(p => win32.join(p, 'Google\\Chrome\\Application\\chrome.exe')))];
}

/** Keep all launch-fallback policy out of W1's local rendering implementation. */
export async function withRemoteLook(args, runtime, local) {
  if (args.remote || process.env.EDEN_GOD_LOOK === 'remote') return remoteLook(args, runtime);
  // Go straight to the world only when Chrome is surely absent: none of the paths Playwright's chrome channel
  // would launch exists (so no npx fetch or lease on a Chrome-less host). Otherwise Playwright decides.
  const candidates = (runtime.chromeCandidates ?? chromeCandidates)();
  if (runtime.pw === undefined && candidates && !(runtime.chromeExists ?? (() => candidates.some(existsSync)))()) {
    try { return await remoteLook(args, runtime); }
    catch (remote) { throw new Error(`look: local: no Google Chrome where Playwright looks (${candidates.join(', ')}); remote: ${remote.message}`, { cause: remote }); }
  }
  const now = runtime.now ?? Date.now, started = now();
  try { return await local(); }
  catch (e) {
    runtime.signal?.throwIfAborted();
    if (!/cannot start Chrome|no Playwright|browserType\.launch|executable doesn't exist|browser keeper did not start/i.test(String(e.message))) throw e;
    try { return { ...await remoteLook(args, runtime), ms: now() - started }; }
    catch (remote) { throw new Error(`look: local: ${e.message}; remote: ${remote.message}`, { cause: remote }); }
  }
}
