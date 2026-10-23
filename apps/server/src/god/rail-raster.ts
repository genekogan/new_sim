import { rot2, type OBB2, type Vec2 } from '../../../../mars/viewer/engine/core/math.ts';

/** Only rectangular stair landings are qualified. The generator emits four points (approach, flight
 * bottom, flight top, arrival) for these; spiral links have a sampled arc. Keep mixed/curved geometry
 * conservative because changing its obstacle mask can alter which landing/seat approach gets chosen. */
export function hasStraightLandings(links: readonly { kind: string; path: readonly Vec2[] }[] | undefined): boolean {
  return !!links?.length && links.every(link => link.kind === 'stairs' && link.path.length === 4);
}

/** A thin upper rail's middle is padded to a full cell before centre rastering (never shrink its solid).
 * Its original ends keep conservative caps: cell-centre sampling alone can miss a corner and admit a body too close.
 * The caller logs these boxes and raster choices prospectively; old world-edit facts remain unchanged. */
export function railRaster(obb: OBB2): { obb: OBB2; raster?: 'centre' }[] | null {
  const short = obb.half[0] <= obb.half[1] ? 0 : 1, long = 1 - short;
  if (!(obb.half[short] > 0 && obb.half[short] < 0.05 && obb.half[long] >= 0.1)) return null;
  const half: Vec2 = [...obb.half]; half[short] = 0.05;
  const parts: { obb: OBB2; raster?: 'centre' }[] = [{ obb: { ...obb, half }, raster: 'centre' }];
  const axis = rot2(long === 0 ? [1,0] : [0,1], obb.yaw);
  for (const sign of [-1,1]) {
    const capHalf: Vec2 = [...obb.half]; capHalf[long] = .01;
    const d = sign * (obb.half[long] - capHalf[long]);
    parts.push({ obb: { c: [obb.c[0] + axis[0]*d, obb.c[1] + axis[1]*d], half: capHalf, yaw: obb.yaw } });
  }
  return parts;
}
