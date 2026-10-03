"""Mesh primitives for the buildings (Blender, Z-up, metres).

Everything is built from a few clean primitives — lofted rounded rectangles,
arch and circle cutters, cylinders, cones — and shells are hollowed and pierced
with exact booleans (difference only; parts that touch are left as separate
interpenetrating pieces and joined, which keeps every boolean small and robust).
"""
import math

import bmesh
import bpy
from mathutils import Vector

CORNER_SEGS = 6
ARC_SEGS = 20
TILE = 7.0  # metres per glaze texture repeat


def rounded_rect(hx, hy, r, segs=CORNER_SEGS):
    """Counter-clockwise points of a rounded rectangle centred at the origin."""
    r = max(0.0, min(r, hx - 1e-3, hy - 1e-3))
    pts = []
    for cx, cy, a0 in ((hx - r, hy - r, 0), (-hx + r, hy - r, 90), (-hx + r, -hy + r, 180), (hx - r, -hy + r, 270)):
        for i in range(segs + 1):
            a = math.radians(a0 + 90 * i / segs)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def _new_object(name, bm, collection):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    collection.objects.link(ob)
    return ob


def loft(name, rings, collection, apex=None, cap_bottom=True, cap_top=True):
    """rings: [(z, [(x, y), ...])] with equal point counts, bottom to top."""
    bm = bmesh.new()
    loops = [[bm.verts.new((x, y, z)) for x, y in pts] for z, pts in rings]
    n = len(loops[0])
    for a, b in zip(loops, loops[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap_bottom:
        bm.faces.new(list(reversed(loops[0])))
    if apex is not None:
        tip = bm.verts.new(apex)
        top = loops[-1]
        for i in range(n):
            bm.faces.new((top[i], top[(i + 1) % n], tip))
    elif cap_top:
        bm.faces.new(loops[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _new_object(name, bm, collection)


def prism(name, pts, z0, z1, collection):
    return loft(name, [(z0, pts), (z1, pts)], collection)


def rr_prism(name, hx, hy, r, z0, z1, collection, cx=0.0, cy=0.0):
    pts = [(x + cx, y + cy) for x, y in rounded_rect(hx, hy, r)]
    return prism(name, pts, z0, z1, collection)


def rr_ring(name, outer, inner, z0, z1, collection):
    """A band between two rounded rectangles (hx, hy, r): a cornice around a wall."""
    a, b = rounded_rect(*outer), rounded_rect(*inner)
    bm = bmesh.new()
    lo_o = [bm.verts.new((x, y, z0)) for x, y in a]
    hi_o = [bm.verts.new((x, y, z1)) for x, y in a]
    lo_i = [bm.verts.new((x, y, z0)) for x, y in b]
    hi_i = [bm.verts.new((x, y, z1)) for x, y in b]
    n = len(a)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo_o[i], lo_o[j], hi_o[j], hi_o[i]))
        bm.faces.new((hi_i[i], hi_i[j], lo_i[j], lo_i[i]))
        bm.faces.new((hi_o[i], hi_o[j], hi_i[j], hi_i[i]))
        bm.faces.new((lo_i[i], lo_i[j], lo_o[j], lo_o[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _new_object(name, bm, collection)


def cylinder(name, radius, z0, z1, collection, cx=0.0, cy=0.0, segs=32):
    pts = [(cx + radius * math.cos(2 * math.pi * i / segs), cy + radius * math.sin(2 * math.pi * i / segs)) for i in range(segs)]
    return prism(name, pts, z0, z1, collection)


def lathe(name, profile, collection, cx=0.0, cy=0.0, segs=32):
    """Surface of revolution from [(radius, z)] bottom to top; radius 0 at the end closes to a point."""
    rings = []
    apex = None
    for r, z in profile:
        if r <= 1e-6:
            apex = (cx, cy, z)
            break
        rings.append((z, [(cx + r * math.cos(2 * math.pi * i / segs), cy + r * math.sin(2 * math.pi * i / segs)) for i in range(segs)]))
    return loft(name, rings, collection, apex=apex)


def opening_profile(shape, width, sill, spring=None):
    """Outline (u, z) of an opening in the plane of its wall, counter-clockwise.

    arch: a rectangle from the sill to the springing line, topped by a semicircle.
    circle: `sill` is the centre height and `width` the diameter.
    """
    r = width / 2
    if shape == 'circle':
        return [(r * math.cos(2 * math.pi * i / 32), sill + r * math.sin(2 * math.pi * i / 32)) for i in range(32)]
    pts = [(-r, sill), (r, sill)]
    for i in range(ARC_SEGS + 1):
        a = math.pi * i / ARC_SEGS
        pts.append((r * math.cos(a), spring + r * math.sin(a)))
    return pts


def wall_cutter(name, profile, side, u0, d_in, d_out, collection):
    """Extrude an opening outline through a wall facing `side` (+x, -x, +y, -y).

    u0 shifts the outline along the wall; d_in/d_out are distances from the
    building centre along the side normal where the cutter starts and ends.
    """
    nx, ny = {'+x': (1, 0), '-x': (-1, 0), '+y': (0, 1), '-y': (0, -1)}[side]
    tx, ty = -ny, nx  # tangent: counter-clockwise around the building
    bm = bmesh.new()
    loops = []
    for d in (d_in, d_out):
        loops.append([bm.verts.new((nx * d + tx * (u0 + u), ny * d + ty * (u0 + u), z)) for u, z in profile])
    n = len(profile)
    a, b = loops
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(list(reversed(a)))
    bm.faces.new(b)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _new_object(name, bm, collection)


def carve(target, cutters, scratch):
    """target -= union(cutters), exact solver; cutters are deleted afterwards."""
    if not cutters:
        return target
    col = bpy.data.collections.new(target.name + '-cut')
    scratch.children.link(col)
    for c in cutters:
        for uc in list(c.users_collection):
            uc.objects.unlink(c)
        col.objects.link(c)
    mod = target.modifiers.new('carve', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    mod.operand_type = 'COLLECTION'
    mod.collection = col
    mod.use_self = True
    dg = bpy.context.evaluated_depsgraph_get()
    ev = target.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    old = target.data
    target.modifiers.clear()
    target.data = me
    bpy.data.meshes.remove(old)
    for c in list(col.objects):
        bpy.data.objects.remove(c)
    bpy.data.collections.remove(col)
    return target


def box_uv(ob, tile=TILE):
    """World-space box projection: each face takes the two axes across its dominant normal."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for loop in f.loops:
            co = ob.matrix_world @ loop.vert.co
            if ax == 2:
                u, v = co.x, co.y
            elif ax == 0:
                u, v = co.y * (1 if n.x > 0 else -1), co.z
            else:
                u, v = co.x * (-1 if n.y > 0 else 1), co.z
            loop[uv].uv = (u / tile, v / tile)
    bm.to_mesh(me)
    bm.free()


def bevel(ob, width=0.07, segments=2, angle=50):
    """Soften sharp edges (arch reveals, slab edges) the way glaze rounds a fired edge."""
    mod = ob.modifiers.new('bevel', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(angle)
    mod.use_clamp_overlap = True
    mod.harden_normals = True  # keeps big flat faces flat-shaded next to the rounded edge
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)


def finish(ob, material, soften=False):
    """Clean up a carved part: weld, drop loose bits, (bevel), UVs, smooth-by-angle, material."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-5)
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.shade_smooth()
    ob.data.set_sharp_from_angle(angle=math.radians(40))
    if soften:
        bevel(ob)
    box_uv(ob)
    ob.data.materials.clear()
    ob.data.materials.append(material)


def join(name, objects, collection):
    """Join objects into one mesh object (keeps per-face materials)."""
    bm = bmesh.new()
    mats = []
    for ob in objects:
        me = ob.data.copy()
        me.transform(ob.matrix_world)
        remap = {}
        for i, m in enumerate(me.materials):
            if m not in mats:
                mats.append(m)
            remap[i] = mats.index(m)
        for p in me.polygons:
            p.material_index = remap.get(p.material_index, 0)
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    out = bpy.data.meshes.new(name)
    bm.to_mesh(out)
    bm.free()
    for m in mats:
        out.materials.append(m)
    ob = bpy.data.objects.new(name, out)
    collection.objects.link(ob)
    for o in objects:
        bpy.data.objects.remove(o)
    return ob


def glaze_material(name, colour_path, normal_path, roughness=0.32):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(colour_path, check_existing=True)
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    ntex = nt.nodes.new('ShaderNodeTexImage')
    ntex.image = bpy.data.images.load(normal_path, check_existing=True)
    ntex.image.colorspace_settings.name = 'Non-Color'
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nmap.inputs['Strength'].default_value = 0.5
    nt.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = roughness
    return mat


def flat_material(name, rgba, roughness=0.8):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = rgba
    bsdf.inputs['Roughness'].default_value = roughness
    return mat


def to_engine(p):
    """Blender (x, y, z) Z-up -> engine/glTF (x, y, z) Y-up: (x, z, -y)."""
    return (p[0], p[2], -p[1])


def vec(*a):
    return Vector(a)
