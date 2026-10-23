// The worker's browser says who it is in its user agent, so the world (attention.ts) and the launcher's proxy do not
// count its long-lived viewer socket as somebody watching: a world with Eyes on still slows down and sleeps unwatched.
// Spoofing it only makes the spoofer's own visit count as passive (pace/sleep), nothing else.
export const EYES_UA_TAG = 'EdenEyes/1';
export const isEyesAgent = ua => typeof ua === 'string' && ua.includes(EYES_UA_TAG);
/** Niceness of the worker and its browser (EDGE_EYES_NICE, 0..19, default 10): world ticks always win the CPU. */
export function eyesNice(env = process.env) {const n = Number(env.EDGE_EYES_NICE ?? 10); return Number.isInteger(n) && n >= 0 && n <= 19 ? n : 10;}
/** Extra Chromium switches (EDGE_EYES_CHROME_ARGS, space separated; only --switches), e.g. to shrink idle thread pools. */
export const eyesExtraArgs = (env = process.env) => String(env.EDGE_EYES_CHROME_ARGS ?? '').split(/\s+/).filter(a => a.startsWith('--'));
/** CPU list the worker and its browser are pinned to (EDGE_EYES_CPUS, taskset syntax like '0' or '0-1'; unset = no pinning). */
export function eyesCpus(env = process.env) {const c = String(env.EDGE_EYES_CPUS ?? '').trim(); return /^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(c) ? c : null;}
// Separate pure launch policy so CPU portability and the laptop's hardware-only boundary are testable without Chrome.
export function eyesWorkerProblem(platform = process.platform) {
  return platform === 'darwin' ? 'persistent Eyes service is disabled on the shared Mac; qualify captures on a remote CPU host' : null;
}
export function eyesBrowserModes(env = process.env, platform = process.platform) {
  const requested = env.EDGE_EYES_GPU || 'auto';
  if (!['auto', 'metal', 'gl', 'swiftshader'].includes(requested)) throw new Error('EDGE_EYES_GPU must be auto, metal, gl or swiftshader');
  // A persistent worker cannot hold the shared Mac's finite Chrome lease between captures.
  const problem = eyesWorkerProblem(platform); if (problem) throw new Error(problem);
  return requested === 'auto' ? ['swiftshader'] : [requested];
}
export function eyesBrowserLaunch(mode, env = process.env, platform = process.platform) {
  const problem = eyesWorkerProblem(platform); if (problem) throw new Error(problem);
  const flags = {
    metal: ['--ignore-gpu-blocklist'],
    gl: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'],
    swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  };
  if (!flags[mode]) throw new Error('invalid Eyes renderer mode');
  return {headless: true, ...(env.EDGE_EYES_HEADLESS_SHELL === '1' ? {} : {channel: 'chromium'}),
    args: [...flags[mode], '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      ...eyesExtraArgs(env)]};
}
