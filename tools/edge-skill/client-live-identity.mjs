import {resolveSoulReferences} from './client-soul-references.mjs';
/** Identity-only evidence already entitled to this live Soul. Conversation
 * participants establish identity, never current proximity or consent. No
 * full capability catalogue, receipt history, directory or private state read. */
export function openLiveSoulEvidence({worldId,scope,call,here,conversations,now=Date.now}){
 let refreshedAt=null,extraRows=[];
 const refreshDue=()=>refreshedAt===null||now()-refreshedAt>5000;
 function rosters(){
  const snapshot=conversations();
  if(snapshot.scope!==scope)throw Error('identity conversation scope mismatch');
  const participants=snapshot.groups.filter(g=>g.attached&&g.state==='open'&&['member','invited','asked'].includes(g.role)).flatMap(g=>[...g.members,...g.invited]);
  return [
   {worldId,kind:'perceived',rows:(here()?.near??[]).map(p=>({id:p.id,name:p.name,...(p.nameAmbiguous===true?{nameAmbiguous:true}:{})}))},
   {worldId,kind:'conversation-participants',rows:participants},
   {worldId,kind:'perceived',rows:refreshedAt!==null&&now()-refreshedAt<=5000?extraRows:[]},
  ];
 }
 return {
  resolve:values=>resolveSoulReferences(values,{worldId,rosters:rosters()}),refreshDue,
  async refresh(){
   refreshedAt=now();extraRows=[];
   const response=await call('/v1/edge/here');
   if(response.status!==200)throw Error('identity here unavailable: '+response.status);
   const frame=response.data?.here??response.data;
   if(!Array.isArray(frame?.near))throw Error('identity here roster unavailable');
   extraRows=frame.near.map(p=>({id:p.id,name:p.name,...(p.nameAmbiguous===true?{nameAmbiguous:true}:{})}));
  },
 };
}
