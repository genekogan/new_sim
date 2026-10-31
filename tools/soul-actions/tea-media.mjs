// Entry 43 media (entry 34's watering-media.mjs): the continuous recording is cut by its frame-stamped ticks (normal speed,
// nothing re-timed), the actual recorded WebAudio (one recording before the world restart, one after) muxed at the ticks it
// started; clips per spoken act; the whole take uncut with both recordings; RMS of the kettle's voice before / while
// heating and boiling / after.
import {readFileSync,writeFileSync,mkdirSync,statSync,existsSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {decodeFrameStamp} from './frame-stamp.mjs';
const d=process.env.SOUL_TEA_MEDIA,ff='/opt/homebrew/bin/ffmpeg',x=JSON.parse(readFileSync(d+'/proof.json')),clock=decodeFrameStamp(d+'/continuous.webm',d+'/stamp.gray');
const S=x.samples.filter(Boolean),F=clock.frames;
// the restart: the longest gap between stamped frames splits the take into two segments
let gapAt=0,gap=0;for(let i=1;i<F.length;i++)if(F[i].seconds-F[i-1].seconds>gap){gap=F[i].seconds-F[i-1].seconds;gapAt=i;}
const segs=gap>5?[F.slice(0,gapAt),F.slice(gapAt)]:[F];
const vt=(tick,seg)=>{const fs=seg??(tick<=segs[0].at(-1).tick?segs[0]:segs.at(-1));const f=fs.find(f=>f.tick>=tick)??fs.at(-1);return f.seconds;};
const wallOf=tick=>{let i=S.findIndex(s=>s.tick>=tick);if(i<0)i=S.length-1;if(i===0)i=1;const p=S[i-1],q=S[Math.min(i,S.length-1)];return p.at+(q.at-p.at)*((tick-p.tick)/Math.max(1e-6,q.tick-p.tick));};
const tickOfWall=w=>{let best=S[0];for(const s of S)if(Math.abs(s.at-w)<Math.abs(best.at-w))best=s;return best.tick;};
mkdirSync(d+'/clips',{recursive:true});
const audio=[1,2].map(k=>existsSync(`${d}/audio-${k}.webm`)&&existsSync(`${d}/audio-${k}-start.json`)?{file:`${d}/audio-${k}.webm`,start:JSON.parse(readFileSync(`${d}/audio-${k}-start.json`)),seg:segs[k-1]}:null);
const vf='crop=1440:1068:0:0,scale=1280:-2';
const enc=(o,s0,s1,a,crf=23,scale=1280)=>{const args=['-v','error','-y','-ss',String(Math.max(0,s0)),'-to',String(s1),'-i',d+'/continuous.webm'];
 if(a){const va=vt(a.start.tick,a.seg);args.push(...(s0<va?['-itsoffset',String(va-s0)]:['-ss',String(s0-va)]),'-i',a.file);}
 args.push('-map','0:v',...(a?['-map','1:a']:[]),'-vf',`crop=1440:1068:0:0,scale=${scale}:-2,fps=25,format=yuv420p`,'-c:v','libx264','-preset','medium','-crf',String(crf),'-movflags','+faststart',...(a?['-c:a','aac','-b:a','128k','-shortest']:[]),o);
 execFileSync(ff,args);return +(statSync(o).size/1e6).toFixed(2);};
const clips=[];
// each spoken act, from a second before it to three after (in its own segment, with that segment's audio)
x.commands.forEach((c,i)=>{const t0=tickOfWall(c.start),t1=tickOfWall(c.end),k=t0<=segs[0].at(-1).tick?0:1,a=audio[k]&&audio[k].start.tick<=t0?audio[k]:null;
 const s0=vt(t0,segs[k])-1,s1=vt(t1,segs[k])+3,name=`${String(i+1).padStart(2,'0')}-${c.words.replace(/[^a-z]+/g,'-').replace(/^-|-$/g,'')}`;clips.push({name,s0:+s0.toFixed(2),s1:+s1.toFixed(2),audio:!!a,mb:enc(`${d}/clips/${name}.mp4`,s0,s1,a)});});
// the kettle heating, boiling and clicking off (from the switch press to 4 s after it switched itself off)
const heat=S.filter(s=>s.kettle?.heat),on=heat.find(s=>s.kettle.heat.phase==='heating'),off=heat.find(s=>on&&s.tick>on.tick&&s.kettle.heat.phase==='hot');
if(on&&off){const s0=vt(on.tick,segs[0])-3,s1=vt(off.tick,segs[0])+4;clips.push({name:'kettle-boils',s0:+s0.toFixed(2),s1:+s1.toFixed(2),audio:!!audio[0],mb:enc(`${d}/clips/kettle-boils.mp4`,s0,s1,audio[0])});}
// the restart: the last second before the stop and the first ten after the reload
if(segs.length>1){const s0=segs[0].at(-1).seconds-2,s1=segs[1][0].seconds+10;clips.push({name:'restart',s0:+s0.toFixed(2),s1:+s1.toFixed(2),audio:false,mb:enc(`${d}/clips/restart.mp4`,s0,s1,null,26,960)});}
// the whole take uncut, normal speed, both audio recordings at the times they were made
{const o=`${d}/clips/whole-uncut.mp4`,args=['-v','error','-y','-i',d+'/continuous.webm'],live=audio.filter(Boolean);for(const a of live)args.push('-i',a.file);
 const fl=live.map((a,i)=>`[${i+1}:a]adelay=${Math.round(vt(a.start.tick,a.seg)*1000)}|${Math.round(vt(a.start.tick,a.seg)*1000)}[a${i}]`).join(';');
 const run=crf=>{execFileSync(ff,[...args,...(live.length?['-filter_complex',fl+';'+live.map((_,i)=>`[a${i}]`).join('')+`amix=inputs=${live.length}:normalize=0[aout]`,'-map','0:v','-map','[aout]']:['-map','0:v']),'-vf','crop=1440:1068:0:0,scale=960:-2,fps=25,format=yuv420p','-c:v','libx264','-preset','medium','-crf',String(crf),'-movflags','+faststart','-c:a','aac','-b:a','96k',o]);return +(statSync(o).size/1e6).toFixed(2);};
 let mb=run(30);if(mb>15)mb=run(35);clips.push({name:'whole-uncut',s0:0,s1:+F.at(-1).seconds.toFixed(2),audio:live.length>0,mb});}
// RMS of the first recording: before the switch, heating, boiling, after the click (100 Hz-4 kHz)
let rms=null;
if(audio[0]&&on&&off){const a=audio[0],raw=execFileSync(ff,['-v','error','-i',a.file,'-af','highpass=f=100,lowpass=f=4000','-f','f32le','-ac','1','-ar','8000','pipe:1'],{maxBuffer:300e6}),N=raw.length/4,va=vt(a.start.tick,a.seg);
 const r=(s0,s1)=>{let n=0,s=0;for(let i=Math.max(0,Math.floor(s0*8000));i<Math.min(N,s1*8000);i++){const v=raw.readFloatLE(i*4);s+=v*v;n++;}return +Math.sqrt(s/Math.max(1,n)).toFixed(5);};
 const at=t=>vt(t,segs[0])-va,boil=heat.find(s=>s.tick>on.tick&&s.kettle.heat.phase==='boiling');
 rms={beforeSwitch:r(at(on.tick)-4,at(on.tick)-0.5),heatingEarly:r(at(on.tick)+1,at(on.tick)+8),heatingLate:boil?r(at(boil.tick)-8,at(boil.tick)-0.5):null,boiling:boil?r(at(boil.tick)+0.3,at(off.tick)-0.2):null,afterClick:r(at(off.tick)+1,at(off.tick)+4)};}
const report={segments:segs.map(s=>({from:+s[0].seconds.toFixed(2),to:+s.at(-1).seconds.toFixed(2),ticks:[s[0].tick,s.at(-1).tick]})),restartGapSeconds:+gap.toFixed(1),clips,rms,note:'Cut from continuous.webm by frame-stamped ticks at normal speed; audio is the actual recorded WebAudio master tap.'};
writeFileSync(d+'/media.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
