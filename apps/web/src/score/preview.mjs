import {createScoreNamespace} from './runtime.mjs';
import {createComposition} from './composition.mjs';
const owners=new WeakMap();

/** Short local development preview. No world cue, Transport, radio or action claim. */
export function createPreview(Tone,{onState=()=>{}}={}){
  if(!Tone||typeof Tone.start!=='function')throw new Error('Explicit Tone handle required.');
  const sim=createScoreNamespace(Tone);let generation=0,phase='idle',nodes=[],output=null,timer=null,disposed=false,muted=false,volume=0.5;
  const snapshot=()=>({phase,nodeCount:nodes.length,ownsPlayback:owners.get(Tone)===api,muted,volume});
  const publish=()=>{try{onState(snapshot());}catch{/* UI observer does not own playback. */}};
  function clear(){clearTimeout(timer);timer=null;output=null;for(const node of nodes.splice(0).reverse())try{node.dispose();}catch{/* dispose remaining nodes */}}
  function stop(){generation++;clear();if(owners.get(Tone)===api)owners.delete(Tone);phase=disposed?'disposed':'idle';publish();}
  function gain(){if(output)output.gain.rampTo(muted?0:volume,0.05);publish();}
  async function start({pieceId,seed,durationSeconds=4}={}){
    if(disposed)throw new Error('Preview disposed.');
    if(!globalThis.navigator?.userActivation?.isActive){if(owners.get(Tone)!==api)phase='gesture-required';publish();return {kind:'gesture-required'};}
    if(!Number.isFinite(durationSeconds)||durationSeconds<1||durationSeconds>8)throw new Error('Preview must last1–8 seconds.');
    const frame=createComposition({pieceId,seed}).next(); // Validate before audio/ownership mutation.
    owners.get(Tone)?.stop();owners.set(Tone,api);const ticket=++generation;phase='starting';publish();
    const current=()=>!disposed&&ticket===generation&&owners.get(Tone)===api;
    try{
      await Tone.start();if(!current())return {kind:'cancelled'};
      const piece=sim.pieces.find(p=>p.id===pieceId);
      output=new Tone.Gain(muted?0:volume).toDestination();nodes.push(output);
      const ctx={keep:n=>(nodes.push(n),n),out:output,I:sim.instruments,T:sim.theory,bpm:piece.bpm};
      const tracks=piece.instruments(ctx);
      await Promise.all(nodes.filter(n=>n?.ready instanceof Promise).map(n=>n.ready));
      if(!current())return {kind:'cancelled'};
      const startTime=Tone.now()+0.15,secondsPerBeat=60/piece.bpm;
      for(const event of frame.events){
        const track=tracks[event.track];if(!track)throw new Error('Unknown preview track.');
        const straight=event.bar*piece.beatsPerBar+event.beat;
        const beat=event.straight?straight:sim.swingBeat(straight,piece.swing,piece.swingUnit);
        const dur=event.straight?event.dur:sim.swingBeat(straight+event.dur,piece.swing,piece.swingUnit)-beat;
        const offset=beat*secondsPerBeat+(event.delay??0);if(offset>=durationSeconds)continue;
        // Grid preview deliberately omits original local-random humanization.
        track.play(startTime+Math.max(0,offset),{...event,vel:event.vel??0.75},Math.max(0.02,dur*secondsPerBeat));
      }
      phase='playing';publish();timer=setTimeout(()=>{if(current())stop();},(durationSeconds+0.15)*1000);
      return {kind:'playing'};
    }catch{
      if(!current())return {kind:'cancelled'};
      clear();owners.delete(Tone);phase='unavailable';publish();return {kind:'unavailable'};
    }
  }
  const api=Object.freeze({start,stop,snapshot,setMuted(value){muted=!!value;gain();},setVolume(value){if(!Number.isFinite(value)||value<0||value>1)throw new Error('Volume outside0–1.');volume=value;gain();},dispose(){disposed=true;stop();}});
  return api;
}
