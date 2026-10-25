// D1 (playtest 2026-10-25, 104004 pip-002..005): the web treated only balloon-tagged things as rides, so a rider on a god's
// ferris wheel (installed as a balloon carrier on the wheel's attraction route, server god/rides.ts) stood over the grass
// with no car under it and the camera did not frame its ride. Any native carrier is a ride: the god's balloons (drawn by
// their own thing, moved to the twin), the god's attractions (the thing stays put; a car is drawn at the twin) and native
// carriers such as Eden's punt. Presentation only; pure so it is tested offline.
import type {CarrierPose} from './WorldBroadcast.ts';

/** A god thing with a `carrier` component (or Eden 2026's `carrier` tag) has a native ride twin. */
export function isRideCarrierDef(def: {components?: Record<string, unknown>; tags?: readonly string[]} | undefined): boolean {
  return !!def && (!!def.components?.carrier || (def.tags ?? []).includes('carrier'));
}
const ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;
/** The native carrier id a god ride installs as (mirrors installGodRides): its name when that is a free place-style id,
 *  else `ride-<thing id>`. */
export function carrierIdOf(e: {id: string; name?: unknown}, taken: (id: string) => boolean): string {
  const name = String(e.name ?? '');
  return ID.test(name) && !taken(name) ? name : `ride-${e.id.toLowerCase()}`;
}
/** Ids of the recorded entities that are native carriers (their state carries `carrier`). */
export function recordedCarriers(records: Record<string, unknown> | undefined): string[] {
  const out: string[] = [];
  for (const [id, r] of Object.entries(records ?? {})) if (r && typeof r === 'object' && (r as {carrier?: unknown}).carrier) out.push(id);
  return out.sort();
}
/** This frame's pose of each carrier id present in it (ids already framed by another source skipped). */
export function carrierPoses(ids: readonly string[], frame: Record<string, {p?: readonly number[]; yaw?: number} | undefined>, skip: ReadonlySet<string> = new Set()): (CarrierPose & {id: string})[] {
  const out: (CarrierPose & {id: string})[] = [];
  for (const id of ids) {if (skip.has(id)) continue; const e = frame[id]; if (e?.p) out.push({id, p: e.p, yaw: e.yaw ?? 0});}
  return out;
}
