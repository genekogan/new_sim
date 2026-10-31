// Entry 37 media (from entry 20's jukebox-media.mjs). Under load the recorded video's timeline stretches (frames are encoded
// at a fixed rate while the page renders slower), so each video frame's stamped depicted tick is mapped to wall time
// through the samples' (tick, time) pairs; the frames are re-timed to that clock and the actual recorded WebAudio track
// (wall time) is muxed unchanged. The stamp row is found at the page's own bottom (the page can lay out shorter than the
// video frame, day-39). The audio is then measured around every depicted flip: power on, each station change, power off.
import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';import {execFileSync} from 'node:child_process';
const d=process.env.SOUL_RADIO_MEDIA??'<team>/soul-actions/day-37/visual-01',ff='/opt/homebrew/bin/ffmpeg',x=JSON.parse(readFileSync(d+'/proof.json'));
const probe=JSON.parse(execFileSync('/opt/homebrew/bin/ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',d+'/continuous.webm'],{encoding:'utf8'})).streams[0];
function stamps(y){const b=execFileSync(ff,['-v','error','-i',d+'/continuous.webm','-vf',`crop=192:12:0:${y},scale=24:1:flags=area,format=gray`,'-f','rawvideo','-'],{maxBuffer:1e9}),frames=[];for(let i=0;i+24<=b.length;i+=24){const bits=Array.from(b.subarray(i,i+24),v=>v>127?1:0);if(bits.slice(0,4).join('')!=='1010')continue;let tick=0;for(const bit of bits.slice(4))tick=(tick<<1)|bit;frames.push({frame:i/24,tick});}return frames;}
const pageH=Math.min(probe.height,x.viewport?.h??probe.height);let stampY=pageH-12,frames=stamps(stampY);
if(frames.length<50)for(let y=probe.height-12;y>probe.height-200;y-=2){const f=stamps(y);if(f.length>frames.length){frames=f;stampY=y;}if(frames.length>200)break;}
writeFileSync(d+'/stamp.json',JSON.stringify({stampY,frames}));
const S=x.samples.filter(Boolean),a=JSON.parse(readFileSync(d+'/audio-start.json'));
const wallOf=tick=>{let i=S.findIndex(s=>s.tick>=tick);if(i<0)i=S.length-1;if(i===0)i=1;const p=S[i-1],q=S[Math.min(i,S.length-1)];return p.at+(q.at-p.at)*((tick-p.tick)/Math.max(1e-6,q.tick-p.tick));};
const w0=S[0].at,w1=S.at(-1).at,fr=frames.filter(f=>{const w=wallOf(f.tick);return w>=w0&&w<=w1;});
// a stamp can be misread in a compressed frame: keep frames whose tick advances by a plausible step (< 2 s)
const keep=[];for(const f of fr)if(!keep.length?true:f.tick>keep.at(-1).tick&&f.tick-keep.at(-1).tick<40)keep.push(f);
console.error('stampY',stampY,'frames',fr.length,'kept',keep.length,keep[0]?.tick,keep.at(-1)?.tick);const dir=d+'/retime';rmSync(dir,{recursive:true,force:true});mkdirSync(dir);
const cropH=Math.floor((stampY)/2)*2;
execFileSync(ff,['-v','error','-y','-i',d+'/continuous.webm','-vf',`select='between(n\\,${keep[0].frame}\\,${keep.at(-1).frame})',crop=1440:${cropH}:0:0,scale=1280:-2`,'-fps_mode','passthrough','-start_number',String(keep[0].frame),dir+'/f%05d.jpg']);
const list=keep.map((f,i)=>`file 'f${String(f.frame).padStart(5,'0')}.jpg'\nduration ${(((keep[i+1]?wallOf(keep[i+1].tick):wallOf(f.tick)+40)-wallOf(f.tick))/1000).toFixed(4)}`).join('\n')+`\nfile 'f${String(keep.at(-1).frame).padStart(5,'0')}.jpg'\n`;writeFileSync(dir+'/list.txt',list);
const audioOffset=(wallOf(keep[0].tick)-a.at)/1000,span=(wallOf(keep.at(-1).tick)-wallOf(keep[0].tick))/1000;
mkdirSync(d+'/clips',{recursive:true});
execFileSync(ff,['-v','error','-y','-f','concat','-safe','0','-i',dir+'/list.txt','-ss',String(audioOffset),'-t',String(span),'-i',d+'/actual-audio.webm','-map','0:v','-map','1:a','-vf','fps=25,format=yuv420p','-c:v','libx264','-preset','medium','-crf','22','-g','12','-movflags','+faststart','-c:a','aac','-b:a','160k','-shortest',d+'/clips/radio-full.mp4']);
rmSync(dir,{recursive:true,force:true});
// audio analysis: the recorded track at 16 kHz; band levels in 50 ms windows
const pcm=(af)=>{const raw=execFileSync(ff,['-v','error','-i',d+'/actual-audio.webm','-af',af,'-f','f32le','-ac','1','-ar','16000','pipe:1'],{maxBuffer:200e6});const v=new Float32Array(raw.buffer,raw.byteOffset,raw.length/4);return v;};
const full=pcm('highpass=f=110,lowpass=f=1800'),hi=pcm('highpass=f=2000,lowpass=f=6000');
const rms=(v,s0,s1)=>{let n=0,s=0;for(let i=Math.max(0,Math.floor(s0*16000));i<Math.min(v.length,s1*16000);i++){s+=v[i]*v[i];n++;}return Math.sqrt(s/Math.max(1,n));};
const rel=w=>(w-a.at)/1000;
// depicted flips, from the samples: on/off and station changes of the near radio
const flips=[];for(let i=1;i<S.length;i++){const p=S[i-1].radio,q=S[i].radio;if(!p||!q)continue;if(p.on!==q.on)flips.push({kind:q.on?'on':'off',tick:S[i].tick,at:S[i].at});else if(p.station!==q.station)flips.push({kind:'tune',from:p.station,to:q.station,tick:S[i].tick,at:S[i].at});}
const firstOn=flips.find(f=>f.kind==='on'),lastOff=flips.findLast(f=>f.kind==='off');
const report={stampY,frames:keep.length,clipSeconds:+span.toFixed(2),flips:flips.map(f=>({...f,videoS:+((wallOf(f.tick)-wallOf(keep[0].tick))/1000).toFixed(2)})),
 rmsBefore:firstOn?rms(full,0.3,rel(firstOn.at)-0.2):null,rmsAfter:lastOff?rms(full,rel(lastOff.at)+0.6,rel(lastOff.at)+2.5):null,
 tunes:flips.filter(f=>f.kind==='tune').map(f=>{const t=rel(f.at);return {to:f.to,hiBefore:rms(hi,t-1.6,t-0.1),hiStatic:rms(hi,t+0.1,t+0.6),hiAfter:rms(hi,t+1.2,t+3),staticRatio:rms(hi,t+0.1,t+0.6)/Math.max(1e-9,rms(hi,t-1.6,t-0.1)),stationRms:rms(full,t+1,t+4)};}),
 segments:[],note:'Video re-timed to wall clock by frame-stamped ticks; audio is the actual recorded WebAudio master tap. full = 110-1800 Hz, hi = 2-6 kHz. staticRatio = hi band 0.1-0.6 s after a depicted station change over the 1.5 s before it.'};
for(let i=0;i<flips.length;i++){const f=flips[i],n=flips[i+1];if(f.kind==='off')continue;const t0=rel(f.at)+1,t1=n?rel(n.at)-0.1:t0+3;report.segments.push({station:f.kind==='tune'?f.to:S.find(s=>s.at>=f.at)?.radio?.station,from:+t0.toFixed(2),to:+t1.toFixed(2),rms:rms(full,t0,t1),hi:rms(hi,t0,t1)});}
writeFileSync(d+'/media.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
