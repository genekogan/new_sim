// Mechanical edit: retain only admitted act calls, including approach and gesture; cut model-thinking gaps.
import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
const out=process.argv[2],label=process.argv[3]??'mixed-switches',turn=JSON.parse(readFileSync(join(out,label+'.json'))),folder=join(out,'viewer'),video=join(folder,'raw-video',readdirSync(join(folder,'raw-video')).find(n=>n.endsWith('.webm'))),birth=statSync(video).birthtimeMs;
const starts=new Map(),segments=[];
for(const event of turn.stream){for(const c of event.message?.content??[]){if(c.type==='tool_use'&&c.name==='Bash'&&/node eden\.mjs act\s/.test(c.input?.command??''))starts.set(c.id,{at:event._rx,command:c.input.command});}for(const c of event.content??event.message?.content??[]){if(c.type==='tool_result'&&starts.has(c.tool_use_id)){const a=starts.get(c.tool_use_id);segments.push({start:Math.max(0,(a.at-birth)/1000-.35),end:(event._rx-birth)/1000+.7,command:a.command});}}}
// Claude user tool results live in message.content; tolerate that envelope explicitly.
if(!segments.length)for(const event of turn.stream)if(event.type==='user')for(const c of event.message?.content??[]){const a=starts.get(c.tool_use_id);if(a)segments.push({start:Math.max(0,(a.at-birth)/1000-.35),end:(event._rx-birth)/1000+.7,command:a.command});}
if(segments.length!==2)throw Error(`Expected exactly two switch action intervals; found ${segments.length}`);
const filter=segments.map((s,i)=>`[0:v]trim=start=${s.start}:end=${s.end},setpts=PTS-STARTPTS,scale=1120:-2[v${i}]`).join(';')+`;[v0][v1]concat=n=2:v=1:a=0[out]`;
execFileSync('ffmpeg',['-y','-i',video,'-filter_complex',filter,'-map','[out]','-c:v','libx264','-preset','veryfast','-crf','25','-an','-movflags','+faststart',join(folder,'playtest-tight.mp4')],{stdio:['ignore','ignore','ignore']});
writeFileSync(join(folder,'edit-receipt.json'),JSON.stringify({source:video,method:'CLI tool execution timestamps; idle reasoning intervals removed; approach and arm gesture retained at normal speed.',segments,totalSeconds:segments.reduce((n,s)=>n+s.end-s.start,0)},null,2));
execFileSync('ffmpeg',['-y','-ss',String(segments[0].end-1),' -i'.trim(),video,'-frames:v','1',join(folder,'contact.png')],{stdio:['ignore','ignore','ignore']});
console.log(JSON.stringify({segments,duration:segments.reduce((n,s)=>n+s.end-s.start,0)}));
