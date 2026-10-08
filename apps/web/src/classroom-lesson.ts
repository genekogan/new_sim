/** App-owned local screen content. It never records participation or world state. */
export const classroomLesson = [
 {title:'A world with a memory',lines:['Watch a Soul. Notice what they do.', 'Give them a small direction.', 'Return to see what changed.']},
 {title:'Give one direction',lines:['Choose your own Soul.', 'Ask for one thing in plain language.', 'Keep the request reference.']},
 {title:'Watch what changes',lines:['Received means saved.', 'Understood means interpreted.', 'An action is not the whole purpose.']},
] as const;
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
export function classroomSlide(index:number){
 if(!Number.isInteger(index)||index<0||index>=classroomLesson.length)throw new RangeError('Unknown lesson slide');
 const slide=classroomLesson[index];
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><rect width="1200" height="675" fill="#101e28"/><rect x="70" y="75" width="10" height="66" rx="5" fill="#b0dec4"/><text x="110" y="128" fill="#f5f7f2" font-family="Arial,sans-serif" font-size="54" font-weight="700">${escape(slide.title)}</text>${slide.lines.map((line,i)=>`<text x="110" y="${270+i*96}" fill="#e1ebe6" font-family="Arial,sans-serif" font-size="40">${escape(line)}</text>`).join('')}<text x="110" y="600" fill="#a8bab6" font-family="Arial,sans-serif" font-size="24">EDEN · LOCAL LESSON · ${index+1} / ${classroomLesson.length}</text></svg>`;
 return {index,title:slide.title,svg,imageUrl:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)};
}
