"""The two Little Martians buildings as parameters.

Ceramic Tower — Vanessa's pale blue-green tiered tower: four stepped tiers,
round arches on every side of every level, ribs that run down the walls like
glaze drips, corner turrets at the base, pinnacles above, a rounded crown and a
finial. Each tier is one room; its roof is the terrace of the tier above;
shafts through every floor let a floater rise from room to room.

Minaret Temple — darker blue: four legs joined by tall round arches (an open
pavilion), a domed body that swells and then draws in, round windows (a twin
pair on two sides, a tall arched window on the others), a lantern with four
arches, then a stepped spire and a spike. The pavilion, the body hall and the
upper hall are rooms; shafts join them from below.
"""
import math

import geom
from model import Building, Extra, Opening, Room, Shaft, Shell, const_section

SIDES = ('-y', '+x', '+y', '-x')  # front first


def _box_obstacle(cx, cy, hx, hy, z0, z1):
    return {'c': (cx, cy), 'half': (hx, hy), 'yaw': 0.0, 'z0': z0, 'z1': z1}


def _side_point(side, d, u):
    nx, ny = {'+x': (1, 0), '-x': (-1, 0), '+y': (0, 1), '-y': (0, -1)}[side]
    return nx * d - ny * u, ny * d + nx * u


def _rib(id_, side, u, half, z0, z1, depth=0.42, width=0.7):
    """A vertical rib standing proud of a wall (the glaze-drip ridges of the sculpture)."""
    cx, cy = _side_point(side, half + depth / 2 - 0.1, u)
    along_x = side in ('+y', '-y')
    hx, hy = (width / 2, depth / 2 + 0.1) if along_x else (depth / 2 + 0.1, width / 2)

    def build(col):
        return [geom.rr_prism(id_, hx, hy, 0.2, z0, z1, col, cx, cy)]
    return Extra(id_, build, _box_obstacle(cx, cy, hx, hy, z0, z1))


def _turret(id_, cx, cy, radius, z0, z1, cap):
    def build(col):
        prof = [(radius, z0), (radius, z1), (radius * 1.12, z1 + 0.12), (radius * 0.95, z1 + 0.3)]
        for i in range(1, 7):
            a = math.pi / 2 * i / 6
            prof.append((radius * 0.95 * math.cos(a), z1 + 0.3 + cap * math.sin(a)))
        prof[-1] = (0.0, z1 + 0.3 + cap)
        return [geom.lathe(id_, prof, col, cx, cy, segs=24)]
    return Extra(id_, build, _box_obstacle(cx, cy, radius * 1.12, radius * 1.12, z0, z1 + 0.3 + cap))


def _cornice(id_, hx, hy, r, z0, z1, material='glaze', depth=0.7):
    """A projecting band; a ring `depth` deep, so it never closes over a room or a shaft."""
    def build(col):
        inner = (hx - depth, hy - depth, max(0.2, r - depth))
        return [geom.rr_ring(id_, (hx, hy, r), inner, z0, z1, col)]
    return Extra(id_, build, None, material)


def _finial(id_, profile, segs=24):
    def build(col):
        return [geom.lathe(id_, profile, col, segs=segs)]
    return Extra(id_, build, None)


def _arches(room, sides, us, width, sill, spring, kind='door', prefix=None):
    out = []
    for side in sides:
        for i, u in enumerate(us):
            tag = f"{prefix or room}-{side.replace('+', 'p').replace('-', 'm')}{'' if len(us) == 1 else i}"
            out.append(Opening(tag, room, side, u, 'arch', width, sill, spring, kind))
    return out


# --------------------------------------------------------------------------- tower

