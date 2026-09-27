import pathlib,json,pycolmap,numpy as np
from scipy.spatial.transform import Rotation
b=pathlib.Path('<mars-media>/reconstruction/2026-campus');out=b/'models/sfm-campus-constrained';init=out/'native-initial';init.mkdir(parents=True,exist_ok=True);db=b/'models/sfm-campus-shared/database.db';a={p['file']:p for p in json.load(open(b/'models/campus-v1/poses.json'))};connection=pycolmap.Database.open(db);ims=connection.read_all_images();cams=connection.read_all_cameras();lines=[]
for c in cams:lines.append(f'{c.camera_id} SIMPLE_RADIAL {c.width} {c.height} '+ ' '.join(str(v) for v in c.params))
(init/'cameras.txt').write_text('\n'.join(lines)+'\n');lines=[]
for im in ims:
 if im.name not in a:continue
 p=a[im.name];R=np.diag([1,-1,-1])@Rotation.from_quat(p['rotation_xyzw']).as_matrix().T;t=-R@p['translation'];q=Rotation.from_matrix(R).as_quat();lines.append(f'{im.image_id} '+ ' '.join(str(v) for v in [q[3],*q[:3],*t])+f' {im.camera_id} {im.name}\n')
(init/'images.txt').write_text('\n'.join(lines)+'\n');(init/'points3D.txt').write_text('');connection.close();r=pycolmap.Reconstruction(init);op=pycolmap.IncrementalPipelineOptions();op.num_threads=4;op.ba_global_max_refinements=2;op.ba_global_max_num_iterations=50
result=pycolmap.triangulate_points(r,db,b/'frames/campus-march19',out/'0',options=op,refine_intrinsics=True);result.write_text(out/'0');(out/'0_summary.json').write_text(json.dumps({'method':'Fixed native camera poses; triangulated landmarks and refined intrinsics. Not an independent camera solve.','images':result.num_reg_images(),'points':result.num_points3D(),'reprojection_error_px':result.compute_mean_reprojection_error()},indent=2));print(result.summary())
