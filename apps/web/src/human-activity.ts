const fixed=new Map<string,string>([
 ['sit at a social seat','Sit at a social seat'],
 ['leave social seat','Leave the seat'],
 ['warm by the eden fire','Warm by the campfire'],
]);
/** Presentation only: never use label as a request/card/target identifier. */
export function humanActivity(raw:string,soulId?:string):{raw:string;label:string}{
 let label=fixed.get(raw)??raw;
 if(soulId&&/^s_[a-f0-9]{10}$/.test(soulId)){
  const suffix=soulId.slice(2);
  if(raw===`sleep on ground mat ${suffix}`)label='Sleep on a mat';
  else if(raw===`eat prepared meal ${suffix}`)label='Eat a prepared meal';
  else if([1,2,3,4].some(batch=>raw===`eat delivered meal ${batch} ${suffix}`))label='Eat a prepared meal';
  else if([0,1,2,3,4].some(batch=>raw===`dine with meal ${batch} ${suffix}`))label='Eat at a dining chair';
 }
 return {raw,label};
}
