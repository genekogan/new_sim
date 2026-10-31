// Entry 36 voice lab: render the singing voice offline (the live voice.ts code, in a real Chrome OfflineAudioContext) along
// with a pianist's melody, alone and with the piano, to WAV files for listening and pitch tracking (voice-pitch.py).
// usage: node voice-lab.mjs <outDir> [seed] [t0] [seconds]
import {createRequire} from 'node:module';import {writeFileSync,mkdirSync} from 'node:fs';
const out=process.argv[2],seed=process.argv[3]??'h_a',t0=Number(process.argv[4]??96),secs=Number(process.argv[5]??16);mkdirSync(out,{recursive:true});
const require=createRequire(new URL('../../mars/viewer/package.json',import.meta.url)),{chromium}=require('@playwright/test');
const esbuild=await import(new URL('../../node_modules/.pnpm/node_modules/esbuild/lib/main.js',import.meta.url).href).catch(()=>import('esbuild'));
const entry=`import {makeSinger,micChain} from '${process.cwd()}/apps/web/src/gen-mesh/voice.ts';import {sungNotes,pianoNotes} from '${process.cwd()}/mars/viewer/app/engine-view/piano-score.ts';
window.render=async(seed,t0,secs,withPiano,room)=>{const rate=44100,off=new OfflineAudioContext(1,Math.ceil(rate*(secs+1.5)),rate),dest=room?micChain(off,off.destination):off.destination;const v=makeSinger(off,dest);v.out.gain.value=1;
const notes=sungNotes({seed,kind:'piano'},t0,t0+secs);for(const n of notes)v.schedule(n,0.25+n.t-t0,1);
if(withPiano){const tone=(at,f,dur,peak,type)=>{const o=off.createOscillator(),g=off.createGain();o.type=type;o.frequency.value=f;g.gain.setValueAtTime(0.0001,at);g.gain.exponentialRampToValueAtTime(peak,at+0.02);g.gain.exponentialRampToValueAtTime(0.0001,at+dur);o.connect(g).connect(off.destination);o.start(at);o.stop(at+dur+0.05);};
 for(const n of pianoNotes(seed,t0,t0+secs)){const f=440*2**((n.midi-69)/12),at=0.25+n.t-t0,pk=0.55*n.vel*0.5;tone(at,f,n.midi<60?1.8:1.3,pk,'triangle');tone(at,f*2,0.6,pk*0.22,'sine');}}
const buf=await off.startRendering();return {rate,notes,samples:Array.from(buf.getChannelData(0))};};`;
writeFileSync(out+'/entry.ts',entry);
const r=await esbuild.build({entryPoints:[out+'/entry.ts'],bundle:true,write:false,format:'iife',absWorkingDir:process.cwd(),loader:{'.ts':'ts'}});
const code=r.outputFiles[0].text.replace("./apps","./apps");
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();await page.goto('about:blank');await page.addScriptTag({content:code});
const wav=(samples,rate)=>{const n=samples.length,b=Buffer.alloc(44+n*2);b.write('RIFF',0);b.writeUInt32LE(36+n*2,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);let peak=0;for(const s of samples)peak=Math.max(peak,Math.abs(s));for(let i=0;i<n;i++)b.writeInt16LE(Math.max(-32767,Math.min(32767,Math.round(samples[i]*32767))),44+i*2);return {b,peak};};
for(const [name,withPiano,room] of [['voice-dry',false,false],['voice-mic',false,true],['voice-with-piano',true,true]]){const res=await page.evaluate(([s,t,d,p,rm])=>window.render(s,t,d,p,rm),[seed,t0,secs,withPiano,room]);const {b,peak}=wav(res.samples,res.rate);writeFileSync(`${out}/${name}.wav`,b);if(name==='voice-dry')writeFileSync(out+'/notes.json',JSON.stringify({seed,t0,start:0.25,notes:res.notes},null,1));let q=0;for(const s of res.samples)q+=s*s;console.log(name,'peak',peak.toFixed(3),'rms',Math.sqrt(q/res.samples.length).toFixed(4));}
await browser.close();
