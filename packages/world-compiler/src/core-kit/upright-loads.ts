// Revision opt-in: old worlds keep their one-hand v1 behavior and collision map.
import props from './props.json' with {type:'json'};
import type {DefInput} from '../schemas.ts';
export const UPRIGHT_LOADS:DefInput[]=['core-crate','core-flower-pot'].map(name=>{
 const d=structuredClone(props.find(d=>d.name===name)!) as unknown as DefInput;
 return {...d,version:2,tags:[...(d.tags??[]),'upright-carry'],description:`${d.description} A two-hand load carried upright and set down on clear ground.`};
});
