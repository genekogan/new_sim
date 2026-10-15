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
    args: [...flags[mode], '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']};
}
