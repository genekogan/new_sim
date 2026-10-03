"""Building description shared by the mesh builder and the footprint writer.

A building is a set of Shells (hollow lofted rounded-rectangle masses whose
voids are rooms, pierced by openings and floor shafts) plus Extras (solid
ornament: turrets, ribs, cornices, finials) that may block movement. All
dimensions are metres in Blender coordinates (Z up, the front faces -Y).
"""
import math
from dataclasses import dataclass, field
from typing import Callable, Optional

# The floater envelope we design for (see BUILDINGS.md): a head up to 1.5 m across.
HEAD_DIAMETER = 1.5
# Every opening must leave a clear rectangle at least this wide and tall.
MIN_CLEAR = 2.2
FRAME = 0.15  # clear-rectangle inset from the opening edge


def const_section(hx, hy, r):
    return lambda z: (hx, hy, r)


@dataclass
class Opening:
    id: str
    room: str
    side: str            # '+x' | '-x' | '+y' | '-y'
    u: float             # offset along the side (counter-clockwise tangent)
    shape: str           # 'arch' | 'circle'
    width: float         # arch width or circle diameter
    sill: float          # arch: sill height; circle: centre height
    spring: float = 0.0  # arch: springing line height
    kind: str = 'door'   # 'door' (sill at the floor) | 'window'
    to: str = 'outside'

    def clear(self):
        """Largest axis-aligned rectangle (u-range, z-range) kept fully open, inset by FRAME."""
        r = self.width / 2
        if self.shape == 'circle':
            cw = self.width * 0.7
            hh = math.sqrt(r * r - (cw / 2) ** 2)
            return (self.u - cw / 2, self.u + cw / 2), (self.sill - hh, self.sill + hh)
        cw = self.width - 2 * FRAME
        top = self.spring + math.sqrt(r * r - (cw / 2) ** 2)
        return (self.u - cw / 2, self.u + cw / 2), (self.sill + (0 if self.kind == 'door' else FRAME), top)

    def open_rects(self, step=0.6):
        """The clear rectangle plus a staircase of thinner rectangles filling the rest of the
        opening (the arch head; a circle's top and bottom), each inset by FRAME. The footprint
        leaves gaps for all of them; only clear() is a portal."""
        (u0, u1), (c0, c1) = self.clear()
        rects = [(u0, u1, c0, c1)]
        lo, hi = self.z_range()
        r = self.width / 2
        centre = self.sill if self.shape == 'circle' else self.spring

        def half(z):
            dz = z - centre
            if self.shape == 'arch' and dz < 0:
                return r
            return math.sqrt(max(0.0, r * r - dz * dz))

        for a, b in ((c1, hi - FRAME), (lo + FRAME, c0)):
            n = math.ceil((b - a) / step - 1e-9) if b > a else 0
            for k in range(n):
                z0, z1 = a + (b - a) * k / n, a + (b - a) * (k + 1) / n
                w = min(half(z0), half(z1)) - FRAME
                if w > 0.15:
                    rects.append((self.u - w, self.u + w, z0, z1))
        return rects

    def z_range(self):
        r = self.width / 2
        if self.shape == 'circle':
            return self.sill - r, self.sill + r
        return self.sill, self.spring + r


@dataclass
class Shaft:
    id: str
    z0: float
    z1: float
    diameter: float
    below: str
    above: str
    x: float = 0.0
    y: float = 0.0


@dataclass
class Room:
    id: str
    label: str
    level: int
    floor: float
    ceiling: float


@dataclass
class Shell:
    id: str
    z0: float
    z1: float
    section: Callable[[float], tuple]       # outer (hx, hy, corner r) at height z
    thickness: float
    voids: list                              # [(z0, z1)] hollowed with the inner section
    rooms: list                              # [(room id, wall band z0, wall band z1)] for the footprint
    openings: list = field(default_factory=list)
    shafts: list = field(default_factory=list)
    extra_voids: list = field(default_factory=list)  # [(hx, hy, r, z0, z1)] constant voids shared with other shells
    material: str = 'glaze'
    tapered: bool = False

    def inner(self, z):
        hx, hy, r = self.section(z)
        t = self.thickness
        return hx - t, hy - t, max(0.3, r - t)

    def straight_half(self, side, z):
        hx, hy, r = self.section(z)
        return (hy if side in ('+x', '-x') else hx) - r


@dataclass
class Extra:
    """A solid ornament. build(collection) -> list of objects. obstacle: footprint prism or None."""
    id: str
    build: Callable
    obstacle: Optional[dict] = None   # {'c': (x, y), 'half': (hx, hy), 'yaw': 0, 'z0':, 'z1':}
    material: str = 'glaze'


@dataclass
class Building:
    id: str
    name: str
    description: str
    glaze: str                     # 'tower' | 'temple' -> glaze texture set
    levels: list                   # [(id, floor z, label)]
    rooms: list
    shells: list
    extras: list
    terraces: list = field(default_factory=list)  # [(id, level, z, outer (hx,hy,r), inner (hx,hy,r))]
