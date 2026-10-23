// BALLOON-BODY: which god balloon defs are rides (shared by the tag:balloon builder and WorldEntityLayer.rideNames).
/** A god balloon that is a ride: tagged balloon, with a `carrier` component or (Eden 2026's launch balloon, whose def
 *  carries only `hover`) a `carrier` tag. */
export function isRideBalloonDef(def: { components?: Record<string, unknown>; tags?: readonly string[] }): boolean {
  const tags = def.tags ?? []; return tags.includes('balloon') && (!!def.components?.carrier || tags.includes('carrier'));
}