def tower():
    # (half, corner r, z0, z1, floor, ceiling, arch us, arch width, spring above floor, rib us)
    tiers = [
        (9.0, 1.6, 0.0, 9.0, 0.5, 8.5, (-5.2, 0.0, 5.2), 3.4, 4.6, (-2.6, 2.6)),
        (7.3, 1.3, 9.0, 16.0, 9.0, 15.5, (-2.9, 2.9), 2.8, 3.4, (0.0,)),
        (5.6, 1.0, 16.0, 22.0, 16.0, 21.5, (0.0,), 3.0, 3.2, (-3.0, 3.0)),
        (4.1, 0.8, 22.0, 27.5, 22.0, 27.0, (0.0,), 2.8, 2.6, (-2.4, 2.4)),
    ]
    labels = ['ground hall', 'second room', 'third room', 'lantern room']
    rooms, shells, extras, terraces, levels = [], [], [], [], []
    shaft_d = (3.4, 3.2, 3.0)
    for i, (h, r, z0, z1, fl, ce, us, aw, sp, ribs) in enumerate(tiers):
        rid = f'tower-L{i}'
        levels.append((i, fl, labels[i]))
        rooms.append(Room(rid, labels[i], i, fl, ce))
        shafts = []
        if i < 3:
            shafts.append(Shaft(f'tower-shaft-{i}{i + 1}', ce - 0.1, z1 + 0.1, shaft_d[i], rid, f'tower-L{i + 1}'))
        # void starts just under the shell so the floor below (previous tier's roof) shows through
        v0 = fl if i == 0 else z0 - 0.1
        shells.append(Shell(
            f'tower-tier{i}', z0, z1, const_section(h, h, r), 0.6,
            voids=[(v0, ce)], rooms=[(rid, fl, ce)],
            openings=_arches(rid, SIDES, us, aw, fl, fl + sp),
            shafts=shafts))
        for side in SIDES:
            for k, u in enumerate(ribs):
                extras.append(_rib(f'tower-rib{i}-{side}{k}', side, u, h, z0 if i else 0.0, z1 - 0.05))
        extras.append(_cornice(f'tower-cornice{i}', h + 0.3, h + 0.3, r + 0.3, z1 - 0.45, z1 - 0.02))
        if i + 1 < len(tiers):
            nh, nr = tiers[i + 1][0], tiers[i + 1][1]
            terraces.append((f'tower-terrace{i}', i + 1, z1, (h, h, r), (nh, nh, nr)))
        # corners: buttress turrets at the base, pinnacles above
        c = h - r * 0.55
        for sx in (-1, 1):
            for sy in (-1, 1):
                if i == 0:
                    extras.append(_turret(f'tower-turret-{sx}{sy}', sx * (c + 0.15), sy * (c + 0.15), 1.1, 0.0, z1 + 0.8, 0.9))
                else:
                    extras.append(_turret(f'tower-pinnacle{i}-{sx}{sy}', sx * c, sy * c, 0.45, z1 - 0.4, z1 + 0.9, 0.7))
    # crown: a rounded square dome on the top tier, a little drum, a ball and a spike
    h3, z3 = tiers[-1][0], tiers[-1][3]
    crown_top = z3 + 4.6

    def crown(col):
        rings = []
        for k in range(10):
            t = k / 9
            hh = h3 * (1 - t ** 2.2) ** 0.55 + 0.4 * t
            rings.append((z3 + 4.6 * t, geom.rounded_rect(hh, hh, min(hh - 0.01, 0.8 + 1.2 * t))))
        return [geom.loft('tower-crown', rings, col)]
    extras.append(Extra('tower-crown', crown, None))
    z = crown_top - 0.2
    ball = [(0.0001 + 0.7 * math.sin(math.pi * k / 12), z + 2.0 - 0.7 * math.cos(math.pi * k / 12)) for k in range(1, 12)]
    extras.append(_finial('tower-finial', [(0.75, z), (0.62, z + 1.4), (0.9, z + 1.45)] + ball
                          + [(0.3, z + 2.65), (0.22, z + 3.6), (0.32, z + 3.8), (0.04, z + 6.2), (0.0, z + 6.4)]))
    return Building(
        'ceramic-tower', 'Ceramic Tower',
        'Pale blue-green glazed tower of four stepped tiers with round arches on every side, '
        'drip ribs, corner turrets, a rounded crown and a finial.',
        'tower', levels, rooms, shells, extras, terraces)


# --------------------------------------------------------------------------- temple

BODY_Z0, BODY_Z1 = 14.3, 32.0


def body_section(z):
    """Outer section of the temple's domed body: near-vertical, then drawing in to the lantern."""
    t = min(1.0, max(0.0, (z - BODY_Z0) / (BODY_Z1 - BODY_Z0)))
    h = 3.2 + 4.8 * (1 - t ** 3.2) ** 0.85
    return h, h, 0.14 * h + 0.4


