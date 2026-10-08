import {createScoreNamespace} from './runtime.mjs';
export const SCORE_REVISION='3b806f2084d5dcefcf9a2282828765657bd74220';
export const MAX_CYCLES=64; // Explicit bounded development performance, not indefinite radio.
const clone=value=>structuredClone(value);

/** Pure source composition with private, sequential memory. No Tone or global Sim. */
export function createComposition({pieceId,seed}={}) {
  if(!['starfield','zoning-board'].includes(pieceId))throw new Error('Unsupported qualification piece.');
  if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw new Error('Seed must be an unsigned 32-bit integer.');
  const sim=createScoreNamespace(undefined),piece=sim.pieces.find(p=>p.id===pieceId);
  const rng=sim.theory.rng(seed);let cycle=0,state={};
  function next(){
    if(cycle>=MAX_CYCLES)throw new Error('Development performance limit reached.');
    const result=piece.compose({cycle,rng:rng.fork(cycle),state,T:sim.theory})||{};
    if(result.tempo)throw new Error('Variable tempo is outside this qualification subset.');
    state=result.state??state;
    const frame=clone({sourceRevision:SCORE_REVISION,pieceId,seed,cycle,startBeat:cycle*piece.cycleBars*piece.beatsPerBar,bpm:piece.bpm,beatsPerBar:piece.beatsPerBar,cycleBars:piece.cycleBars,swing:piece.swing,events:result.events??[],harmony:result.harmony??[],section:result.section??'',state});
    cycle++;return frame;
  }
  return Object.freeze({next,position:()=>cycle});
}

/** Late-join composition replay only; does not seek or start audio. */
export function composeAt({pieceId,seed,cycle}){
  if(!Number.isSafeInteger(cycle)||cycle<0||cycle>=MAX_CYCLES)throw new Error('Cycle outside bounded development performance.');
  const composer=createComposition({pieceId,seed});let frame;
  for(let i=0;i<=cycle;i++)frame=composer.next();
  return frame;
}
