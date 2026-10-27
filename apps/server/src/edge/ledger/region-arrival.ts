import {type PlaceIndex,type Place} from './places.ts';

const OUTDOOR = new Set(['walkable','grounds','outdoor','park','garden','plaza','lawn','field','shore']);
/** Physical membership only: semantic districts never alter where a body must go.
 * A native outdoor region's open standing area excludes its enclosed descendants.
 * This leaves broad town/district destinations and ordinary open-region no-ops alone. */
export function outdoorRegionExclusions(places:PlaceIndex,targetId:string):[number,number][][]|undefined {
 const target=places.byId.get(targetId);
 if(!target||target.enclosed||!OUTDOOR.has(target.kind))return undefined;
 const descendant=(p:Place)=>{const seen=new Set<string>();let id=p.parent;while(id&&!seen.has(id)){if(id===targetId)return true;seen.add(id);id=places.byId.get(id)?.parent??null;}return false;};
 const interiors=[...places.byId.values()].filter(p=>p.id!==targetId&&!p.carrier&&p.level===target.level&&(p.enclosed||p.kind==='building'||p.kind==='room')&&descendant(p));
 // Rooms already covered by their building do not duplicate its outline.
 const ids=new Set(interiors.map(p=>p.id));
 return interiors.filter(p=>{let id=p.parent;const seen=new Set<string>();while(id&&id!==targetId&&!seen.has(id)){if(ids.has(id))return false;seen.add(id);id=places.byId.get(id)?.parent??null;}return true;}).map(p=>p.polygon.map(([x,z])=>[x,z]));
}
