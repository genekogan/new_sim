const ID=/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/;
/** 1.9.8: far above any real world (eden-2026 has 1,505 places; 1.9.7 refused >1000, so a mind there died at boot with
 *  "invalid place hierarchy"). The duplicate, cycle and ID guards stay; callers skip arrivals on any refusal. */
export const PLACE_LIMIT=100_000;
/** Canonical public catalogue links only. Labels and requested targets are never links. */
export function placeHierarchy(places){
 if(!Array.isArray(places)||places.length>PLACE_LIMIT)throw Error('invalid place hierarchy');
 const rows={};for(const p of places){if(!p||!ID.test(p.id)||Object.hasOwn(rows,p.id)||p.parent!==undefined&&p.parent!==null&&!ID.test(p.parent))throw Error('invalid place hierarchy');rows[p.id]=p.parent??null;}
 for(const id of Object.keys(rows))currentPlaceAncestors(id,rows);
 return rows;
}
/** Applicable to a CURRENT here observation with the selected catalogue.
 * Historical receipts use their recorded firstVisit ID instead of current links. */
export function currentPlaceAncestors(place,rows={}){
 if(typeof place!=='string'||!ID.test(place))return [];
 const result=[],seen=new Set();let id=place;
 while(id!==null&&id!==undefined){if(!ID.test(id)||seen.has(id)||result.length>=PLACE_LIMIT)throw Error('invalid place hierarchy');seen.add(id);result.push(id);if(!Object.hasOwn(rows,id))break;id=rows[id];}
 return result;
}
export function recordedVisitParent(receipt){
 if(receipt?.phase!=='completed')return null;
 const visit=receipt.outcome?.detail?.firstVisit;
 const end=receipt.endedAt;
 return end&&typeof end.place==='string'&&visit&&typeof visit.placeId==='string'&&ID.test(visit.placeId)&&Number.isSafeInteger(visit.tick)&&visit.tick===receipt.endedTick&&Array.isArray(visit.pos)&&visit.pos.length===2&&visit.pos.every(Number.isFinite)&&Array.isArray(end.pos)&&end.pos.length===2&&end.pos.every(Number.isFinite)&&visit.pos.every((n,i)=>Math.abs(n-end.pos[i])<=1e-6)&&typeof visit.source==='string'&&visit.source.length>0?visit.placeId:null;
}
