import {classroomLesson} from './classroom-lesson.ts';
/** Only mount for a World-provided screen in the matching live world.
 * onSelect changes local screen content; it is not a canonical Soul command. */
export function ClassroomPresentation({worldId,screenEntityId,index,onSelect}:{worldId:string;screenEntityId:string;index:number;onSelect(index:number):void}){
 if(!worldId||!screenEntityId||!Number.isInteger(index)||index<0||index>=classroomLesson.length)return null;
 return <section className="playing-help" aria-label="Classroom lesson">
  <b>{classroomLesson[index].title}</b><p className="small">Local lesson · {index+1} of {classroomLesson.length}. Slides change only in your view.</p>
  <button type="button" disabled={index===0} onClick={()=>onSelect(index-1)}>Previous slide</button>{' '}
  <button type="button" disabled={index===classroomLesson.length-1} onClick={()=>onSelect(index+1)}>Next slide</button>
  <p className="small dim">Local screen content. Attendance and presenting are separate world activities.</p>
 </section>;
}
