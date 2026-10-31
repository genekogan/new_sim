// Entry 31: stills from a take at depicted ticks (frame-stamped), into <dir>/look/t<tick>.jpg, and a labelled grid.
import {mkdirSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {decodeFrameStamp} from './frame-stamp.mjs';
const [d,...ticks]=process.argv.slice(2),ff='/opt/homebrew/bin/ffmpeg',c=decodeFrameStamp(d+'/continuous.webm',d+'/stamp.gray'),fr=c.frames.filter(f=>f.tick>0);mkdirSync(d+'/look',{recursive:true});
for(const t of ticks.map(Number)){const f=fr.find(f=>f.tick>=t)??fr.at(-1);execFileSync(ff,['-v','error','-y','-i',d+'/continuous.webm','-vf',`select=eq(n\\,${f.frame}),crop=1440:1068:0:0`,'-frames:v','1','-q:v','3',`${d}/look/t${t}.jpg`]);}
console.log('ok',ticks.length);
