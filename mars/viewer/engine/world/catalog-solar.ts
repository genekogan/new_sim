// Solar (owner feedback 2026-09-28 §9, spec §19): panels, mounting rails and the placed electrical
// equipment. Panels are their own thing — fragile 2-person loads (no tilting past 30°, never dropped),
// handed up / forklifted to a roof or top deck and mounted on two installed rails at the
// reconstruction's tilt (construction/solar.ts). Batteries, charge controllers and inverters are placed
// items: identifiable and configurable (entity `equipment`), no electrical simulation yet.
// Dimensions are generic market values, provisional until checked against the Mars photos.
import type { AssetDef } from './catalog.ts';

const DEG = Math.PI / 180;
/** A panel carried or handed up never tilts past this from level (catalog `handling.fragile.maxTilt`). */
export const PANEL_MAX_TILT = 30 * DEG;
const provisional = (note: string) => ({ confidence: 'provisional' as const, note });

/** `solar-panel-<w>x<l>` in cm: local x = length, y = thickness (frame depth), z = width. */
function panel(w: number, l: number, kg: number, watts: number): AssetDef {
  return {
    id: `solar-panel-${Math.round(w * 100)}x${Math.round(l * 100)}`,
    label: `solar panel ${w.toFixed(1)} × ${l.toFixed(1)} m (${watts} W)`,
    category: 'solar',
    size: [l, 0.035, w],
    massKg: kg,
    color: '#1d2b4f',
    handling: {
      carryCrew: [2, 2],
      carryPose: 'flat',
      grips: { 2: [{ id: 'g0', local: [-l * 0.4, 0, 0] }, { id: 'g1', local: [l * 0.4, 0, 0] }] },
      carryHeight: 0.8,
      fragile: { maxTilt: PANEL_MAX_TILT },
    },
    dims: provisional(`generic ${watts} W framed module, 35 mm frame; 2-person carry, fragile (≤ 30° tilt, never dropped)`),
  };
}

/** Placed electrical equipment: carried by one person, set down on the ground or a deck, configured. */
function equipment(id: string, label: string, size: [number, number, number], kg: number, kind: EquipmentKind, defaults: Record<string, number | string>, note: string): AssetDef {
  return {
    id,
    label,
    category: 'equipment',
    size,
    massKg: kg,
    color: kind === 'battery' ? '#3c4a3a' : '#5a5f66',
    handling: {
      carryCrew: [1, 1],
      carryPose: 'flat',
      grips: { 1: [{ id: 'mid', local: [0, 0, 0] }] },
      carryHeight: 0.8,
      ...(kg <= 10 ? { smallLoad: true as const } : {}),
    },
    equipment: { kind, defaults },
    dims: provisional(note),
  };
}

export type EquipmentKind = 'battery' | 'charge-controller' | 'inverter';

export const SOLAR_ASSETS: AssetDef[] = [
  panel(1.0, 1.7, 20, 330),
  panel(1.0, 2.0, 23, 400),
  {
    id: 'panel-rail',
    label: 'aluminium panel rail (2.1 m)',
    category: 'solar',
    size: [2.1, 0.04, 0.04],
    massKg: 2.5,
    color: '#b8bcc2',
    handling: { carryCrew: [1, 1], carryPose: 'flat', grips: { 1: [{ id: 'mid', local: [0, 0, 0] }] }, carryHeight: 0.8, smallLoad: true },
    dims: provisional('generic 40 × 40 mm extruded rail, 2.1 m; the tilt legs of a tilted mount are implied, not modelled'),
  },
  equipment('battery', 'LiFePO4 battery (12 V 200 Ah)', [0.52, 0.22, 0.24], 22, 'battery', { voltage: 12, capacityAh: 200, chemistry: 'LiFePO4' }, 'generic 12 V 200 Ah LiFePO4 case'),
  equipment('charge-controller', 'MPPT charge controller', [0.3, 0.12, 0.2], 4, 'charge-controller', { maxPvVoltage: 150, maxCurrentA: 60 }, 'generic 150 V / 60 A MPPT controller'),
  equipment('inverter', 'inverter (3 kW)', [0.45, 0.2, 0.35], 12, 'inverter', { powerW: 3000, dcVoltage: 12, acVoltage: 120 }, 'generic 3 kW off-grid inverter'),
];

export const isPanel = (defId: string) => defId.startsWith('solar-panel-');
export const isRail = (defId: string) => defId === 'panel-rail';
