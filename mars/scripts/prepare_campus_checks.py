import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from _paths import media,mars_root  # noqa: E402
import pathlib,subprocess,json
BASE=media('reconstruction/2026-campus');root=mars_root();folder=BASE/'validation/holdout-campus/images';folder.mkdir(parents=True,exist_ok=True);rows=[]
for clip,times in [('DJI_0002',[25,55,125,175,373,435,481]),('DJI_0014',[15,95,321])]:
 for t in times:
  name=f'{clip}_{t:04}.jpg';src=root/f'media/drone/2026/{clip}.MP4';dest=folder/name
  if not dest.exists():subprocess.run(['ffmpeg','-v','error','-ss',str(t),'-i',str(src),'-frames:v','1','-q:v','2','-y',str(dest)],check=True)
  rows.append({'file':name,'source':str(src.relative_to(root)),'timestamp_seconds':t})
(folder.parent/'sources.json').write_text(json.dumps(rows,indent=2));print('Withheld',len(rows))
