const bodyUnconfirmed=queue=>queue.steps.some(s=>s.status==='completed'&&!s.publicStep&&(!s.receiptId||s.receipt?.id!==s.receiptId||!['completed','replaced'].includes(s.receipt?.phase)));
/** Final owner reporting uses only completed queue/receipt and fresh public here
 * facts. The initial model acknowledgement remains labelled historical. */
export function completedOwnerResult(initial,queue,{here=null,at=new Date().toISOString()}={}){
 if(!queue.steps?.length||queue.steps.some(s=>!['completed','skipped'].includes(s.status)))throw Error('queue is not actually complete');
 if(bodyUnconfirmed(queue))throw Error('canonical body receipt is unconfirmed or unfinished');
 if(initial.id&&queue.id&&initial.id!==queue.id)throw Error('owner completion request differs from queue');
 const bodies=queue.steps.filter(s=>s.receiptId&&s.receipt&&s.receipt.channel!=='attention'&&s.receipt.channel!=='none'),last=bodies.at(-1);
 const observed=here?.me?{tick:here.tick??null,place:here.me.place??null,placePath:here.me.placePath??[],posture:here.me.posture??null,activity:here.me.activity?.kind??null,pos:here.me.pos??null}:null;
 const states=queue.steps.map(s=>s.status==='skipped'?`${s.act}: skipped${s.reason?' ('+s.reason+')':''}`:`${s.act}: step finished${s.receipt?.phase?' (native '+s.receipt.phase+')':''}`).join(' → '),body=observed?`Observed body: ${observed.posture??'posture unknown'}${observed.activity?' ('+observed.activity+')':''}${observed.place?' at '+observed.place:''}.`:'Current body observation unavailable.';
 const history=queue.repairs??[];
 const repairs=history.map(r=>{const replacement=queue.steps.find(s=>s.id===r.replacementStepId)??history.find(next=>next.failedStep.id===r.replacementStepId)?.failedStep;return {failedStepId:r.failedStep.id,attempt:r.failedStep.act,failedParams:structuredClone(r.failedStep.params??{}),code:r.failedStep.code,reason:r.failedStep.reason,replacementStepId:r.replacementStepId,receiptId:replacement?.receiptId??null,replacement:replacement?{act:replacement.act,params:structuredClone(replacement.params??{}),status:replacement.status,capability:replacement.receipt?.capability??null,phase:replacement.receipt?.phase??null,summary:replacement.receipt?.outcome?.summary??null}:null};});
 const bodyEvidence=bodies.map(s=>{const r=s.receipt,o=r.outcome;return {receiptId:r.id,capability:r.capability,phase:r.phase,endedAt:r.endedAt??null,summary:o?.summary??null,learned:(o?.learned??[]).map(f=>({fact:f.fact,source:f.source,provenance:f.provenance,untrusted:f.untrusted===true})),...(o?.detail?.book?{book:structuredClone(o.detail.book),passage:o.detail.passage??null,contentVersion:o.detail.contentVersion??null}:{} )};});
 const results=queue.steps.map(s=>{const r=s.receipt;if(!r)return s.result?.line??`${s.act}: ${s.status}`;const learned=(r.outcome?.learned??[]).map(f=>`${f.fact} [source ${f.source}; ${f.provenance}${f.untrusted?'; untrusted':''}]`);return [r.outcome?.summary??`${r.capability??s.act}: ${r.phase}`,...(r.endedAt?.place?[`Canonical end: ${r.endedAt.place}${r.endedAt.placePath?.length?' ('+r.endedAt.placePath.join(' < ')+')':''}.`]:[]),...learned].join(' ');});
 const repairText=repairs.length?` Preserved ${repairs.length} refused attempt${repairs.length===1?'':'s'}: ${repairs.map(r=>`${r.attempt} (${r.code})`).join('; ')}.`:'';
 const repairResults=repairs.length?` Repair results: ${repairs.map(r=>`${r.attempt} ${JSON.stringify(r.failedParams)} → ${r.replacement?`${r.replacement.act} ${JSON.stringify(r.replacement.params)}: ${r.replacement.status}${r.replacement.phase?' (native '+r.replacement.phase+')':''}`:'replacement evidence unavailable'}`).join('; ')}. The original owner intent is unproven by repaired queue completion; it requires a separate semantic judgment against the original request.`:'';
 const prefix=repairs.length?'Repaired queue execution complete:':'Finished';
 return {...initial,t:at,initialAnswer:initial.initialAnswer??{text:initial.answer??null,at:initial.t},answerSource:'queue-and-receipt-evidence',answer:`${prefix} ${queue.steps.length} ordered steps: ${states}. ${body}${repairText}${repairResults} ${results.join(' → ')}`,results,bodyEvidence,receipt:last?.receiptId??null,finalReceipt:last?.receipt??null,finalObservation:observed,queueComplete:true,...(repairs.length?{ownerIntentFulfillment:{status:'unproven',basis:'Canonical receipts prove repaired execution; fulfilling the original request is a separate semantic judgment.'}}:{}),repairs,queue};
}

/** The ordinary live reconciliation seam. A final canonical result is appended
 * once to the original owner request, without another model decision. */
export async function publishCompletedOwnerQueue(queue,{readReplies,observe=async()=>null,publish,at=()=>new Date().toISOString()}={}){
 if(queue.source!=='owner'||!queue.steps?.length||queue.steps.some(s=>!['completed','skipped'].includes(s.status))||bodyUnconfirmed(queue))return null;
 const latest=()=>readReplies().filter(r=>r.id===queue.id).at(-1),initial=latest();if(!initial||initial.queueComplete)return null;
 const here=await observe().catch(()=>null),current=latest();if(!current||current.queueComplete)return null;
 const final=completedOwnerResult(current,queue,{here,at:at()});publish(final);return final;
}
