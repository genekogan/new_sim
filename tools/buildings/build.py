"""Turn a Building description into one textured mesh object and a GLB."""
import bpy

import geom


def _samples(z0, z1, tapered, step=0.5):
    if not tapered:
        return [z0, z1]
    n = max(1, round((z1 - z0) / step))
    return [z0 + (z1 - z0) * k / n for k in range(n + 1)]


def _outer(shell, col):
    rings = [(z, geom.rounded_rect(*shell.section(z))) for z in _samples(shell.z0, shell.z1, shell.tapered)]
    return geom.loft(shell.id, rings, col)


def _void(shell, i, v0, v1, col):
    rings = [(z, geom.rounded_rect(*shell.inner(min(max(z, shell.z0), shell.z1))))
             for z in _samples(v0, v1, shell.tapered)]
    return geom.loft(f'{shell.id}-void{i}', rings, col)


def _cutters(shell, col):
    out = []
    for o in shell.openings:
        lo, hi = o.z_range()
        zs = [lo + (hi - lo) * k / 8 for k in range(9)]
        d_in = min(shell.inner(z)[0] for z in zs) - 0.3
        d_out = max(shell.section(z)[0] for z in zs) + 0.8
        prof = geom.opening_profile(o.shape, o.width, o.sill, o.spring)
        out.append(geom.wall_cutter(f'{o.id}-cut', prof, o.side, o.u, d_in, d_out, col))
    for s in shell.shafts:
        out.append(geom.cylinder(f'{s.id}-cut', s.diameter / 2, s.z0, s.z1, col, s.x, s.y, segs=40))
    return out


def build(b, materials, col, scratch):
    """Build every part of `b` into `col`, carve the shells, and join into one object."""
    parts = []
    for shell in b.shells:
        solid = _outer(shell, col)
        cutters = [_void(shell, i, v0, v1, scratch) for i, (v0, v1) in enumerate(shell.voids)]
        cutters += [geom.rr_prism(f'{shell.id}-xvoid{i}', hx, hy, r, z0, z1, scratch)
                    for i, (hx, hy, r, z0, z1) in enumerate(shell.extra_voids)]
        cutters += _cutters(shell, scratch)
        geom.carve(solid, cutters, scratch)
        geom.finish(solid, materials[shell.material], soften=True)
        parts.append(solid)
    for e in b.extras:
        for ob in e.build(col):
            geom.finish(ob, materials[e.material])
            parts.append(ob)
    return geom.join(b.name.replace(' ', ''), parts, col)


def export_glb(ob, path):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True,
        export_apply=True, export_texcoords=True, export_normals=True,
        export_materials='EXPORT', export_image_format='AUTO',
        export_extras=False, export_cameras=False, export_lights=False)
