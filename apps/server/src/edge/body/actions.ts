import type {Entity,Program} from '@sim/engine-contract';
import type {EdgeCapability} from '../contract.ts';

export const isRigidBody=(e:Pick<Entity,'body'>|undefined)=>e?.body?.family==='floater';
const rigidVerbs=new Set(['go','walk','glide','stroll','wander','approach','go-near','hang-out','rest','hover','settle','gather','stand','turn','face','look','auto-face','follow','ask-to-stop','accept','decline','make']);
export function bodyVerbProblem(e:Entity|undefined,verb:string){
  if(!isRigidBody(e)||rigidVerbs.has(verb))return null;
  return {code:'body.unsupported',reason:`${e?.body?.type==='ceramic'?'Ceramic':'Floater'} bodies cannot ${verb}; try glide, hover, settle or turn.`};
}
export function bodyCapabilityProblem(e:Entity|undefined,c:EdgeCapability,steps?:Program['steps']){
  if(!isRigidBody(e))return null;
  // Information on a public object remains readable/writable; rides and physical hand actions are excluded.
  if(c.verb==='object'&&['read','respond','add-step','endorse','interest','uninterest','state','history','inspect'].includes(c.action??''))return null;
  const v=bodyVerbProblem(e,c.verb);if(v)return v;
  if(steps?.some(s=>!['walk_to','ambient_wander','face','wave','rest','gather','stand'].includes(s.verb)))return {code:'body.unsupported',reason:'This activity needs a humanoid body; try glide, hover, settle or turn.'};
  return null;
}
