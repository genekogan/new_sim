/** Visual contact correction only. The engine root and the clip's swing height remain
 * authoritative; a foot may rise a few centimetres but never drag down to terrain
 * under a slab, snap onto a shelf, or move the whole body. */
export function groundFootLift(rootY: number, lowestFootY: number, groundY?: number | null): number {
  if (!Number.isFinite(rootY) || !Number.isFinite(lowestFootY)) return 0;
  const floor = groundY != null && Number.isFinite(groundY) && Math.abs(groundY - rootY) <= .12
    ? Math.max(rootY, groundY) : rootY;
  return Math.max(0, Math.min(.08, floor + .003 - lowestFootY));
}
