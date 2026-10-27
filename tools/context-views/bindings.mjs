// Resolve only published stable references. Never construct a room id from a floor name.
export function bindCases(cases,entities,targets){
 return cases.map(c=>{
  const entity=entities.find(e=>e.name===c.target.split('/').at(-1));
  if(!entity)throw Error('missing fixture entity '+c.target);
  let target=targets.find(t=>t.ref===entity.id);
  if(c.id==='enclosed-room'){
   const rooms=targets.filter(t=>t.entity===entity.id&&t.ref.startsWith(entity.id+'/slot/')&&t.enclosed);
   if(rooms.length!==1)throw Error('fixture must publish exactly one enclosed room, got '+rooms.length);
   target=rooms[0];
  }
  if(!target)throw Error('missing published target '+c.target);
  return{id:c.id,target:c.target,entity:entity.id,ref:target.ref,...(target.slot?{slot:target.slot}:{}),title:target.title,point:target.point};
 });
}
