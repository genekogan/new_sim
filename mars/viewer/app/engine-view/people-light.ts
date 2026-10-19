// The few people facts a page needs before the people renderer (humans.ts, people.ts, take-replay.ts) has loaded: the
// template names, the stable template choice per actor id, and the visual ground the viewer sets for people lying down
// and items on the ground. humans.ts and people.ts re-export these (one copy of the state). Sim P1 phones: a new
// world's first frame needs none of the renderer, which loads after its arrival.

export const PEOPLE = ['casual', 'punk', 'woman'] as const;

function hashId(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}
export { hashId };

/** Exact legacy full-collection choice, also used while only required initial templates are loaded. */
export function templateNameFor(id:string,order:readonly string[]){return order[hashId(id)%order.length];}

/** Visual ground under people lying down (the viewer sets it; the engine height is used where it is unset or far off). */
let humanGround: ((x: number, z: number) => number | null) | null = null;
export function setHumanGround(sample: ((x: number, z: number) => number | null) | null) { humanGround = sample; }
/** The ground sampler the viewer set, or null. */
export function humanGroundSampler() { return humanGround; }
/** The visual ground height at (x, z) where the viewer has set one (items lying around, edge items). */
export function humanGroundAt(x: number, z: number): number | null { const g = humanGround?.(x, z); return g !== null && g !== undefined && Number.isFinite(g) ? g : null; }
