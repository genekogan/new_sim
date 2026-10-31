import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from _paths import media  # noqa: E402
"""Export existing licensed Quaternius sources with their original walk/idle clips.
Only presentation assets are written; editable campus geometry is unchanged.
"""
import bpy, pathlib, json
B=media('reconstruction/2026-campus/modular')
O=B/'deliverable/environment'; O.mkdir(exist_ok=True)
for name,source in [('casual','Casual_2.blend'),('punk','Punk.blend'),('woman','Woman_Casual.blend')]:
 bpy.ops.wm.open_mainfile(filepath=str(B/'research/appearance'/source))
 # glTF skin export does not apply constructive modifiers automatically.
 # Bake mirrored halves before the armature, preserving mirrored vertex groups.
 for mesh in [o for o in bpy.context.scene.objects if o.type=='MESH']:
  bpy.context.view_layer.objects.active=mesh
  for modifier in list(mesh.modifiers):
   if modifier.type=='MIRROR': bpy.ops.object.modifier_apply(modifier=modifier.name)
 arm=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
 arm.animation_data_create(); arm.animation_data.action=None
 for track in list(arm.animation_data.nla_tracks): arm.animation_data.nla_tracks.remove(track)
 for action in list(bpy.data.actions):
  if action.name not in ['Idle','Walk','Wave']: bpy.data.actions.remove(action)
 for action in bpy.data.actions:
  track=arm.animation_data.nla_tracks.new(); track.name=action.name
  strip=track.strips.new(action.name,int(action.frame_range[0]),action)
  track.mute=True
 bpy.context.scene.frame_set(0)
 bpy.ops.object.select_all(action='SELECT')
 bpy.ops.export_scene.gltf(filepath=str(O/f'animated-{name}.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_force_sampling=True)
 print('EXPORTED',name,flush=True)
(O/'animated-people-source.json').write_text(json.dumps({'source':'Quaternius Animated Humans','license':'CC0','source_url':'https://quaternius.com/packs/animatedhumans.html','derived_from':['Casual_2.blend','Punk.blend','Woman_Casual.blend'],'clips':['Idle','Walk','Wave'],'purpose':'Illustrative animated visitors, separate from editable layout and inventory'},indent=2))
