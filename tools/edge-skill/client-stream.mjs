/** SSE frames, not raw byte trickles, prove transport liveness. No model or logging. */
export async function readClientStream(url,{fetcher=fetch,headers={},signal,onMessage=()=>{},onFrame=()=>{},helloMs=5000,frameMs=35000,maxFrameBytes=262144}={}){
 const controller=new AbortController();let reader,hello=false,lastFrameAt=null,reason=null,buffer='',frameTimer;
 const stop=why=>{reason??=why;controller.abort();void reader?.cancel().catch(()=>{});};
 const external=()=>stop('aborted');signal?.addEventListener('abort',external,{once:true});if(signal?.aborted)external();
 const helloTimer=setTimeout(()=>stop('hello-timeout'),helloMs);
 const framed=()=>{lastFrameAt=Date.now();clearTimeout(frameTimer);frameTimer=setTimeout(()=>stop('frame-timeout'),frameMs);onFrame({hello,lastFrameAt});};
 try{
  const response=await fetcher(url,{headers,signal:controller.signal});
  if(response.status!==200||!response.body)return {status:response.status,reason:'unavailable',hello,lastFrameAt};
  reader=response.body.getReader();if(controller.signal.aborted)return {status:0,reason:reason??'aborted',hello,lastFrameAt};const decoder=new TextDecoder();
  for(;;){
   const result=await reader.read();if(result.done)break;
   buffer=(buffer+decoder.decode(result.value,{stream:true})).replace(/\r\n/g,'\n');
   if(Buffer.byteLength(buffer)>maxFrameBytes){stop('frame-too-large');break;}
   let cut;
   while((cut=buffer.indexOf('\n\n'))>=0){
    const block=buffer.slice(0,cut);buffer=buffer.slice(cut+2);const item={event:'message',data:''};
    for(const line of block.split('\n')){if(!line||line.startsWith(':'))continue;const i=line.indexOf(':'),key=i<0?line:line.slice(0,i),value=i<0?'':line.slice(i+1).replace(/^ /,'');if(key==='data')item.data+=(item.data?'\n':'')+value;else if(key==='event')item.event=value;else if(key==='id')item.id=value;}
    if(item.event==='hello'){hello=true;clearTimeout(helloTimer);}
    framed();if(item.data||item.id||item.event==='hello'){let data=null;try{data=item.data?JSON.parse(item.data):null;}catch{stop('invalid-frame');break;}onMessage({...item,data});}
   }
  }
  return {status:200,reason:reason??'ended',hello,lastFrameAt};
 }catch(error){return {status:0,reason:reason??'transport-error',hello,lastFrameAt,error:String(error?.message??error)};}
 finally{clearTimeout(helloTimer);clearTimeout(frameTimer);signal?.removeEventListener('abort',external);try{await reader?.cancel();}catch{}reader?.releaseLock();}
}
