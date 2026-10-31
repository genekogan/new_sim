import {createInterface} from 'node:readline';
let current=null,n=0;
const send=v=>process.stdout.write(JSON.stringify(v)+'\n');
const response=(id,result)=>send({id,result});
for await(const line of createInterface({input:process.stdin})){
 const m=JSON.parse(line),p=m.params??{};
 if(m.method==='initialize')response(m.id,{});
 if(m.method==='model/list')response(m.id,{data:[{model:'synthetic-model',isDefault:true}]});
 if(m.method==='thread/start'||m.method==='thread/resume')response(m.id,{thread:{id:p.threadId??'thread-fixture'}});
 if(m.method==='turn/start'){
  current='turn-'+(++n);const id=current;
  send({method:'turn/started',params:{threadId:'thread-fixture',turn:{id,status:'inProgress'}}});
  const text=p.input[0].text;
  if(text==='exit'){process.exit(2)}
  if(text==='timeout')continue;
  if(text==='complete-before-ack'){
   send({method:'item/completed',params:{threadId:'thread-fixture',turnId:id,item:{type:'agentMessage',text:'finished'}}});
   send({method:'turn/completed',params:{threadId:'thread-fixture',turn:{id,status:'completed'}}});current=null;
  }
  response(m.id,{turn:{id,status:'inProgress'}});
 }
 if(m.method==='turn/steer'){
  if(current!==p.expectedTurnId)send({id:m.id,error:{code:-32600,message:'active turn mismatch'}});
  else response(m.id,{turnId:current});
 }
 if(m.method==='turn/interrupt'){
  response(m.id,{});send({method:'turn/completed',params:{threadId:'thread-fixture',turn:{id:current,status:'interrupted'}}});current=null;
 }
}
