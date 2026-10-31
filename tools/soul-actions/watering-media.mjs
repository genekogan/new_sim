// Entry 34 media (entry 28's tap-media.mjs): the recorded video re-timed to wall clock by its frame-stamped ticks, the
// actual recorded WebAudio muxed unchanged; clips cut from it by depicted tick; RMS of the audio before / while / after
// each pour.
import {readFileSync,writeFileSync,mkdirSync,rmSync,statSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {decodeFrameStamp} from './frame-stamp.mjs';
const d=process.env.SOUL_WATERING_MEDIA,ff='/opt/homebrew/bin/ffmpeg',x=JSON.parse(readFileSync(d+'/proof.json')),clock=decodeFrameStamp(d+'/continuous.webm',d+'/stamp.gray');
const S=x.samples.filter(Boolean),a=JSON.parse(readFileSync(d+'/audio-start.json'));
const wallOf=tick=>{let i=S.findIndex(s=>s.tick>=tick);if(i<0)i=S.length-1;if(i===0)i=1;const p=S[i-1],q=S[Math.min(i,S.length-1)];return p.at+(q.at-p.at)*((tick-p.tick)/Math.max(1e-6,q.tick-p.tick));};
const w0=S[0].at,w1=S.at(-1).at,fr=clock.frames.filter(f=>{const w=wallOf(f.tick);return w>=w0&&w<=w1;});
const keep=[];for(const f of fr)if(!keep.length?true:f.tick>keep.at(-1).tick&&f.tick-keep.at(-1).tick<400)keep.push(f);
const dir=d+'/retime';rmSync(dir,{recursive:true,force:true});mkdirSync(dir);
execFileSync(ff,['-v','error','-y','-i',d+'/continuous.webm','-vf',`select='between(n\\,${keep[0].frame}\\,${keep.at(-1).frame})',crop=1440:1068:0:0,scale=1280:-2`,'-fps_mode','passthrough','-start_number',String(keep[0].frame),dir+'/f%05d.jpg']);
const list=keep.map((f,i)=>`file 'f${String(f.frame).padStart(5,'0')}.jpg'\nduration ${(((keep[i+1]?wallOf(keep[i+1].tick):wallOf(f.tick)+40)-wallOf(f.tick))/1000).toFixed(4)}`).join('\n')+`\nfile 'f${String(keep.at(-1).frame).padStart(5,'0')}.jpg'\n`;writeFileSync(dir+'/list.txt',list);
const t0=wallOf(keep[0].tick),audioOffset=(t0-a.at)/1000,span=(wallOf(keep.at(-1).tick)-t0)/1000;mkdirSync(d+'/clips',{recursive:true});
execFileSync(ff,['-v','error','-y','-f','concat','-safe','0','-i',dir+'/list.txt','-ss',String(audioOffset),'-t',String(span),'-i',d+'/actual-audio.webm','-map','0:v','-map','1:a','-vf','fps=25,format=yuv420p','-c:v','libx264','-preset','medium','-crf','20','-g','25','-movflags','+faststart','-c:a','aac','-b:a','128k','-shortest',d+'/full.mp4']);
rmSync(dir,{recursive:true,force:true});
const at=tick=>(wallOf(tick)-t0)/1000,cut=(name,s0,s1,crf=23,scale=1280)=>{const o=d+'/clips/'+name+'.mp4';execFileSync(ff,['-v','error','-y','-ss',String(Math.max(0,s0)),'-to',String(s1),'-i',d+'/full.mp4','-vf',`scale=${scale}:-2`,'-c:v','libx264','-preset','medium','-crf',String(crf),'-movflags','+faststart','-c:a','aac','-b:a','128k',o]);return {name,s0:+s0.toFixed(2),s1:+s1.toFixed(2),mb:+(statSync(o).size/1e6).toFixed(2)};};
// the acts (by command wall time) and the uncut whole
const clips=[];x.commands.forEach((c,i)=>{const s0=(c.start-t0)/1000-1,s1=(c.end-t0)/1000+3;clips.push(cut(`water-${i+1}`,s0,s1));});
let whole=cut('whole-uncut',0,span,30,960);if(whole.mb>15)whole=cut('whole-uncut',0,span,34,854);clips.push(whole);
// audio RMS around each pour (planter `pouring`)
const raw=execFileSync(ff,['-v','error','-i',d+'/actual-audio.webm','-af','highpass=f=1100,lowpass=f=3400','-f','f32le','-ac','1','-ar','8000','pipe:1'],{maxBuffer:200e6}),N=raw.length/4;
const rms=(s0,s1)=>{let n=0,s=0;for(let i=Math.max(0,Math.floor(s0*8000));i<Math.min(N,s1*8000);i++){const v=raw.readFloatLE(i*4);s+=v*v;n++;}return +Math.sqrt(s/Math.max(1,n)).toFixed(5);};
const pours=[];let on=null;for(const s of S){const p=!!(s.st.rose?.pouring||s.st.herb?.pouring);if(p&&on===null)on=s.tick;if(!p&&on!==null){pours.push([on,s.tick]);on=null;}}
const rel=w=>(w-a.at)/1000,audio=pours.map(([p0,p1])=>({ticks:[p0,p1],before:rms(rel(wallOf(p0))-2.5,rel(wallOf(p0))-0.5),pouring:rms(rel(wallOf(p0))+0.3,rel(wallOf(p1))-0.1),after:rms(rel(wallOf(p1))+1.0,rel(wallOf(p1))+3.0)}));
const report={spanSeconds:+span.toFixed(1),clips,audio,note:'Video re-timed to wall clock by frame-stamped ticks; audio is the actual recorded WebAudio master tap.'};writeFileSync(d+'/media.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
