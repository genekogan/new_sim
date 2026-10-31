// Entry 32 media (from entry 20's jukebox-media.mjs). Under load a recorded video's timeline stretches (frames are encoded
// at a fixed rate while the page renders slower), so it cannot carry wall-clock audio directly. Each frame's stamped
// depicted tick is mapped to wall time through the samples' (tick, time) pairs; frames are re-timed to that clock and the
// actual recorded WebAudio track (the inside visitor's page, wall time) is muxed unchanged. Uncut takes for both cameras
// plus normal-speed scene clips by marks.json; each file kept at most 15 MB (re-encoded to fit). Audio RMS around every
// depicted knock and lock contact is reported (media.json).
import {readFileSync,writeFileSync,mkdirSync,rmSync,statSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {decodeFrameStamp} from './frame-stamp.mjs';
import {knockContacts,HAND_REACH_SECONDS,LOCK_TURN_SECONDS} from '../../mars/viewer/engine/social/hand-actuator.ts';
const d=process.argv[2],ff='/opt/homebrew/bin/ffmpeg',x=JSON.parse(readFileSync(d+'/proof.json')),marks=x.marks,a=JSON.parse(readFileSync(d+'/audio-start.json'));
const S=x.samples.filter(Boolean),dt=S[0].dt;mkdirSync(d+'/clips',{recursive:true});
const wallOf=tick=>{let i=S.findIndex(s=>s.tick>=tick);if(i<0)i=S.length-1;if(i===0)i=1;const p=S[i-1],q=S[Math.min(i,S.length-1)];return p.at+(q.at-p.at)*((tick-p.tick)/Math.max(1e-6,q.tick-p.tick));};
const cams={inside:{video:d+'/continuous.webm',w:1440,h:1080},outside:{video:d+'/continuous-outside.webm',w:1120,h:840}};
for(const c of Object.values(cams)){const clock=decodeFrameStamp(c.video,d+'/stamp.gray');const keep=[];for(const f of clock.frames.filter(f=>f.tick>0))if(!keep.length||f.tick>keep.at(-1).tick&&f.tick-keep.at(-1).tick<40)keep.push(f);c.frames=keep;rmSync(d+'/stamp.gray',{force:true});}
const encode=(cam,name,t0,t1,crf=23,scale=1280)=>{const c=cams[cam],fr=c.frames.filter(f=>f.tick>=t0&&f.tick<=t1&&wallOf(f.tick)>=a.at);if(fr.length<2)return {name,skipped:true};
 const dir=d+'/retime-'+name;rmSync(dir,{recursive:true,force:true});mkdirSync(dir);
 execFileSync(ff,['-v','error','-y','-i',c.video,'-vf',`select='between(n\\,${fr[0].frame}\\,${fr.at(-1).frame})',crop=${c.w}:${c.h-12}:0:0,scale=${scale}:-2`,'-fps_mode','passthrough','-start_number',String(fr[0].frame),'-q:v','3',dir+'/f%05d.jpg']);
 const list=fr.map((f,i)=>`file 'f${String(f.frame).padStart(5,'0')}.jpg'\nduration ${(((fr[i+1]?wallOf(fr[i+1].tick):wallOf(f.tick)+40)-wallOf(f.tick))/1000).toFixed(4)}`).join('\n')+`\nfile 'f${String(fr.at(-1).frame).padStart(5,'0')}.jpg'\n`;writeFileSync(dir+'/list.txt',list);
 const off=(wallOf(fr[0].tick)-a.at)/1000,span=(wallOf(fr.at(-1).tick)-wallOf(fr[0].tick))/1000,o=`${d}/clips/${name}.mp4`;
 execFileSync(ff,['-v','error','-y','-f','concat','-safe','0','-i',dir+'/list.txt','-ss',String(off),'-t',String(span),'-i',d+'/actual-audio.webm','-map','0:v','-map','1:a','-vf','fps=25,format=yuv420p','-c:v','libx264','-preset','medium','-crf',String(crf),'-g','50','-movflags','+faststart','-c:a','aac','-b:a','128k','-shortest',o]);
 rmSync(dir,{recursive:true,force:true});const mb=statSync(o).size/1e6;if(mb>15)return crf<35?encode(cam,name,t0,t1,crf+4,scale):encode(cam,name,t0,t1,crf,Math.round(scale*.8/2)*2);
 return {name,cam,ticks:[t0,t1],seconds:+span.toFixed(1),mb:+mb.toFixed(2),crf,scale};};
const T0=S[0].tick,T1=S.at(-1).tick,out=[encode('inside','door-locks-inside-full',T0,T1),encode('outside','door-locks-outside-full',T0,T1)];
const scenes=[['1-owner-in','owner-in','inside'],['2-lock','owner-locks','inside'],['3-refused','refused','outside'],['4-knock','knock-outside','outside'],['4-knock','knock-inside','inside'],['5-answer','answer','inside'],['6-escape-following','escape-following','inside'],['7-key','key-outside','outside'],['8-solo-escape','solo-escape','inside']];
const order=['1-owner-in','2-lock','3-refused','4-knock','5-answer','6-escape-following','7-key','8-solo-escape','end'];
for(const [label,name,cam] of scenes){const m=marks.find(k=>k.label===label),n=marks.find(k=>k.label===order[order.indexOf(label)+1]);if(m)out.push(encode(cam,name,m.tick,n?n.tick:T1));}
// audio: RMS (100-4000 Hz) in 120 ms windows at each depicted knock / lock contact, against the 2 s before the motion began
const raw=execFileSync(ff,['-v','error','-i',d+'/actual-audio.webm','-af','highpass=f=60,lowpass=f=4000','-f','f32le','-ac','1','-ar','8000','pipe:1'],{maxBuffer:200e6}),N=raw.length/4;
const rms=(s0,s1)=>{let n=0,s=0;for(let i=Math.max(0,Math.floor(s0*8000));i<Math.min(N,s1*8000);i++){const v=raw.readFloatLE(i*4);s+=v*v;n++;}return Math.sqrt(s/Math.max(1,n));};
const rel=w=>(w-a.at)/1000,contacts=[];const seen=new Set();
for(const s of S)for(const b of s.bodies){const m=b.motion;if(!m?.op||seen.has(m.actionId))continue;seen.add(m.actionId);const at=t=>rel(wallOf(m.startTick+t/dt));const base=rms(at(-2.2),at(-.2));
 const times=m.op==='knock'?knockContacts():[HAND_REACH_SECONDS+LOCK_TURN_SECONDS*.85];
 for(const t of times){let best=0,bestAt=null;for(let k=-.1;k<=.25;k+=.01){const v=rms(at(t)+k,at(t)+k+.06);if(v>best){best=v;bestAt=k;}}contacts.push({op:m.op,who:b.id,depictedSecond:+at(t).toFixed(2),peakRms:+best.toFixed(4),peakLagSeconds:+(bestAt??0).toFixed(2),baselineRms:+base.toFixed(4),ratio:+(best/Math.max(1e-5,base)).toFixed(1)});}}
writeFileSync(d+'/media.json',JSON.stringify({out,contacts,note:'Videos re-timed to wall clock by frame-stamped ticks; audio is the actual WebAudio master tap of the inside page. Peak RMS in 60 ms windows from -0.1 to +0.25 s around each depicted contact (lag = window start), baseline = the 2 s before the motion.'},null,2));console.log(JSON.stringify({out,contacts},null,1));
