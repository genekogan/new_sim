/** Final owner reporting uses only completed queue/receipt and fresh public here
 * facts. The initial model acknowledgement remains labelled historical. */
export function completedOwnerResult(initial,queue,{here=null,at=new Date().toISOString()}={}){
 if(!queue.steps?.length||queue.steps.some(s=>!['completed','skipped'].includes(s.status)))throw Error('queue is not actually complete');
 const bodies=queue.steps.filter(s=>s.receiptId&&s.receipt&&s.receipt.channel!=='attention'&&s.receipt.channel!=='none'),last=bodies.at(-1);
 const observed=here?.me?{tick:here.tick??null,place:here.me.place??null,placePath:here.me.placePath??[],posture:here.me.posture??null,activity:here.me.activity?.kind??null,pos:here.me.pos??null}:null;
 const states=queue.steps.map(s=>s.status==='skipped'?`${s.act}: skipped${s.reason?' ('+s.reason+')':''}`:`${s.act}: step finished${s.receipt?.phase?' (native '+s.receipt.phase+')':''}`).join(' → '),body=observed?`Observed body: ${observed.posture??'posture unknown'}${observed.activity?' ('+observed.activity+')':''}${observed.place?' at '+observed.place:''}.`:'Current body observation unavailable.';
 return {...initial,t:at,initialAnswer:initial.initialAnswer??{text:initial.answer??null,at:initial.t},answerSource:'queue-and-receipt-evidence',answer:`Finished ${queue.steps.length} ordered steps: ${states}. ${body}`,results:queue.steps.map(s=>s.result?.line??`${s.receipt?.capability??s.act}: ${s.receipt?.phase??s.status}`),receipt:last?.receiptId??null,finalReceipt:last?.receipt??null,finalObservation:observed,queueComplete:true,queue};
}
