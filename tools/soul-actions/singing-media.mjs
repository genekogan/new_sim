// Entry 36 media (entry 26's duet-media.mjs): the recorded video's timeline stretches under load, so each video frame's
// stamped depicted tick (stamp.json from the day folder's stamps.py, which finds the stamp row even when the page laid out
// short) is mapped to wall time through the samples' (tick, time) pairs; frames are re-timed to that clock and the actual
// recorded WebAudio (wall time) is muxed unchanged. Writes clips/singing-full.mp4 (uncut) and phase clips by marks.
import {readFileSync,writeFileSync,mkdirSync,rmSync,statSync} from 'node:fs';import {execFileSync} from 'node:child_process';
const d=process.argv[2],ff='/opt/homebrew/bin/ffmpeg',x=JSON.parse(readFileSync(d+'/proof.json')),st=JSON.parse(readFileSync(d+'/stamp.json')),a=JSON.parse(readFileSync(d+'/audio-start.json'));
const S=x.samples.filter(Boolean);
const wallOf=tick=>{let i=S.findIndex(s=>s.tick>=tick);if(i<0)i=S.length-1;if(i===0)i=1;const p=S[i-1],q=S[Math.min(i,S.length-1)];return p.at+(q.at-p.at)*((tick-p.tick)/Math.max(1e-6,q.tick-p.tick));};
const w0=Math.max(S[0].at,a.at),w1=S.at(-1).at,fr=st.frames.filter(f=>{const w=wallOf(f.tick);return w>=w0&&w<=w1;});
const keep=[];for(const f of fr)if(!keep.length||f.tick>keep.at(-1).tick&&f.tick-keep.at(-1).tick<40)keep.push(f);
const crop=`crop=1440:${Math.min(st.height,(x.viewport?.h??1080))-14}:0:0`;
console.error('frames',fr.length,'kept',keep.length,keep[0]?.tick,keep.at(-1)?.tick);mkdirSync(d+'/clips',{recursive:true});const dir=d+'/retime';rmSync(dir,{recursive:true,force:true});mkdirSync(dir);
execFileSync(ff,['-v','error','-y','-i',d+'/continuous.webm','-vf',`select='between(n\\,${keep[0].frame}\\,${keep.at(-1).frame})',${crop},scale=1280:-2`,'-fps_mode','passthrough','-start_number',String(keep[0].frame),'-q:v','3',dir+'/f%05d.jpg']);
const list=keep.map((f,i)=>`file 'f${String(f.frame).padStart(5,'0')}.jpg'\nduration ${(((keep[i+1]?wallOf(keep[i+1].tick):wallOf(f.tick)+40)-wallOf(f.tick))/1000).toFixed(4)}`).join('\n')+`\nfile 'f${String(keep.at(-1).frame).padStart(5,'0')}.jpg'\n`;writeFileSync(dir+'/list.txt',list);
const t0w=wallOf(keep[0].tick),audioOffset=(t0w-a.at)/1000,span=(wallOf(keep.at(-1).tick)-t0w)/1000;
const enc=(out,crf)=>execFileSync(ff,['-v','error','-y','-f','concat','-safe','0','-i',dir+'/list.txt','-ss',String(audioOffset),'-t',String(span),'-i',d+'/actual-audio.webm','-map','0:v','-map','1:a','-vf','fps=25,format=yuv420p','-c:v','libx264','-preset','medium','-crf',String(crf),'-g','25','-movflags','+faststart','-c:a','aac','-b:a','192k','-shortest',out]);
let crf=22;enc(d+'/clips/singing-full.mp4',crf);while(statSync(d+'/clips/singing-full.mp4').size>14.5e6&&crf<34){crf+=3;enc(d+'/clips/singing-full.mp4',crf);}
rmSync(dir,{recursive:true,force:true});
// phase clips (cut from the uncut re-timed clip by the marks' wall times)
const at=label=>{const m=x.marks.find(m=>m.label===label);return m?(wallOf(m.tick)-t0w)/1000:null;};
const cut=(name,s0,s1)=>{if(s0===null||s1===null)return;s0=Math.max(0,s0);execFileSync(ff,['-v','error','-y','-ss',s0.toFixed(2),'-i',d+'/clips/singing-full.mp4','-t',(s1-s0).toFixed(2),'-c:v','libx264','-preset','medium','-crf','22','-c:a','aac','-b:a','192k','-movflags','+faststart',d+`/clips/${name}.mp4`]);};
const singing=at('bea-singing');cut('walk-to-mic-and-sing',singing-9,singing+14);cut('second-singer-refused',at('cal-refused')-5,at('cal-refused')+4);cut('stop-singing',at('stop-sent')-4,at('bea-stopped')+4);cut('music-stops',at('band-done')-6,at('bea-stopped-2')+4);
const report={clipSeconds:span,audioOffset,crf,frames:keep.length,marks:Object.fromEntries(x.marks.map(m=>[m.label,+((wallOf(m.tick)-t0w)/1000).toFixed(2)])),note:'Video re-timed to wall clock by frame-stamped ticks; audio is the actual recorded WebAudio master tap.'};
writeFileSync(d+'/media.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
