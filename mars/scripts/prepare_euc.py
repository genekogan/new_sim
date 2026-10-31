import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from _paths import media  # noqa: E402
"""Adapt the CC BY 4.0 Thingiverse EUC printable mesh for the simulation."""
import bpy, pathlib, math, json
from mathutils import Vector
B=media('reconstruction/2026-campus/modular');p=B/'research/appearance/euc';out=B/'deliverable/environment'
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def mat(n,c,metal=0):
 m=bpy.data.materials.new(n);m.diffuse_color=(*c,1);m.use_nodes=True;s=m.node_tree.nodes.get('Principled BSDF');s.inputs['Base Color'].default_value=(*c,1);s.inputs['Metallic'].default_value=metal;s.inputs['Roughness'].default_value=.5;return m
shell=mat('EUC pearl shell',(.68,.73,.73),.3);rubber=mat('EUC rubber',(.025,.03,.032));alloy=mat('EUC alloy',(.12,.15,.18),.7)
bpy.ops.object.empty_add();root=bpy.context.object;root.name='Electric unicycle · single wheel and side pedals';root['source']='https://www.thingiverse.com/thing:3001166';root['author']='Qwertzu1029';root['license']='CC BY 4.0';root['modifications']='Assembled, scaled, recoloured, pedals and headlamp added; illustrative vehicle, not campus inventory'
bpy.ops.object.empty_add(location=(0,0,.2185));wheel=bpy.context.object;wheel.name='EUC_Wheel';wheel.parent=root
for file,n,m,center in [('Pièce1.STL','EUC hub',alloy,10),('Pièce3.STL','EUC tire',rubber,11.5)]:
 bpy.ops.wm.stl_import(filepath=str(p/file));o=bpy.context.object;o.name=n;o.parent=wheel
 for v in o.data.vertices:
  x,y,z=v.co;v.co=((z-3)*.019,(x-center)*.019,(y-center)*.019)
 o.data.materials.append(m)
for side in [-1,1]:
 bpy.ops.wm.stl_import(filepath=str(p/'Pièce4x2.STL'));o=bpy.context.object;o.name='EUC shell '+str(side);o.parent=root
 for v in o.data.vertices:
  x,y,z=v.co;v.co=(side*(.04+z*.009),(x-14)*.019,(y+2.5)*.019)
 o.data.materials.append(shell)
 # Recalculate normals after mirroring the side panel.
 bpy.context.view_layer.objects.active=o;bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
 bpy.ops.mesh.primitive_cube_add(size=1,location=(side*.17,0,.115));pedal=bpy.context.object;pedal.name='EUC side pedal '+str(side);pedal.dimensions=(.15,.26,.025);pedal.parent=root;pedal.data.materials.append(alloy);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 for i in range(7):
  bpy.ops.mesh.primitive_cube_add(size=1,location=(side*.17,(i-3)*.032,.131));o=bpy.context.object;o.dimensions=(.13,.009,.008);o.parent=root;o.data.materials.append(rubber)
# White front light is at forward -Y (glTF +Z).
light=mat('EUC headlamp',(.9,.93,1));light.node_tree.nodes.get('Principled BSDF').inputs['Emission Color'].default_value=(.7,.85,1,1);light.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value=2
bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,location=(0,-.23,.38));o=bpy.context.object;o.name='EUC headlamp';o.scale=(.04,.018,.025);o.parent=root;o.data.materials.append(light)
bpy.ops.object.select_all(action='SELECT');bpy.ops.export_scene.gltf(filepath=str(out/'electric-unicycle.glb'),export_format='GLB',export_animations=False)
(out/'euc-source.json').write_text(json.dumps({'title':'Electric Unicycle model - Monoroue électrique','author':'Qwertzu1029 (originally indexed as CPS007)','source_url':root['source'],'license':'CC BY 4.0','license_url':'https://creativecommons.org/licenses/by/4.0/','modifications':root['modifications'],'parts':['Pièce1.STL','Pièce3.STL','Pièce4x2.STL'],'height_m':.664,'wheel_diameter_m':.437},indent=2))
