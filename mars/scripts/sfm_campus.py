import pathlib,json,pycolmap,sys
ROOT=pathlib.Path('~/Mars'); BASE=ROOT/'docs/media/reconstruction/2026-campus'
images=BASE/'frames/campus-march19'; out=BASE/'models/sfm-campus-shared';out.mkdir(exist_ok=True);db=out/'database.db'
ex=pycolmap.FeatureExtractionOptions();ex.max_image_size=2400;ex.num_threads=4;ex.sift.max_num_features=10000
reader=pycolmap.ImageReaderOptions();reader.camera_model='SIMPLE_RADIAL'
all_names=sorted(p.name for p in images.glob('*'))
for names,w,h in [([n for n in all_names if not n.startswith('photo_')],1920,1080),([n for n in all_names if n.startswith('photo_')],4000,2250)]:
 with pycolmap.Database.open(db) as connection:
  cid=connection.write_camera(pycolmap.Camera(model='SIMPLE_RADIAL',width=w,height=h,params=[2916.6672098364343*w/3840,w/2,h/2,-.00048322078558149886]))
 reader.existing_camera_id=cid
 pycolmap.extract_features(db,images,image_names=names,camera_mode=pycolmap.CameraMode.SINGLE,reader_options=reader,extraction_options=ex,device=pycolmap.Device.cpu)
match=pycolmap.FeatureMatchingOptions();match.num_threads=4
pairs=pycolmap.SequentialPairingOptions();pairs.overlap=12;pairs.quadratic_overlap=True
pycolmap.match_sequential(db,matching_options=match,pairing_options=pairs,device=pycolmap.Device.cpu)
names=sorted(p.name for p in images.glob('*')); photos=[n for n in names if n.startswith('photo_')]; video=[n for n in names if not n.startswith('photo_')]
links=[]
for a in photos:
 for b in video[::5]+photos:
  if a!=b:links.append(a+' '+b)
for i,a in enumerate(video):
 if i%5==0:
  for b in video[::10]:
   if a!=b:links.append(a+' '+b)
pair_file=out/'pairs.txt';pair_file.write_text('\n'.join(links));custom=pycolmap.ImportedPairingOptions();custom.match_list_path=str(pair_file)
pycolmap.match_image_pairs(db,matching_options=match,pairing_options=custom,device=pycolmap.Device.cpu)
opts=pycolmap.IncrementalPipelineOptions();opts.num_threads=4;opts.random_seed=42
models=pycolmap.incremental_mapping(db,images,out,options=opts)
for k,r in models.items():
 r.write_text(out/str(k));r.export_PLY(out/f'{k}.ply');print(r.summary(),flush=True)
 (out/f'{k}_summary.json').write_text(json.dumps({'images':r.num_reg_images(),'points':r.num_points3D(),'reprojection_error_px':r.compute_mean_reprojection_error(),'mean_track_length':r.compute_mean_track_length()},indent=2))
