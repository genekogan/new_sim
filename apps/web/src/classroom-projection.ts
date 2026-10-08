import {classroomSlide} from './classroom-lesson.ts';
export const classroomWorldId='pm-preview-eden-20261005';
export const classroomScreenEntityId='eden-classroom-screen-1';
/** Local projection only, fenced to the agreed live native screen. */
export function classroomProjection(enabled:boolean,worldId:string|undefined,screenPresent:boolean,live:boolean,index:number,qualifiedWorldId=classroomWorldId){
 if(!enabled||worldId!==qualifiedWorldId||!screenPresent||!live)return undefined;
 const slide=classroomSlide(index);
 return {worldId,screenEntityId:classroomScreenEntityId,imageUrl:slide.imageUrl,index};
}
