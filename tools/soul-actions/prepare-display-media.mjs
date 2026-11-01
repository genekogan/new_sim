// Fixture assets are owned Sim footage plus a small silent test-pattern loop.
import{execFileSync}from'node:child_process';import{mkdirSync,copyFileSync}from'node:fs';
const out='<team>/soul-actions/day-09/media',dest='apps/web/dist/assets',ff='/opt/homebrew/bin/ffmpeg';mkdirSync(out,{recursive:true});mkdirSync(dest,{recursive:true});
execFileSync(ff,['-v','error','-y','-ss','0.5','-i','<team>/soul-actions/artifacts/dusk-lamp/revision-02/soul-lamp-rear-left.mp4','-frames:v','1',out+'/display-proof.png']);
execFileSync(ff,['-v','error','-y','-f','lavfi','-i','testsrc2=size=320x240:rate=20','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-an','-movflags','+faststart',out+'/display-proof.mp4']);
for(const n of ['display-proof.png','display-proof.mp4'])copyFileSync(out+'/'+n,dest+'/'+n);
