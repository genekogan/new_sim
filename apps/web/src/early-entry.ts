// P7b lever E1: the page's first loading phase (phased-entry.ts writes it into index.html as its own entry). On the early
// layer's pages it starts the world's entity layer at once and lets the second phase (main.tsx, React, the Shell, the
// socket) start when the snapshot is in; elsewhere it lets it start at once and does nothing else.
import { installAssetTransport } from './boot-assets.ts';
import { earlyLayerWanted, startEarlyLayer } from './early-layer.ts';
import { PHASE2_GLOBAL } from './phased-entry.ts';

const phase2 = () => { try { (window as unknown as Record<string, (() => void) | undefined>)[PHASE2_GLOBAL]?.(); } catch { /* the loader's own fallback runs it */ } };
let started = false;
try {
  // P7d: when the snapshot is in, the early renderer's chunk is asked for first (ahead of phase two on the link)
  let asked = false;
  const onSnapshot = () => { try { if (!asked && (asked = true) && new URLSearchParams(location.search).get('earlyRender') !== '0') void import('./early-render.ts').then((m) => m.startEarlyRender(), () => {}); } catch { /* LiveWorld draws it */ } phase2(); };
  if (earlyLayerWanted()) { installAssetTransport(); started = startEarlyLayer(onSnapshot); }
} catch { /* LiveWorld makes its own layer */ }
if (!started) phase2();
