// W2: the agent needs only Node and a god token when its Chrome cannot run.
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from './state.mjs';

export async function remoteLook(args, runtime = {}) {
  const now = runtime.now ?? Date.now, t0 = now();
  const token = (runtime.load ?? load)().token;
  if (!token) throw Error('look: remote rendering needs a god token; run pair (or mint on a local dev world)');
  const body = Object.fromEntries(['eye', 'at', 'hideRoofs', 'cut', 'span', 'hour', 'weather', 'width', 'height'].filter(k => args[k] !== undefined).map(k => [k, args[k]]));
  const r = await (runtime.fetch ?? fetch)(`${args.worldUrl.replace(/\/$/, '')}/v1/god/look`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(args.timeoutMs ?? Number(process.env.EDEN_GOD_LOOK_TIMEOUT_MS ?? 90_000)),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw Error(`look: ${e.code ?? r.status}: ${e.message ?? 'world renderer refused the screenshot'}${e.retry_after ? `; retry in ${e.retry_after}s` : ''}`);
  }
  const png = Buffer.from(await r.arrayBuffer());
  if (!r.headers.get('content-type')?.startsWith('image/png') || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('look: world renderer did not return a PNG');
  writeFileSync(resolve(args.out), png);
  return { file: resolve(args.out), ms: now() - t0, via: 'remote', size: r.headers.get('x-look-size') ?? undefined };
}

/** Keep all launch-fallback policy out of W1's local rendering implementation. */
export async function withRemoteLook(args, runtime, local) {
  if (args.remote || process.env.EDEN_GOD_LOOK === 'remote') return remoteLook(args, runtime);
  const candidates = process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] : process.platform === 'win32' ? [String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`, String.raw`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`] : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'];
  if (runtime.pw === undefined && !(runtime.chromeExists ?? (() => candidates.some(existsSync)))()) return remoteLook(args, runtime);
  const now = runtime.now ?? Date.now, started = now();
  try { return await local(); }
  catch (e) {
    if (!/cannot start Chrome|no Playwright|browserType\.launch|executable doesn't exist|browser keeper did not start/i.test(String(e.message))) throw e;
    return { ...await remoteLook(args, runtime), ms: now() - started };
  }
}
