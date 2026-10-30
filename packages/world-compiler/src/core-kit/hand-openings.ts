// Frozen v1 bytes stay intact. Prove one shared hand-operation on a door and a gate.
import vocab from './vocab.json' with {type:'json'};
import civic from './civic.json' with {type:'json'};
import type {DefInput} from '../schemas.ts';
const door=vocab.find(d=>d.name==='core-door')! as unknown as DefInput;
export const HAND_OPENINGS:DefInput[]=[door,civic.find(d=>d.name==='core-gate')! as unknown as DefInput].map(input=>{
  const d=structuredClone(input),gate=d.name==='core-gate',hinge=gate?-.56:-.5;
  const make=d.make as {kind:'gen';gen:string;args:{shapes:{role?:string;pivot?:number[]}[]}};
  for(const shape of make.args.shapes)if(shape.role==='door')shape.pivot=[hinge,0,0];
  return {...d,version:2,tags:[...(d.tags??[]),'hand-operated'],description:`${d.description} A Soul approaches and operates it by hand.`,
    actions:door.actions!.filter(a=>['open','close'].includes(a.name)).map(a=>({...structuredClone(a),label:a.label.replace('door',gate?'gate':'door')}))};
});
