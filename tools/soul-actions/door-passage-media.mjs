// Entry 31 media: the uncut continuous take as H.264, and normal-speed clips per scene cut by frame-stamped depicted ticks
// (marks.json), with the bottom stamp row cropped. Each file is re-encoded to stay at most 15 MB.
import {readFileSync,statSync,mkdirSync,rmSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {decodeFrameStamp} from './frame-stamp.mjs';
const d=process.argv[2],ff='/opt/homebrew/bin/ffmpeg',marks=JSON.parse(readFileSync(d+'/marks.json')),clock=decodeFrameStamp(d+'/continuous.webm',d+'/stamp.gray');
const frames=clock.frames.filter(f=>f.tick>0),fps=clock.fps??25;mkdirSync(d+'/clips',{recursive:true});
const frameAt=tick=>{const f=frames.find(f=>f.tick>=tick);return f?f.frame:frames.at(-1).frame;};
const encode=(name,from,to,crf=23)=>{const o=`${d}/clips/${name}.mp4`;const args=['-v','error','-y','-i',d+'/continuous.webm','-vf',`select='between(n\\,${from}\\,${to})',setpts=N/(${fps}*TB),crop=1440:1068:0:0,scale=1280:-2,format=yuv420p`,'-r',String(fps),'-c:v','libx264','-preset','medium','-crf',String(crf),'-movflags','+faststart','-an',o];
 execFileSync(ff,args);const mb=statSync(o).size/1e6;if(mb>15&&crf<40)return encode(name,from,to,crf+4);return {name,frames:[from,to],seconds:+((to-from+1)/fps).toFixed(1),mb:+mb.toFixed(2),crf};};
const out=[encode('door-passage-full',frames[0].frame,frames.at(-1).frame)];
const scenes=[['1-in','in'],['2-contention','contention'],['3-out','out'],['4-following','following'],['5-locked','locked']];
for(let i=0;i<scenes.length;i++){const m=marks.find(x=>x.label===scenes[i][0]),n=marks.find(x=>x.label===(scenes[i+1]?.[0]??'end'));if(m&&n)out.push(encode(scenes[i][1],frameAt(m.tick),frameAt(n.tick)));}
rmSync(d+'/stamp.gray',{force:true});console.log(JSON.stringify({fps,out},null,1));
