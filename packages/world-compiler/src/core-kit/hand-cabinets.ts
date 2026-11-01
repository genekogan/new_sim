import storage from './vocab-w3.json' with {type:'json'};
import type {DefInput} from '../schemas.ts';
const box=(at:number[],size:number[],tint:string)=>({kind:'box',at,size,round:0,tint});
/** Operable furniture needs a hollow visual shell, while retaining a solid native footprint. */
export const HAND_CABINETS:DefInput[]=['core-lockers','core-drinks-fridge'].map(name=>{
 const d=structuredClone(storage.find(d=>d.name===name)!) as unknown as DefInput,locker=name==='core-lockers';
 const make=d.make as {kind:'gen';gen:string;args:{v?:number;shapes:Record<string,unknown>[]}};
 if(!locker)make.args.v=2;
 const half=locker?.455:.35,height=locker?1.77:1.94,depth=locker?.42:.65,z=locker?0:-.025,tint=locker?'paint':'body';
 make.args.shapes=make.args.shapes.filter(s=>s.kind!=='extrude');
 make.args.shapes.push(box([-half+.01,height/2,z],[.02,height,depth],tint),box([half-.01,height/2,z],[.02,height,depth],tint),box([0,height/2,z-depth/2+.01],[2*half-.02,height,.02],tint),box([0,.04,z],[2*half,.02,depth],tint),box([0,height-.01,z],[2*half,.02,depth],tint));
 if(locker)for(const x of [-.155,.155])make.args.shapes.push(box([x,height/2,z],[.02,height,depth],tint));
 else{for(const s of make.args.shapes)if(['inside','dark'].includes(String(s.tint))){(s.at as number[])[2]=-.305;(s.size as number[])[2]=.01;}for(const y of [.32,.72,1.12,1.52])make.args.shapes.push(box([0,y,0],[.62,.02,.59],'inside'));}
 if(!locker)for(const s of make.args.shapes)if(s.role==='door'&&s.tint==='glass')s.material='glass';
 for(const s of make.args.shapes)if(s.role==='door'&&s.tint==='chrome')(s.at as number[])[2]=(s.pivot as number[])[2]+.06;
 return {...d,version:2,tags:[...(d.tags??[]),'hand-operated','hand-cabinet'],description:locker?'Three steel lockers with a physically operated first door and a visible empty compartment. The other two doors remain fixed.':'A drinks fridge with a physically operated glass door, hollow interior and decorative bottle stock. Real food/drink retrieval is a separate faculty.',actions:d.actions!.filter(a=>['open','close'].includes(a.name))};
});
