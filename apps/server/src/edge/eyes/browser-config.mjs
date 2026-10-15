// Separate pure launch policy so CPU portability and the laptop's hardware-only boundary are testable without Chrome.
export function eyesBrowserModes(env = process.env, platform = process.platform) {
  const requested = env.EDGE_EYES_GPU || 'auto';
  if (!['auto', 'metal', 'gl', 'swiftshader'].includes(requested)) throw new Error('EDGE_EYES_GPU must be auto, metal, gl or swiftshader');
  // The shared Mac serves live worlds: never run software Chromium here, including implicit fallback.
  if (platform === 'darwin') {
    if (requested !== 'auto' && requested !== 'metal') throw new Error('local Eyes requires real Chrome with Metal');
    return ['metal'];
  }
  return requested === 'auto' ? ['swiftshader'] : [requested];
}
export function eyesBrowserLaunch(mode, env = process.env, platform = process.platform) {
  const flags = {
    metal: ['--ignore-gpu-blocklist'],
    gl: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'],
    swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  };
  if (!flags[mode]) throw new Error('invalid Eyes renderer mode');
  return {headless: true, ...(platform === 'darwin' ? {channel: 'chrome'} : env.EDGE_EYES_HEADLESS_SHELL === '1' ? {} : {channel: 'chromium'}),
    args: [...flags[mode], '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']};
}