def temple():
    levels = [(0, 0.6, 'pavilion'), (1, 14.3, 'body hall'), (2, 22.5, 'upper hall')]
    rooms = [Room('temple-L0', 'pavilion', 0, 0.6, 13.8),
             Room('temple-L1', 'body hall', 1, 14.3, 22.0),
             Room('temple-L2', 'upper hall', 2, 22.5, 35.5)]
    lantern_void = (2.4, 2.4, 0.5, 31.4, 35.5)
    pavilion = Shell(
        'temple-pavilion', 0.6, BODY_Z0, const_section(8.0, 8.0, 1.5), 0.7,
        voids=[(0.5, 13.8)], rooms=[('temple-L0', 0.6, 13.8)],
        openings=_arches('temple-L0', SIDES, (0.0,), 9.0, 0.6, 9.1),
        shafts=[Shaft('temple-shaft-01', 13.7, BODY_Z0 + 0.1, 3.6, 'temple-L0', 'temple-L1')])
    body_openings = []
    for side in ('-y', '+y'):
        body_openings += _arches('temple-L1', (side,), (0.0,), 3.4, 15.8, 18.6, 'window')
    for side in ('+x', '-x'):
        tag = side.replace('+', 'p').replace('-', 'm')
        body_openings.append(Opening(f'temple-L1-{tag}a', 'temple-L1', side, -1.9, 'circle', 3.2, 17.4, kind='window'))
        body_openings.append(Opening(f'temple-L1-{tag}b', 'temple-L1', side, 1.9, 'circle', 3.2, 18.7, kind='window'))
    for side in SIDES:
        tag = side.replace('+', 'p').replace('-', 'm')
        body_openings.append(Opening(f'temple-L2-{tag}', 'temple-L2', side, 0.0, 'circle', 3.2, 25.2, kind='window'))
    body = Shell(
        'temple-body', BODY_Z0, BODY_Z1, body_section, 0.6,
        voids=[(BODY_Z0 - 0.1, 22.0), (22.5, BODY_Z1 + 0.5)],
        rooms=[('temple-L1', BODY_Z0, 22.0), ('temple-L2', 22.5, BODY_Z1)],
        openings=body_openings,
        shafts=[Shaft('temple-shaft-12', 21.9, 22.6, 3.4, 'temple-L1', 'temple-L2')],
        extra_voids=[lantern_void], tapered=True)
    lantern = Shell(
        'temple-lantern', 31.5, 36.0, const_section(3.0, 3.0, 0.8), 0.6,
        voids=[], rooms=[('temple-L2', BODY_Z1, 35.5)],
        openings=_arches('temple-L2', SIDES, (0.0,), 2.6, 32.1, 33.95, 'window', prefix='temple-lantern'),
        extra_voids=[lantern_void])
    extras = [
        Extra('temple-plinth', lambda col: [geom.rr_prism('temple-plinth', 9.6, 9.6, 2.2, 0.0, 0.6, col)],
              None, 'clay'),
        _cornice('temple-belt', 8.35, 8.35, 1.8, BODY_Z0 - 0.35, BODY_Z0 + 0.2),
        _cornice('temple-lantern-cornice', 3.35, 3.35, 1.0, 35.75, 36.25),
        Extra('temple-step2', lambda col: [geom.rr_prism('temple-step2', 2.2, 2.2, 0.5, 36.0, 38.4, col)]),
        _cornice('temple-step2-cornice', 2.55, 2.55, 0.7, 38.15, 38.55),
        Extra('temple-step3', lambda col: [geom.rr_prism('temple-step3', 1.4, 1.4, 0.35, 38.4, 40.3, col)]),
        _cornice('temple-step3-cornice', 1.7, 1.7, 0.45, 40.1, 40.45),
        _finial('temple-spike', [(0.9, 40.3), (0.5, 41.4), (0.7, 41.65), (0.36, 42.0),
                                 (0.05, 44.8), (0.0, 45.0)]),
    ]
    # flared feet under the four legs
    for sx in (-1, 1):
        for sy in (-1, 1):
            fid = f'temple-foot-{sx}{sy}'
            extras.append(Extra(
                fid, (lambda fid, cx, cy: lambda col: [geom.rr_prism(fid, 2.0, 2.0, 0.6, 0.6, 1.8, col, cx, cy)])(fid, 6.4 * sx, 6.4 * sy),
                _box_obstacle(6.4 * sx, 6.4 * sy, 2.0, 2.0, 0.6, 1.8)))
    # corner ridges down the body (the pinched edges of the sculpture)
    for sx in (-1, 1):
        for sy in (-1, 1):
            rid = f'temple-ridge-{sx}{sy}'

            def ridge(col, rid=rid, sx=sx, sy=sy):
                rings = []
                for k in range(15):
                    z = BODY_Z0 + 0.1 + (BODY_Z1 - BODY_Z0 - 0.5) * k / 14
                    h, _, r = body_section(z)
                    w = 0.32 * (1 - 0.5 * k / 14)
                    # centred just inside the corner arc's midpoint, so half the ridge stands proud
                    cx = sx * ((h - r) + r * 0.707 - 0.05)
                    cy = sy * ((h - r) + r * 0.707 - 0.05)
                    rings.append((z, [(cx + w * math.cos(2 * math.pi * i / 10), cy + w * math.sin(2 * math.pi * i / 10)) for i in range(10)]))
                return [geom.loft(rid, rings, col)]
            extras.append(Extra(rid, ridge, None))
    return Building(
        'minaret-temple', 'Minaret Temple',
        'Darker blue glazed temple: four legs joined by tall arches, a domed body with round windows, '
        'a four-arched lantern, a stepped spire and a spike.',
        'temple', levels, rooms, [pavilion, body, lantern], extras)


ALL = {'ceramic-tower': tower, 'minaret-temple': temple}
