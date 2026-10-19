// P7b lever E1 (team/lanes/t4-p7.md "P7b design"): on a phone-tier page of a new world with the early arrival (lever D),
// the world's entity layer starts as soon as its own code and the snapshot are in (early-entry.ts, the page's first
// loading phase), so the terrain and the near ring are built while React, the Shell and the rest of the page still
// download (phased-entry.ts). LiveWorld then adopts that started layer instead of making its own. Everywhere else
// (desktops, old worlds, pictures, `?earlyLayer=0`) LiveWorld makes and starts its layer as before.
import { WorldEntityLayer } from './WorldEntityLayer.ts';
import { apiPath } from './world-path.ts';
import { newWorld } from './world-kind.ts';
import { browserQuality } from './quality-tier.ts';
import { earlyArrivalWanted } from './early-arrival.ts';

export type EarlyLayer = { layer: WorldEntityLayer; started: Promise<void>; abort: AbortController };
let early: EarlyLayer | null = null, claimed = false;

/** The early layer's gate: lever D's (phone tier, new world, not a picture), unless `?earlyLayer=0`. */
export function earlyLayerWanted(search = location.search): boolean {
  const q = new URLSearchParams(search);
  return q.get('earlyLayer') !== '0' && earlyArrivalWanted(browserQuality().tier, newWorld, search, q.has('shot'));
}

/** Start the layer now (once per page; never after LiveWorld has made its own). `onSnapshot` as WorldEntityLayer.start. */
export function startEarlyLayer(onSnapshot?: () => void): boolean {
  if (early || claimed) return false;
  const abort = new AbortController(), layer = new WorldEntityLayer(apiPath);
  early = { layer, abort, started: layer.start(abort.signal, onSnapshot) };
  if (onSnapshot) void early.started.then(onSnapshot, onSnapshot);   // the page's second phase never waits on a failed start
  return true;
}

/** LiveWorld: the started early layer, at most once per page; afterwards (or when there was none) no early layer starts. */
export function takeEarlyLayer(): EarlyLayer | null {
  claimed = true;
  const e = early; early = null;
  return e;
}
