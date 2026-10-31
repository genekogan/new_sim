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

// Soul Actions entry 32: a lockable hand-operated door. door@2 plus a lock (front: brass escutcheon and keyhole, where the
// owner's key turns; back: a rim lock with a thumb-turn and a bolt that slides across into a keeper on the frame), a knob
// on both faces, and lock / unlock / knock. Its front (+z, where the leaf swings) faces out; the back is the inside.
// The lock's moving parts (roles bolt, thumb, key) ride on the leaf; the viewer turns and slides them with the hand.
const door2=HAND_OPENINGS[0]!,brass='brass',iron='#34302b',dark='#17140f',leaf={role:'door' as const,pivot:[-.5,0,0]};
const lockShapes=[
  {kind:'sphere',at:[.38,1.04,-.07],r:.035,segments:5,tint:brass,...leaf},
  {kind:'box',at:[.38,.9,.034],size:[.045,.085,.008],round:0,tint:brass,...leaf},
  {kind:'box',at:[.38,.893,.0385],size:[.01,.032,.002],round:0,color:dark,...leaf},
  {kind:'box',at:[.375,.9,-.047],size:[.13,.1,.034],round:0,color:iron,...leaf},
  {kind:'sphere',at:[.35,.9,-.066],r:.019,segments:6,scale:[1,1,.45],tint:brass,...leaf},
  {kind:'box',at:[.35,.9,-.075],size:[.013,.046,.014],round:0,tint:brass,role:'thumb',pivot:[.35,.9,-.075]},
  {kind:'box',at:[.44,.91,-.047],size:[.04,.022,.018],round:0,tint:brass,role:'bolt',pivot:[.44,.91,-.047]},
  {kind:'box',at:[.38,.9,.052],size:[.007,.007,.03],round:0,tint:brass,role:'key',pivot:[.38,.9,.04]},
  {kind:'box',at:[.38,.9,.071],size:[.034,.022,.006],round:0,tint:brass,role:'key',pivot:[.38,.9,.04]},
  {kind:'box',at:[.535,.91,-.047],size:[.04,.05,.034],round:0,color:iron},
];
const vocabDoor=vocab.find(d=>d.name==='core-door')! as unknown as DefInput;
export const LOCKABLE_DOOR:DefInput=(()=>{const d=structuredClone(door2) as DefInput&{make:{args:{shapes:unknown[]}}};
  d.make.args.shapes=[...d.make.args.shapes,...structuredClone(lockShapes)];
  return {...d,version:3,tags:[...(d.tags??[]).filter(t=>t!=='hand-operated'),'hand-operated','lockable'],
    description:`${vocabDoor.description} A Soul approaches and operates it by hand; its owner locks it with a key from outside or the thumb-turn inside, anyone inside can always open it with the thumb-turn, and a Soul outside can knock.`,
    actions:[...structuredClone(vocabDoor.actions!),{name:'knock',label:'Knock on the door',roles:'anyone',reach:'touch',params:{},when:[{field:'open',is:false}],then:[{op:'set',field:'open',value:false}]}]} as DefInput;})();
