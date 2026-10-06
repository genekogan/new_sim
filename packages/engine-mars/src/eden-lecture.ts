import {hashOf,edenLecturePlacementV1Schema,type EdenLecturePlacementV1} from '@sim/engine-contract';
import {CATALOG} from '../../../mars/viewer/engine/world/catalog.ts';
import {add2,rot2,wrapAngle} from '../../../mars/viewer/engine/core/math.ts';
import type {Entity,Region} from '../../../mars/viewer/engine/world/types.ts';
/** Seeded additive venue descriptors; installation/admission belongs to the
 * native checkpoint, never this geometry generator or a renderer. */
export function edenLectureV1(raw:EdenLecturePlacementV1){
 const p=edenLecturePlacementV1Schema.parse(raw),entities:Record<string,Entity>={},regions:Record<string,Region>={},point=(v:[number,number])=>add2(p.origin,rot2(v,p.yaw)),provenance={origin:'design-edit' as const,confidence:'hypothetical' as const,note:'Gene commissioned seeded Eden lecture venue; exact native catalogue slots, not constructed history'};
 const fixture=(id:string,def:string,local:[number,number],yaw:number,label:string)=>{const q=point(local);if(!CATALOG[def])throw Error('eden-lecture.unknown-def');entities[id]={id,def,kind:'fixture',label,pose:{p:[q[0],0,q[1]],yaw:wrapAngle(p.yaw+yaw)},support:{kind:'ground'},provenance};};
 const seats:string[]=[];for(let i=0;i<p.audienceSeats;i++){const id=p.id+'-chair-'+String(i+1).padStart(2,'0');fixture(id,'camp-chair',[[-5,-2.8,2.8,5][i%4],-1+Math.floor(i/4)*2.2],Math.PI,'Lecture seat '+(i+1));seats.push(id+'#seat');}
 const returnSeat=p.id+'-presenter-chair';fixture(returnSeat,'camp-chair',[6,-6],Math.PI,'Presenter return seat');
 const lectern=p.id+'-lectern',display=p.id+'-screen';fixture(lectern,'speaker-lectern',[0,-6.3],0,'Lecture lectern');fixture(display,'standing-display',[0,-9],0,'Lesson screen');entities[display].equipment={kind:'display',config:{available:true,mode:'on',content:p.lesson}};
 const polygon:[number,number][]=[[-9,-13],[9,-13],[9,13],[-9,13]].map(v=>point(v as [number,number]));regions[p.id]={id:p.id,kind:'place',label:'Eden lecture venue',level:0,polygon,provenance};
 return {contract:'eden-lecture-placement/1' as const,placement:p,entities,regions,audienceSeats:seats,presenterReturnSeat:returnSeat+'#seat',presenterStation:lectern+'#presenter',displayId:display,entrance:point([0,12]),sideAisles:[point([-7.4,0]),point([7.4,0])],footprint:polygon,layoutHash:hashOf({p,entities,regions})};
}
