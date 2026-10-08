/** Visual plane partition only. Native surfaces/terrain remain untouched. */
export type GroundRectangle = readonly [number, number, number, number];
function copyRectangle(value: GroundRectangle): [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4) throw Error('Invalid ground rectangle');
  const fields = [0, 1, 2, 3].map(i => Object.getOwnPropertyDescriptor(value, String(i)));
  if (fields.some(d => !d || !('value' in d) || typeof d.value !== 'number' || !Number.isFinite(d.value)))
    throw Error('Ground rectangle requires finite own data');
  const out = fields.map(d => d!.value) as [number, number, number, number];
  if (out[0] >= out[2] || out[1] >= out[3] || out.some(v => Math.abs(v) > 20000))
    throw Error('Invalid ground rectangle extent');
  return out;
}
/** At most four disjoint axis-aligned planes. Omit the captured terrain's entire
 * rectangle, including dry shoulder, so a clearance floor cannot cover its bed.
 * Boundary edges have zero area; neither a support nor a navigation mask. */
export function groundOutsideTerrain(floor: GroundRectangle, terrain: GroundRectangle): GroundRectangle[] {
  const [x0, z0, x1, z1] = copyRectangle(floor);
  const [tx0, tz0, tx1, tz1] = copyRectangle(terrain);
  const a = Math.max(x0, tx0), b = Math.max(z0, tz0), c = Math.min(x1, tx1), d = Math.min(z1, tz1);
  if (a >= c || b >= d) return [[x0, z0, x1, z1]];
  const rectangles: GroundRectangle[] = [];
  if (x0 < a) rectangles.push([x0, z0, a, z1]);
  if (c < x1) rectangles.push([c, z0, x1, z1]);
  if (z0 < b) rectangles.push([a, z0, c, b]);
  if (d < z1) rectangles.push([a, d, c, z1]);
  return rectangles;
}
