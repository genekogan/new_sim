// Finite one-pull bell. Frozen bell@1 retains its original play/stop contract.
import layers from './vocab-w2.json' with {type:'json'};
import type {DefInput} from '../schemas.ts';
const old=structuredClone(layers.find(d=>d.name==='core-bell')!) as unknown as DefInput;
const args=old.make.kind==='gen'?old.make.args as {shapes:Record<string,unknown>[]}:{shapes:[]};
export const HAND_BELL:DefInput={...old,version:2,description:'A bronze bell in a timber frame. Grasp and pull its rope once to ring it; repeat the ring action whenever needed. The arm and rope return to rest.',tags:[...(old.tags??[]),'hand-rung','local-fixture'],
 make:{kind:'gen',gen:'kit/2',args:{...args,shapes:args.shapes.map(s=>s.tint==='rope'?{kind:'cyl',at:[.375,1.475,.075],r:.012,h:.45,segments:5,tint:'rope',role:'rope',pivot:[.375,1.7,.075]}:s).concat([{kind:'sweep',at:[0,0,0],path:[[0,1.42,0],[.375,1.7,.075]],r:.012,segments:5,tint:'rope'},{kind:'sweep',at:[0,0,0],path:[[.6,1.7,0],[.375,1.7,.075]],r:.02,segments:5,tint:'iron'},{kind:'sphere',at:[.375,1.7,.075],r:.027,segments:6,tint:'iron'}])}},
 state:{rings:{type:'int',min:0,max:1000000000,default:0}},
 components:{...old.components,bell:{gripAt:[.375,1.25,.075],pullAngle:.4},sound:{kind:'bell',radius:40,volume:.7,when:'rings',mode:'change'}},
 actions:[{name:'ring',label:'Pull the bell rope once',roles:'anyone',reach:'touch',params:{},when:[{field:'rings',not:1000000000}],then:[{op:'increment',field:'rings',by:1}]}]};
