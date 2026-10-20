// P7f/P7g: one arrival camera for a new world, shared by the phone's early poster (early-render.ts) and LiveWorld, so the
// poster, LiveWorld's first frames and the broadcast's first shot are one view (3.38's poster framed what was built, then
// the broadcast cut to its opening landmark ~1.5 s later). The early layer still centres its near ring, coarse terrain and
// eager models on the framing of what was built (WorldEntityLayer.start): on Eden 2026 the opening view looks across a
// lake at that framing's centre, and a ring centred on the lake (P7f) left the poster's far shore bare (P7g shots).
// A world with Souls opens in Broadcast on its first establishing view (WorldDirector's OPENING holds landmarks[0];
// WorldBroadcast.opening makes that first tour move the view's push from k = 0, WorldTour.openingMove). A world without
// Souls keeps the framing of what was built (entity-arrival.ts), where LiveWorld leaves the camera once it knows.
// Whether Souls live here comes with the page, as the world clock does (apps/server/src/edge-snapshot.ts withWorldClock).
import { entityArrivalPose } from './entity-arrival.ts';
import { entryWorldSouls, godTourViews } from './world-env.ts';

type ArrivalLayer = { viewBounds(): readonly [number, number, number, number]; entityCount: number; groundAt: (x: number, z: number) => number | null; arrivalAt(): [number, number] | null };
export type WorldArrival = { target: [number, number, number]; eye: [number, number, number]; fov: number;
  /** The broadcast view this arrival opens on (WorldBroadcast.opening), or null: the framing of what was built. */
  opening: string | null };

/** The camera a new world's arrival starts at, for an aspect (width / height) at a 45° vertical field of view. */
export function worldArrivalPose(layer: ArrivalLayer, aspect: number, souls: number | null = entryWorldSouls()): WorldArrival {
  if (souls !== null && souls > 0) {
    const view = godTourViews(layer, layer.groundAt)[0];
    // = WorldTour.openingMove(view).at(0), the push's start (arrival-shot.test.ts holds them equal); WorldTour itself stays
    // out of the phone's first phase
    if (view) return { target: [...view.target], eye: [...view.p], fov: 45, opening: view.id };
  }
  const a = entityArrivalPose(layer.viewBounds(), layer.entityCount, layer.groundAt, 45, aspect, 1, layer.arrivalAt());
  return { target: a.target, eye: a.eye, fov: 45, opening: null };
}
