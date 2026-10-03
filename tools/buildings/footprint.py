"""Engine footprint for a building, derived from the same parameters as the mesh.

Output coordinates are the engine's: metres, Y up, ground plane (x, z), the
building's front facing +z, origin at the centre of its base. Shapes follow the
Mars engine where they can (engine/spatial/types.ts, engine/world/types.ts):
obstacles are OBB2 prisms {c, half, yaw} with y0/y1; rooms are regions with a
counter-clockwise (x, z) polygon (positive shoelace area). See BUILDINGS.md.

Walls are split into height bands. Within a band a gap is left only where an
opening's clear rectangle spans the whole band, so every gap is truly open and
every obstacle is truly solid (conservative: arch heads count as wall).
"""
import math

from model import HEAD_DIAMETER, MIN_CLEAR

SCHEMA = 'lm-building-footprint/1'
TAPER_BAND = 1.5
CORNER_PIECES = 3


def E(x, y, z=None):
    """Blender (x, y[, z]) -> engine (x, z) or (x, y, z)."""
    if z is None:
        return [round(x, 4), round(-y, 4)]
    return [round(x, 4), round(z, 4), round(-y, 4)]


def _ccw(poly):
    a = sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(poly, poly[1:] + poly[:1]))
    return poly if a > 0 else list(reversed(poly))


def rr_poly(hx, hy, r, segs=4):
    from geom import rounded_rect
    return _ccw([E(x, y) for x, y in rounded_rect(hx, hy, r, segs)])


NORMALS = {'+x': (1, 0), '-x': (-1, 0), '+y': (0, 1), '-y': (0, -1)}


def _obb(p, q, thick, z0, z1, oid, kind, room=None, level=None):
    """Wall piece between Blender points p and q (centre line) as an engine OBB prism."""
    a, b = E(*p), E(*q)
    dx, dz = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dz)
    out = {'id': oid, 'kind': kind,
           'obb': {'c': [round((a[0] + b[0]) / 2, 4), round((a[1] + b[1]) / 2, 4)],
                   'half': [round(length / 2, 4), round(thick / 2, 4)],
                   'yaw': round(math.atan2(dz, dx), 6)},
           'y0': round(z0, 4), 'y1': round(z1, 4)}
    if room:
        out['room'] = room
    if level is not None:
        out['level'] = level
    return out


def _band_walls(shell, room, level, b0, b1, idx):
    """Wall obstacles of one shell for one height band [b0, b1]."""
    ox0, _, r0 = shell.section(b0)
    ox1, _, r1 = shell.section(b1)
    ix0 = shell.inner(b0)[0]
    ix1 = shell.inner(b1)[0]
    outer, inner = max(ox0, ox1), min(ix0, ix1)
    mid = (outer + inner) / 2
    thick = outer - inner
    r = max(0.3, (r0 + r1) / 2 - shell.thickness / 2)
    straight = mid - r
    gaps = {s: [] for s in NORMALS}
    for o in shell.openings:
        if o.room != room:
            continue
        for u0, u1, z0, z1 in o.open_rects():
            if z0 <= b0 + 1e-6 and z1 >= b1 - 1e-6:
                gaps[o.side].append((u0, u1))
    out = []
    for side, (nx, ny) in NORMALS.items():
        tx, ty = -ny, nx
        cuts = sorted(gaps[side])
        u = -straight
        pieces = []
        for g0, g1 in cuts:
            if g0 > u:
                pieces.append((u, g0))
            u = max(u, g1)
        if u < straight:
            pieces.append((u, straight))
        for k, (a, b) in enumerate(pieces):
            p = (nx * mid + tx * a, ny * mid + ty * a)
            q = (nx * mid + tx * b, ny * mid + ty * b)
            out.append(_obb(p, q, thick, b0, b1, f'{shell.id}-b{idx}-{side}-{k}', 'wall', room, level))
    # corners: a few chords around each rounded corner
    for ci, (cx, cy, a0) in enumerate(((straight, straight, 0), (-straight, straight, 90),
                                       (-straight, -straight, 180), (straight, -straight, 270))):
        for k in range(CORNER_PIECES):
            t0 = math.radians(a0 + 90 * k / CORNER_PIECES)
            t1 = math.radians(a0 + 90 * (k + 1) / CORNER_PIECES)
            p = (cx + r * math.cos(t0), cy + r * math.sin(t0))
            q = (cx + r * math.cos(t1), cy + r * math.sin(t1))
            out.append(_obb(p, q, thick + 0.2, b0, b1, f'{shell.id}-b{idx}-c{ci}{k}', 'wall', room, level))
    return out


