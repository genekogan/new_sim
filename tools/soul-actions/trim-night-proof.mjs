// Align from the recording's END, not WebM birthtime (Chrome can delay its first video frame).
import {readFileSync,writeFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';
const out=process.argv[2],proof=JSON.parse(readFileSync(out+'/proof.json')),input=out+'/continuous.webm';
const duration=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',input],{encoding:'utf8'}));
const endAt=proof.samples.at(-1).at,start=Math.max(0,duration-(endAt-proof.commands[0].start)/1000-.35);
execFileSync('ffmpeg',['-v','error','-y','-ss',String(start),'-i',input,'-vf','scale=1120:-2','-c:v','libx264','-crf','24','-preset','veryfast','-an','-movflags','+faststart',out+'/playtest-tight.mp4']);
const checks={};for(const name of ['reading-light','night-light']){const switches=proof.samples.filter((s,i)=>i&&s.lamps[name].on!==proof.samples[i-1].lamps[name].on);if(switches.length!==1)throw Error('Expected one transition for '+name);const s=switches[0];if((s.lamps[name].glow>0)!==s.lamps[name].on)throw Error('Bulb mismatch on switch frame');if(proof.samples.some(s=>(s.lamps[name].glow>0)!==s.lamps[name].on))throw Error('Bulb/state drift');checks[name]={state:s.lamps[name].on,atSeconds:(s.at-proof.commands[0].start)/1000,sourceCount:s.lights,body:s.residents};}
if(proof.errors.length)throw Error('Browser errors');
writeFileSync(out+'/acceptance.json',JSON.stringify({pass:true,night:'21:00 actual paused world clock; clear',method:'Existing paired Soul via ordinary CLI; actual full client. No new model seat. Cut only initial loading/idle; continuous approach/contact/off/on kept at normal speed.',video:{input,start,seconds:duration-start,alignment:'Recorded endpoint and sampled wall clock; avoids Chrome delayed-first-frame / file-birth mismatch.'},sampleIntervalMs:50,checks,errors:proof.errors},null,2));
console.log(JSON.stringify({start,seconds:duration-start,checks}));
