"""Check a building GLB against its footprint, on the GLB as re-imported.

1. portal rays   - a grid of rays across each portal's clear rectangle (or the
                   shaft's disk) through the wall/slab must hit nothing: no
                   face spans an opening.
2. head sweep    - a head-sized sphere moved through each portal's centre,
                   1 m beyond both faces, never touches geometry.
3. room space    - inside every room, away from its walls, a head fits at
                   1.0 m and 2.5 m above the floor.
4. walls real    - every footprint wall/solid obstacle has mesh under it.
5. portals free  - no footprint obstacle overlaps a portal's clear opening.
6. portal size   - every clear rectangle is at least MIN_CLEAR wide and tall
                   (shafts: diameter at least MIN_CLEAR).
"""
import math

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from model import HEAD_DIAMETER, MIN_CLEAR

R = HEAD_DIAMETER / 2


def B(p):
    """engine (x, y, z) -> Blender (x, y, z)."""
    return Vector((p[0], -p[2], p[1]))


def load_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    obs = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    dg = bpy.context.evaluated_depsgraph_get()
    verts, polys, off = [], [], 0
    tris = 0
    for o in obs:
        me = o.evaluated_get(dg).to_mesh()
        mw = o.matrix_world
        verts += [mw @ v.co for v in me.vertices]
        polys += [[off + i for i in p.vertices] for p in me.polygons]
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        off += len(me.vertices)
    bvh = BVHTree.FromPolygons(verts, polys, epsilon=0.0)
    lo = Vector((min(v[i] for v in verts) for i in range(3)))
    hi = Vector((max(v[i] for v in verts) for i in range(3)))
    for o in obs:
        bpy.data.objects.remove(o)
    return bvh, {'vertices': len(verts), 'triangles': tris, 'minBlender': lo, 'maxBlender': hi}


def _segment_hits(bvh, a, b):
    d = b - a
    hit = bvh.ray_cast(a, d.normalized(), d.length)
    return hit[0] is not None


def _sweep(bvh, a, b, step=0.1):
    n = max(1, int((b - a).length / step))
    best = math.inf
    for k in range(n + 1):
        p = a.lerp(b, k / n)
        loc, _, _, dist = bvh.find_nearest(p, 50.0)
        if loc is not None:
            best = min(best, dist)
    return best


def _in_poly(p, poly):
    x, z = p
    inside = False
    for (x1, z1), (x2, z2) in zip(poly, poly[1:] + poly[:1]):
        if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1) + x1:
            inside = not inside
    return inside


def _edge_dist(p, poly):
    best = math.inf
    for a, b in zip(poly, poly[1:] + poly[:1]):
        ax, az = a
        bx, bz = b
        dx, dz = bx - ax, bz - az
        t = max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - az) * dz) / (dx * dx + dz * dz)))
        best = min(best, math.hypot(p[0] - ax - t * dx, p[1] - az - t * dz))
    return best


def _in_obb(p, obb, pad=0.0):
    c, h, yaw = obb['c'], obb['half'], obb['yaw']
    dx, dz = p[0] - c[0], p[1] - c[1]
    cs, sn = math.cos(-yaw), math.sin(-yaw)
    lx, lz = dx * cs - dz * sn, dx * sn + dz * cs
    return abs(lx) <= h[0] + pad and abs(lz) <= h[1] + pad


