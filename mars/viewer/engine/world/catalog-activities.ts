// Hypothetical classroom objects. Geometry, interaction points and capabilities are
// separate data: a visible mesh alone does not grant a usable display.
import type { AssetDef } from './catalog.ts';

export const ACTIVITY_ASSETS: AssetDef[] = [
  {
    id: 'standing-display', label: 'standing classroom display', category: 'fixture',
    size: [1.6, 1.65, 0.36], massKg: 38, color: '#202c38', obstacle: true,
    capabilities: { display: { accepts: 'text', maxChars: 160 } },
    dims: { confidence: 'hypothetical', note: 'generic 1.6 m wide display on a freestanding frame; not a documented Mars object' },
  },
  {
    id: 'speaker-lectern', label: 'classroom presenter lectern', category: 'fixture',
    size: [0.7, 1.1, 0.46], massKg: 16, color: '#8b6a45', obstacle: true,
    // Presenter stands behind the local -z face, looking toward the audience (+z).
    slots: [{ id: 'presenter', kind: 'stand', local: [0, -0.85], yaw: Math.PI / 2 }],
    capabilities: { presenterStation: true },
    dims: { confidence: 'hypothetical', note: 'generic lectern with a standable presenter point 0.85 m behind its centre' },
  },
];
