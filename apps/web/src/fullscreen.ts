// Lane P4 (2026-10-19, Gene): a Fullscreen button for Android browsers only.
// - Android (Chrome and other Android browsers with the Fullscreen API): offered.
// - iPhone/iPad: never (the API does not work on iPhone; installed to the Home Screen it is already full screen).
// - Desktop: never (unchanged).
// - Never while already full screen, nor when running as an installed app (display-mode standalone/fullscreen, or
//   iOS navigator.standalone). No "Add to Home Screen" hint anywhere.

export type FullscreenEnv = {
  ua: string;
  /** document.fullscreenEnabled and a requestFullscreen function on <html> */
  api: boolean;
  /** (display-mode: standalone) or (display-mode: fullscreen) */
  installed: boolean;
  /** iOS Safari's navigator.standalone */
  iosStandalone: boolean;
  /** document.fullscreenElement is set */
  fullscreen: boolean;
};

export const isAndroid = (ua: string) => /\bAndroid\b/i.test(ua);

/** Whether to show the Fullscreen button now. */
export function offerFullscreen(e: FullscreenEnv): boolean {
  return isAndroid(e.ua) && e.api && !e.installed && !e.iosStandalone && !e.fullscreen;
}

const APP_MODES = ['(display-mode: standalone)', '(display-mode: fullscreen)'];

export function readFullscreenEnv(): FullscreenEnv {
  const d = document, n = navigator as Navigator & { standalone?: boolean };
  return {
    ua: n.userAgent,
    api: d.fullscreenEnabled === true && typeof d.documentElement.requestFullscreen === 'function',
    installed: APP_MODES.some((q) => matchMedia(q).matches),
    iosStandalone: n.standalone === true,
    fullscreen: !!d.fullscreenElement,
  };
}

/** Calls `change` whenever the answer may have changed (entering/leaving full screen, display mode). */
export function watchFullscreenEnv(change: () => void): () => void {
  const lists = APP_MODES.map((q) => matchMedia(q));
  document.addEventListener('fullscreenchange', change);
  for (const l of lists) l.addEventListener('change', change);
  return () => { document.removeEventListener('fullscreenchange', change); for (const l of lists) l.removeEventListener('change', change); };
}

export function enterFullscreen(): void {
  // navigationUI 'hide': Android Chrome hides its own bars too; a refusal (no user gesture, policy) just leaves it as is
  void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}
