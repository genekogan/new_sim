// Resume from the committed journal cursor, not an in-memory read position.
// One connection is retained between pages. No token, header or URL is logged.
export function createEventReader({open,validateHello}){
 let reader=null,buffer='',decoder=new TextDecoder(),expected=null,adopted=false;
 const close=()=>{const old=reader;reader=null;buffer='';decoder=new TextDecoder();adopted=false;try{void old?.cancel().catch(()=>{});}catch{}};
 return async function page({after,signal,onReady}){
  if(reader&&after!==expected)await close();
  try{
   if(!reader){const response=await open(after,signal);reader=response.body.getReader();expected=after;}
   for(;;){
    if(signal?.aborted)throw Error('Event read aborted');
    let at=buffer.indexOf('\n\n');
    if(at<0){let chunk;try{chunk=await readAbortable(reader,signal);}catch{throw Object.assign(Error('Event stream interrupted'),{transient:!signal?.aborted,streamClosed:true});}if(chunk.done)throw Object.assign(Error('Event stream ended'),{transient:true,streamClosed:true});buffer=(buffer+decoder.decode(chunk.value,{stream:true})).replace(/\r\n/g,'\n');if(buffer.length>1024*1024)throw Error('Event stream frame exceeded bound');continue;}
    const frame=buffer.slice(0,at);buffer=buffer.slice(at+2);let kind='message',id=null,data=[];
    for(const line of frame.split('\n')){const colon=line.indexOf(':');if(colon<0)continue;const name=line.slice(0,colon),value=line.slice(colon+1).replace(/^ /,'');if(name==='event')kind=value;else if(name==='id')id=value;else if(name==='data')data.push(value);}
    if(!data.length)continue;
    const value=JSON.parse(data.join('\n'));
    if(kind==='hello'){
     // Native SSE admits the authenticated connection before sending hello.
     // Readiness is observation only: no page/cursor or synthetic event added.
     if(validateHello){validateHello(value,{after});adopted=true;if(!signal?.aborted)onReady?.({mode:'stream-adopted',successful:true,at:Date.now()});}
     continue;
    }
    if(validateHello&&!adopted)throw Error('Event stream data preceded validated hello');
    if(kind==='bye')throw Object.assign(Error('Event stream superseded'),{code:'stream.superseded'});
    if(kind==='gap'){expected=value.oldest;return {cursor:expected,events:[],gap:true};}
    if(kind==='cursor'){expected=value.cursor;return {cursor:expected,events:[]};}
    if(!id||value.id!==id)throw Error('Event identity missing or inconsistent');
    expected=id;return {cursor:id,events:[value]};
   }
  }catch(e){await close();throw e;}
 };
}

async function readAbortable(reader,signal){
 if(!signal)return reader.read();
 if(signal.aborted)throw Error('Event read aborted');
 let cancel;const aborted=new Promise((_,reject)=>{cancel=()=>reject(Error('Event read aborted'));signal.addEventListener('abort',cancel,{once:true});});
 try{return await Promise.race([reader.read(),aborted]);}finally{signal.removeEventListener('abort',cancel);}
}
