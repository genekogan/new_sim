// Entry 32: stills from a take at depicted ticks (frame-stamped), for either camera: node door-locks-stills.mjs <dir> <inside|outside> <tick>...
// into <dir>/look/<camera>-t<tick>.jpg (the bottom stamp row cropped).
import {mkdirSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {decodeFrameStamp} from './frame-stamp.mjs';
const [d,cam,...ticks]=process.argv.slice(2),ff='/opt/homebrew/bin/ffmpeg',video=d+(cam==='outside'?'/continuous-outside.webm':'/continuous.webm'),[w,h]=cam==='outside'?[1120,840]:[1440,1080];
const c=decodeFrameStamp(video,d+'/stamp-'+cam+'.gray'),fr=c.frames.filter(f=>f.tick>0);mkdirSync(d+'/look',{recursive:true});
for(const t of ticks.map(Number)){const f=fr.find(f=>f.tick>=t)??fr.at(-1);execFileSync(ff,['-v','error','-y','-i',video,'-vf',`select=eq(n\\,${f.frame}),crop=${w}:${h-12}:0:0`,'-frames:v','1','-q:v','3',`${d}/look/${cam}-t${t}.jpg`]);}
execFileSync('rm',['-f',d+'/stamp-'+cam+'.gray']);console.log('ok',ticks.length);
