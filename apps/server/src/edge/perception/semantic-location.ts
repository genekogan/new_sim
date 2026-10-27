import type {Place} from '../ledger/places.ts';
import {inPoly} from '../ledger/places.ts';
import {placeEdgeDistance} from '../ledger/vocabulary.ts';
/** One compact relation from physical containment and authored hierarchy; no inference of permissions/actions. */
export function whereLine(places:readonly Place[],path:readonly string[],pos:[number,number]|null):string|undefined {
 if(!pos)return undefined;
 const byId=new Map(places.map(p=>[p.id,p])),inside=path.map(id=>byId.get(id)).filter((p):p is Place=>!!p&&p.parent!==null);
 const water=inside.find(p=>p.kind==='water'&&inPoly(pos[0],pos[1],p.polygon));
 const bank=inside.find(p=>p.kind==='shore'),bankWater=bank?.semanticParent?byId.get(bank.semanticParent):undefined;
 const inner=inside.find(p=>p.enclosed)||inside.find(p=>p.kind!=='shore'&&p.semanticRole!=='minor');
 let line=water?`In ${water.name}`:bankWater?`On the bank of ${bankWater.name}`:inner?`${inner.enclosed?'Inside':'At'} ${inner.name}`:undefined;
 if(inner&&!water&&!bankWater){const district=places.find(p=>(p.semanticRole==='district'||p.semanticRole==='quarter')&&inPoly(pos[0],pos[1],p.polygon));if(district&&district.id!==inner.id)line+=`, in ${district.name}`;}
 if(!water&&!bankWater){const near=places.filter(p=>p.kind==='water').map(p=>({p,d:placeEdgeDistance({polygon:p.polygon,center:[0,0]},pos)})).filter(x=>x.d>0&&x.d<=5).sort((a,b)=>a.d-b.d||a.p.id.localeCompare(b.p.id))[0];if(near)line=line?`${line}, beside ${near.p.name}`:`Beside ${near.p.name}`;}
 return line;
}