def check(glb_path, fp):
    bvh, stats = load_glb(glb_path)
    report = {'mesh': {'vertices': stats['vertices'], 'triangles': stats['triangles'],
                       'boundsEngine': {'min': [round(stats['minBlender'].x, 3), round(stats['minBlender'].z, 3), round(-stats['maxBlender'].y, 3)],
                                        'max': [round(stats['maxBlender'].x, 3), round(stats['maxBlender'].z, 3), round(-stats['minBlender'].y, 3)]}},
              'portals': [], 'rooms': [], 'failures': []}
    fail = report['failures']

    for pt in fp['portals']:
        c = B(pt['center'])
        rays = blocked = 0
        if pt['kind'] == 'shaft':
            rr = pt['diameter'] / 2 - 0.05
            for i in range(-4, 5):
                for j in range(-4, 5):
                    x, y = rr * i / 4, rr * j / 4
                    if x * x + y * y > rr * rr:
                        continue
                    a = Vector((c.x + x, c.y + y, pt['y0'] - 0.3))
                    b = Vector((c.x + x, c.y + y, pt['y1'] + 0.3))
                    rays += 1
                    blocked += _segment_hits(bvh, a, b)
            clearance = _sweep(bvh, Vector((c.x, c.y, pt['y0'] - 1.0)), Vector((c.x, c.y, pt['y1'] + 1.0)))
            size = {'diameter': pt['diameter']}
        else:
            n = B(pt['normal'])
            t = Vector((-n.y, n.x, 0))
            half_d = pt['wallThickness'] / 2 + 0.6
            w = pt['width'] / 2 - 0.05
            for i in range(7):
                for j in range(7):
                    u = -w + 2 * w * i / 6
                    z = pt['y0'] + 0.05 + (pt['y1'] - pt['y0'] - 0.1) * j / 6
                    p = Vector((c.x, c.y, z)) + t * u
                    rays += 1
                    blocked += _segment_hits(bvh, p - n * half_d, p + n * half_d)
            mid = Vector((c.x, c.y, (pt['y0'] + pt['y1']) / 2))
            clearance = _sweep(bvh, mid - n * (half_d + 0.4), mid + n * (half_d + 0.4))
            size = {'width': pt['width'], 'height': round(pt['y1'] - pt['y0'], 3)}
        over = []
        if pt['kind'] != 'shaft':
            pc = [pt['center'][0], pt['center'][2]]
            for ob in fp['obstacles']:
                if ob['y0'] < pt['y1'] - 0.01 and ob['y1'] > pt['y0'] + 0.01 and _in_obb(pc, ob['obb']):
                    over.append(ob['id'])
        row = {'id': pt['id'], 'kind': pt['kind'], **size, 'rays': rays, 'raysBlocked': blocked,
               'headClearance': round(clearance, 3), 'obstaclesOverlapping': over}
        report['portals'].append(row)
        small = [v for v in size.values() if v < MIN_CLEAR]
        if small:
            fail.append(f"{pt['id']}: clear size {size} below {MIN_CLEAR} m")
        if blocked:
            fail.append(f"{pt['id']}: {blocked}/{rays} rays through the opening hit geometry")
        if clearance < R:
            fail.append(f"{pt['id']}: head sphere clearance {clearance:.2f} m < {R} m")
        if over:
            fail.append(f"{pt['id']}: footprint obstacles {over} cover the opening")

    for room in fp['rooms']:
        poly = room['polygon']
        xs = [p[0] for p in poly]
        zs = [p[1] for p in poly]
        pts = ok = 0
        worst = math.inf
        for h in (1.0, 2.5):
            y = room['y0'] + h
            x = min(xs)
            while x <= max(xs):
                z = min(zs)
                while z <= max(zs):
                    inside = _in_poly((x, z), poly) and _edge_dist((x, z), poly) >= R + 0.1
                    # where the footprint itself says "blocked" (a foot, a wall band of a
                    # tapering hall), a head is not expected to fit
                    blocked = inside and any(
                        ob['y0'] < y + R and ob['y1'] > y - R and _in_obb((x, z), ob['obb'], R)
                        for ob in fp['obstacles'])
                    if inside and not blocked:
                        loc, _, _, d = bvh.find_nearest(B((x, y, z)), 50.0)
                        pts += 1
                        ok += d >= R
                        worst = min(worst, d)
                    z += 0.75
                x += 0.75
        report['rooms'].append({'id': room['id'], 'samples': pts, 'headFits': ok,
                                'minClearance': round(worst, 3), 'clearHeight': room['clearHeight']})
        if ok < pts:
            fail.append(f"{room['id']}: head does not fit at {pts - ok}/{pts} interior samples")

    missing = []
    for ob in fp['obstacles']:
        c = ob['obb']['c']
        y = (ob['y0'] + ob['y1']) / 2
        _, _, _, d = bvh.find_nearest(B((c[0], y, c[1])), 50.0)
        lim = (ob['obb']['half'][1] if ob['kind'] == 'wall' else max(ob['obb']['half'])) + 0.2
        if d is None or d > lim:
            missing.append(ob['id'])
    report['obstacles'] = {'count': len(fp['obstacles']), 'withoutGeometry': missing}
    if missing:
        fail.append(f'{len(missing)} footprint obstacles have no mesh under them: {missing[:5]}')
    report['ok'] = not fail
    return report
