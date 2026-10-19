// P7b lever E1: the page's first loading phase (phased-entry.ts writes it into index.html as its own entry). On the early
// layer's pages it starts the world's entity layer at once and lets the second phase (main.tsx, React, the Shell, the
// socket) start when the snapshot is in; elsewhere it lets it start at once and does nothing else.
import { installAssetTransport } from './boot-assets.ts';
import { earlyLayerWanted, startEarlyLayer } from './early-layer.ts';
import { PHASE2_GLOBAL } from './phased-entry.ts';

const phase2 = () => { try { (window as unknown as Record<string, (() => void) | undefined>)[PHASE2_GLOBAL]?.(); } catch { /* the loader's own fallback runs it */ } };
let started = false;
try {
  if (earlyLayerWanted()) { installAssetTransport(); started = startEarlyLayer(phase2); }
} catch { /* LiveWorld makes its own layer */ }
if (!started) phase2();
