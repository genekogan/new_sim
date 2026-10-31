// Entry 20 media (from entry 14's piano-media.mjs). Under load the recorded video's timeline stretches (frames are encoded at a fixed rate while the page
// renders slower), so it cannot carry wall-clock audio directly. Each video frame's stamped depicted tick is mapped to
// wall time through the samples' (tick, time) pairs; the frames are re-timed to that clock and the actual recorded
// WebAudio track (wall time) is muxed unchanged.
import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {decodeFrameStamp} from './frame-stamp.mjs';
const d=process.env.SOUL_JUKEBOX_MEDIA??'<team>/soul-actions/day-20/visual-01',ff='/opt/homebrew/bin/ffmpeg',x=JSON.parse(readFileSync(d+'/proof.json')),clock=decodeFrameStamp(d+'/continuous.webm',d+'/stamp.gray');
const S=x.samples.filter(Boolean),dt=S[0].dt,a=JSON.parse(readFileSync(d+'/audio-start.json'));
const wallOf=tick=>{let i=S.findIndex(s=>s.tick>=tick);if(i<0)i=S.length-1;if(i===0)i=1;const p=S[i-1],q=S[Math.min(i,S.length-1)];return p.at+(q.at-p.at)*((tick-p.tick)/Math.max(1e-6,q.tick-p.tick));};
const playing=S.filter(s=>s.on),t0=playing[0].tick,t1=playing.at(-1).tick;
const w0=S[0].at,w1=S.at(-1).at,fr=clock.frames.filter(f=>{const w=wallOf(f.tick);return w>=w0&&w<=w1;});
// a stamp can be misread in a compressed frame: keep frames whose tick advances by a plausible step (< 2 s)
const keep=[];for(const f of fr)if(!keep.length?true:f.tick>keep.at(-1).tick&&f.tick-keep.at(-1).tick<40)keep.push(f);
console.error('frames',fr.length,'kept',keep.length,keep[0]?.tick,keep.at(-1)?.tick);const dir=d+'/retime';rmSync(dir,{recursive:true,force:true});mkdirSync(dir);
execFileSync(ff,['-v','error','-y','-i',d+'/continuous.webm','-vf',`select='between(n\\,${keep[0].frame}\\,${keep.at(-1).frame})',crop=1440:1068:0:0,scale=1280:-2`,'-fps_mode','passthrough','-start_number',String(keep[0].frame),dir+'/f%05d.jpg']);
const list=keep.map((f,i)=>`file 'f${String(f.frame).padStart(5,'0')}.jpg'\nduration ${(((keep[i+1]?wallOf(keep[i+1].tick):wallOf(f.tick)+40)-wallOf(f.tick))/1000).toFixed(4)}`).join('\n')+`\nfile 'f${String(keep.at(-1).frame).padStart(5,'0')}.jpg'\n`;writeFileSync(dir+'/list.txt',list);
const audioOffset=(wallOf(keep[0].tick)-a.at)/1000,span=(wallOf(keep.at(-1).tick)-wallOf(keep[0].tick))/1000;
execFileSync(ff,['-v','error','-y','-f','concat','-safe','0','-i',dir+'/list.txt','-ss',String(audioOffset),'-t',String(span),'-i',d+'/actual-audio.webm','-map','0:v','-map','1:a','-vf','fps=25,format=yuv420p','-c:v','libx264','-preset','medium','-crf','21','-g','12','-movflags','+faststart','-c:a','aac','-b:a','160k','-shortest',d+'/jukebox.mp4']);
rmSync(dir,{recursive:true,force:true});
const raw=execFileSync(ff,['-v','error','-i',d+'/actual-audio.webm','-af','highpass=f=110,lowpass=f=1800','-f','f32le','-ac','1','-ar','8000','pipe:1'],{maxBuffer:50e6}),N=raw.length/4,env=[];
for(let i=0;i+80<=N;i+=80){let s=0;for(let j=i;j<i+80;j++){const v=raw.readFloatLE(j*4);s+=v*v;}env.push(Math.sqrt(s/80));}
const rms=(s0,s1)=>{let n=0,s=0;for(let i=Math.max(0,Math.floor(s0*8000));i<Math.min(N,s1*8000);i++){const v=raw.readFloatLE(i*4);s+=v*v;n++;}return Math.sqrt(s/Math.max(1,n));};
const rel=w=>(w-a.at)/1000,report={ticks:[t0,t1],clipSeconds:span,rmsBefore:rms(0,Math.max(.5,rel(wallOf(t0))-.2)),rmsPlaying:rms(rel(wallOf(t0))+1,rel(wallOf(t1))),rmsAfter:rms(rel(wallOf(t1))+0.6,rel(wallOf(t1))+1.6),
 note:'Video re-timed to wall clock by frame-stamped ticks; audio is the actual recorded WebAudio master tap. RMS windows: before = until the depicted switch-on, playing = 1 s after it to the switch-off, after = 0.6–1.6 s after the switch-off.'};
writeFileSync(d+'/media.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
