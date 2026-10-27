import { inPoly } from './places.ts';
type Point = [
    number,
    number
];
/** Intersection of authored part and existing place polygons; no new place model. */
export function contextRegionsOverlap(a: Point[], b: Point[]): boolean {
    if (a.some(p => inPoly(p[0], p[1], b)) || b.some(p => inPoly(p[0], p[1], a)))
        return true;
    const cross = (p: Point, q: Point, r: Point) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const between = (p: Point, q: Point, r: Point) => r[0] >= Math.min(p[0], q[0]) && r[0] <= Math.max(p[0], q[0]) && r[1] >= Math.min(p[1], q[1]) && r[1] <= Math.max(p[1], q[1]);
    for (let i = 0; i < a.length; i++)
        for (let j = 0; j < b.length; j++) {
            const p = a[i], q = a[(i + 1) % a.length], r = b[j], s = b[(j + 1) % b.length];
            const u = cross(p, q, r), v = cross(p, q, s), w = cross(r, s, p), z = cross(r, s, q);
            if (u * v < 0 && w * z < 0 || u === 0 && between(p, q, r) || v === 0 && between(p, q, s) || w === 0 && between(r, s, p) || z === 0 && between(r, s, q))
                return true;
        }
    return false;
}
