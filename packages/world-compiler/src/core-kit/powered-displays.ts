// Physical power control reuses contact, with explicit local control geometry.
// Frozen screen/frame revisions retain their original media behavior.
import signage from './signage.json' with {type:'json'};
import vocab from './vocab.json' with {type:'json'};
import type {DefInput} from '../schemas.ts';
const switches=(vocab.find(d=>d.name==='core-desk-lamp')! as unknown as DefInput).actions!;
export const POWERED_DISPLAYS:DefInput[]=[
 ['core-screen',[1.15,1.25,.055],'screen'],
 ['core-picture-frame',[.41,.4,.035],'digital frame'],
].map(([name,controlAt,label])=>{
 const d=structuredClone(signage.find(d=>d.name===name)!) as unknown as DefInput;
 return {...d,version:2,description:`${d.description} A physical power switch blanks the display without losing its content.`,tags:[...(d.tags??[]),'hand-powered-display'],
  state:{...d.state,on:{type:'bool',default:true}},components:{...d.components,display:{...d.components!.display!,controlAt:controlAt as [number,number,number]}},
  actions:switches.map(a=>({...structuredClone(a),label:a.label.replace('desk lamp',String(label))}))};
});
