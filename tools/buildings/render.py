"""Offline preview renders (EEVEE, falls back to Cycles CPU)."""
import math

import bmesh
import bpy
from mathutils import Vector

import geom


def setup_scene(res=(1280, 960)):
    sc = bpy.context.scene
    try:
        sc.render.engine = 'BLENDER_EEVEE'
    except TypeError:
        sc.render.engine = 'BLENDER_EEVEE_NEXT'
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'JPEG'
    sc.render.image_settings.quality = 86
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    if sc.render.engine.startswith('BLENDER_EEVEE'):
        ee = sc.eevee
        for attr, val in (('taa_render_samples', 48), ('use_shadows', True), ('use_raytracing', True)):
            if hasattr(ee, attr):
                setattr(ee, attr, val)
    world = bpy.data.worlds.new('sky')
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes['Background']
    sky = nt.nodes.new('ShaderNodeTexSky')
    for st in ('MULTIPLE_SCATTERING', 'NISHITA', 'HOSEK_WILKIE'):
        try:
            sky.sky_type = st
            break
        except TypeError:
            continue
    if hasattr(sky, 'sun_elevation'):
        sky.sun_elevation = math.radians(38)
        sky.sun_rotation = math.radians(215)
    nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 0.35
    sc.world = world
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.2
    sun.angle = math.radians(2.5)
    so = bpy.data.objects.new('sun', sun)
    so.rotation_euler = (math.radians(52), 0, math.radians(215))
    sc.collection.objects.link(so)
    ground_mat = geom.flat_material('ground', (0.36, 0.40, 0.27, 1), 0.95)
    bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, -0.001))
    g = bpy.context.active_object
    g.name = 'ground'
    g.data.materials.append(ground_mat)
    return sc


def head(name, loc, col, diameter=1.5):
    """A scale proxy for a floating Little Martian head."""
    mat = bpy.data.materials.get('head') or geom.flat_material('head', (0.85, 0.42, 0.18, 1), 0.4)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=diameter / 2)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    col.objects.link(ob)
    return ob


def shot(path, eye, target, lens=32, clip=0.05):
    sc = bpy.context.scene
    cam = sc.camera
    if cam is None:
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
        sc.collection.objects.link(cam)
        sc.camera = cam
    cam.data.lens = lens
    cam.data.clip_start = clip
    cam.data.clip_end = 1000
    cam.location = Vector(eye)
    d = Vector(target) - Vector(eye)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def cutaway(ob, col, keep='-x'):
    """A copy of `ob` with the half facing the camera removed (plane x = 0)."""
    me = ob.data.copy()
    bm = bmesh.new()
    bm.from_mesh(me)
    no = Vector((1, 0, 0)) if keep == '-x' else Vector((0, -1, 0))
    geom_all = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom_all, plane_co=(0, 0, 0), plane_no=no, clear_outer=True)
    bm.to_mesh(me)
    bm.free()
    cut = bpy.data.objects.new(ob.name + '-cut', me)
    col.objects.link(cut)
    return cut
