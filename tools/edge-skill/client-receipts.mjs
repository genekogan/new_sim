const TERMINAL=new Set(['completed','failed','replaced']);
const PHASES=new Set(['waiting','started',...TERMINAL]);
/** Process-local canonical receipt reads, scoped to one world/Soul. Event
 * payloads only invalidate; they never supply a receipt/outcome. The owned
 * read-only backup timer continues while the mind awaits a provider reply. */
export function openClientReceipts({scope,soulId,read,now=()=>performance.now(),reuseMs=6000,maxEntries=256}={}){
 if(typeof scope!=='string'||!scope||typeof read!=='function'||!(reuseMs>0&&reuseMs<=6000))throw Error('receipt reader requires bounded scope/read');
 const entries=new Map();let timer=null,closed=false;
 const entry=id=>{if(closed)throw Error('receipt reader closed');if(typeof id!=='string'||!id||id.length>160)throw Error('invalid receipt ID');if(!entries.has(id)){if(entries.size>=maxEntries){const old=[...entries].find(([,e])=>TERMINAL.has(e.value?.phase)&&!e.pending);if(!old)throw Error('receipt reader active limit');entries.delete(old[0]);}entries.set(id,{generation:0,valueGeneration:null,value:null,at:null,pending:null});}return entries.get(id);};
 async function get(id,requestScope=scope){
  if(requestScope!==scope)throw Error('receipt reader scope mismatch');const e=entry(id);
  for(;;){
   if(TERMINAL.has(e.value?.phase))return structuredClone(e.value);
   if(e.pending){await e.pending;continue;}
   if(e.value&&e.valueGeneration===e.generation&&now()-e.at>=0&&now()-e.at<reuseMs)return structuredClone(e.value);
   const generation=e.generation;
   e.pending=(async()=>{const value=await read(id);if(!value||value.id!==id||!PHASES.has(value.phase)||(soulId&&value.soulId&&value.soulId!==soulId))throw Error('invalid canonical receipt');if(generation===e.generation&&!closed){e.value=structuredClone(value);e.valueGeneration=generation;e.at=now();}})();
   try{await e.pending;}finally{e.pending=null;}
   if(closed)throw Error('receipt reader closed');
  }
 }
 const invalidate=id=>{const e=entry(id);if(!TERMINAL.has(e.value?.phase))e.generation++;};
 async function poll(){if(closed)return;await Promise.allSettled([...entries].filter(([,e])=>!TERMINAL.has(e.value?.phase)&&(e.at===null||now()-e.at>=reuseMs)).map(([id])=>get(id)));}
 return {
  read:get,track:id=>{entry(id);},
  hint(id){invalidate(id);return get(id);},
  invalidateNonterminal(){for(const [id,e]of entries)if(!TERMINAL.has(e.value?.phase))invalidate(id);},
  poll,
  start(){if(!closed&&!timer){timer=setInterval(()=>{void poll();},1000);timer.unref?.();}},
  close(){closed=true;if(timer)clearInterval(timer);timer=null;entries.clear();},
 };
}
