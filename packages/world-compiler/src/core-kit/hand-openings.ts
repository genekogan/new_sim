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

/** A reachable casement reuses the same opening contact; the sill is above the standing floor. */
const windowInput=structuredClone(vocab.find(d=>d.name==='core-window')!) as unknown as DefInput;
const windowMake=windowInput.make as {kind:'gen';gen:string;args:{shapes:Record<string,unknown>[]}};
for(const shape of windowMake.args.shapes){
  if(['box','leaf','bloom'].includes(String(shape.tint))&&(shape.at as number[]|undefined)) (shape.at as number[])[2]*=-1;
  if(shape.tint==='sill'){(shape.at as number[])[2]=0;(shape.size as number[])[2]=.18;}
  if(shape.role==='door'&&shape.tint==='frame'&&shape.kind==='box'){(shape.at as number[])[2]=.02;(shape.size as number[])[2]=.02;}
  if(shape.tint==='frame'&&shape.kind==='extrude')shape.round=0;
}
windowInput.params!.variant={type:'enum',values:['square','arched'],default:'square',doc:'style variant'};
windowMake.args.shapes.push({kind:'sphere',at:[.34,.65,.08],r:.035,segments:8,tint:'brass',role:'door',pivot:[-.44,.65,.02]});
HAND_OPENINGS.push({...windowInput,version:2,tags:[...(windowInput.tags??[]),'hand-operated','wall-window'],description:'An inward-opening casement with an interior handle, a sill and an exterior flower box. A Soul approaches the reachable interior handle while standing on the floor. Square and arched variants.'});