def _bands(shell, room, y0, y1):
    cuts = {y0, y1}
    for o in shell.openings:
        if o.room == room:
            for _, _, z0, z1 in o.open_rects():
                cuts.update(z for z in (z0, z1) if y0 < z < y1)
    cuts = sorted(cuts)
    bands = []
    for a, b in zip(cuts, cuts[1:]):
        n = max(1, math.ceil((b - a) / TAPER_BAND)) if shell.tapered else 1
        for k in range(n):
            bands.append((a + (b - a) * k / n, a + (b - a) * (k + 1) / n))
    return bands


def build(b, glb_name, bounds):
    level_of = {r.id: r.level for r in b.rooms}
    room_of = {r.id: r for r in b.rooms}
    obstacles, portals, links = [], [], []
    for shell in b.shells:
        for room, y0, y1 in shell.rooms:
            for i, (b0, b1) in enumerate(_bands(shell, room, y0, y1)):
                obstacles += _band_walls(shell, room, level_of[room], b0, b1, i)
        for o in shell.openings:
            (u0, u1), (z0, z1) = o.clear()
            zmid = (z0 + z1) / 2
            hx = shell.section(zmid)[0]
            d = hx - shell.thickness / 2
            nx, ny = NORMALS[o.side]
            uc = (u0 + u1) / 2
            c = (nx * d - ny * uc, ny * d + nx * uc, zmid)
            lo, hi = o.z_range()
            portals.append({
                'id': o.id, 'kind': o.kind, 'from': o.room, 'to': o.to, 'level': level_of[o.room],
                'center': E(*c), 'normal': E(nx, ny, 0.0),
                'width': round(u1 - u0, 4), 'y0': round(z0, 4), 'y1': round(z1, 4),
                'opening': {'shape': o.shape, 'width': o.width, 'y0': round(lo, 4), 'y1': round(hi, 4)},
                'wallThickness': shell.thickness,
            })
        for s in shell.shafts:
            lo, hi = room_of[s.below], room_of[s.above]
            portals.append({
                'id': s.id, 'kind': 'shaft', 'from': s.below, 'to': s.above, 'level': lo.level,
                'center': E(s.x, s.y, (s.z0 + s.z1) / 2), 'normal': [0, 1, 0],
                'diameter': s.diameter, 'y0': round(s.z0, 4), 'y1': round(s.z1, 4),
            })
            links.append({
                'id': s.id, 'kind': 'float', 'width': s.diameter,
                'from': {'level': lo.level, 'p': E(s.x, s.y), 'y': lo.floor},
                'to': {'level': hi.level, 'p': E(s.x, s.y), 'y': hi.floor},
                'path': [E(s.x, s.y, lo.floor + 1.0), E(s.x, s.y, hi.floor + 1.0)],
                'usable': True, 'floatOnly': True,
            })
    for e in b.extras:
        if e.obstacle:
            ob = e.obstacle
            obstacles.append({'id': e.id, 'kind': 'solid',
                              'obb': {'c': E(*ob['c']), 'half': [ob['half'][0], ob['half'][1]], 'yaw': 0.0},
                              'y0': ob['z0'], 'y1': ob['z1']})
    rooms = []
    for r in b.rooms:
        shell = next(s for s in b.shells if any(rr[0] == r.id for rr in s.rooms))
        hx, hy, cr = shell.inner(r.floor + 0.01)
        rooms.append({'id': r.id, 'label': r.label, 'kind': 'place', 'level': r.level,
                      'y0': r.floor, 'y1': r.ceiling, 'polygon': rr_poly(hx, hy, cr),
                      'clearHeight': round(r.ceiling - r.floor, 3)})
    terraces = [{'id': tid, 'kind': 'walkable', 'level': lvl, 'y': z,
                 'polygon': rr_poly(*outer), 'hole': rr_poly(*inner)}
                for tid, lvl, z, outer, inner in b.terraces]
    return {
        'schema': SCHEMA,
        'id': b.id, 'name': b.name, 'description': b.description,
        'world': 'littlemartians', 'glb': glb_name,
        'units': 'm', 'up': '+y', 'ground': 'xz', 'front': '+z',
        'origin': 'centre of the base at ground level (y = 0)',
        'envelope': {'headDiameter': HEAD_DIAMETER, 'minClear': MIN_CLEAR},
        'bounds': bounds,
        'levels': [{'id': i, 'y': y, 'label': lab} for i, y, lab in b.levels],
        'rooms': rooms, 'terraces': terraces,
        'obstacles': obstacles, 'portals': portals, 'links': links,
    }
