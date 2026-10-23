// BALLOON-BODY: which god balloon defs are rides (shared by the tag:balloon builder and WorldEntityLayer.rideNames).
/** A god balloon that is a ride: tagged balloon, with a `carrier` component or (Eden 2026's launch balloon, whose def
 *  carries only `hover`) a `carrier` tag. */
export function isRideBalloonDef(def: { components?: Record<string, unknown>; tags?: readonly string[] }): boolean {
  const tags = def.tags ?? []; return tags.includes('balloon') && (!!def.components?.carrier || tags.includes('carrier'));
}
/** The def a ride balloon is animated with: its `hover` bob dropped, since Core's vehicle owns its motion (one balloon, posed
 *  from the twin grounded and aloft). Any other def passes through unchanged. */
export function rideMotionDef<D extends { components: Record<string, unknown>; tags: readonly string[] }>(def: D): D {
  if (!isRideBalloonDef(def) || !def.components.hover) return def;
  const { hover: _hover, ...components } = def.components; void _hover; return { ...def, components };
}
