import { useEffect, useState } from 'react';
import { enterFullscreen, offerFullscreen, readFullscreenEnv, watchFullscreenEnv } from './fullscreen.ts';

/** Lane P4: the world HUD's Fullscreen button (Android only; hidden once full screen or installed; see fullscreen.ts). */
export function FullscreenToggle() {
  const [offer, setOffer] = useState(() => offerFullscreen(readFullscreenEnv()));
  useEffect(() => watchFullscreenEnv(() => setOffer(offerFullscreen(readFullscreenEnv()))), []);
  if (!offer) return null;
  return <button type="button" className="hud-camera fullscreen-toggle" aria-label="Full screen" title="Full screen" onClick={enterFullscreen}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
  </button>;
}
