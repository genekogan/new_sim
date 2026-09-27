import pathlib,json,pycolmap,sys
ROOT=pathlib.Path('~/Mars'); BASE=ROOT/'docs/media/reconstruction/2026-campus'
images=BASE/'frames/orbit-march23'; out=BASE/'models/sfm-orbit';out.mkdir(exist_ok=True);db=out/'database.db'
ex=pycolmap.FeatureExtractionOptions();ex.max_image_size=2400;ex.num_threads=4;ex.sift.max_num_features=10000
reader=pycolmap.ImageReaderOptions();reader.camera_model='SIMPLE_RADIAL'
pycolmap.extract_features(db,images,camera_mode=pycolmap.CameraMode.SINGLE,reader_options=reader,extraction_options=ex,device=pycolmap.Device.cpu)
match=pycolmap.FeatureMatchingOptions();match.num_threads=4
pairs=pycolmap.SequentialPairingOptions();pairs.overlap=12;pairs.quadratic_overlap=True
pycolmap.match_sequential(db,matching_options=match,pairing_options=pairs,device=pycolmap.Device.cpu)
opts=pycolmap.IncrementalPipelineOptions();opts.num_threads=4;opts.random_seed=42
models=pycolmap.incremental_mapping(db,images,out,options=opts)
for k,r in models.items():
 r.write_text(out/str(k));r.export_PLY(out/f'{k}.ply');print(r.summary(),flush=True)
 (out/f'{k}_summary.json').write_text(json.dumps({'images':r.num_reg_images(),'points':r.num_points3D(),'reprojection_error_px':r.compute_mean_reprojection_error(),'mean_track_length':r.compute_mean_track_length()},indent=2))
