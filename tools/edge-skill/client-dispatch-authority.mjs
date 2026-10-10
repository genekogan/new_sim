/** Manual commands retain their attended authority. The autonomous live caller
 * checks immediately before every mutating transport, including retries after
 * helper awaits. Already sent requests are never cancelled by this fence. */
export function assertLiveDispatch(live,isPaused,method='POST'){
 if(!live||['GET','HEAD','OPTIONS'].includes(String(method).toUpperCase())||!isPaused())return;
 const error=new Error('An attended session owns the mind; this further mutating request was not sent.');
 error.code='local.attended';error.requestNotSent=true;throw error;
}
export const attendedStepRefusal=()=>({accepted:false,code:'local.attended',reason:'An attended session owns the mind; this request was not sent.',requestNotSent:true,again:false,line:'Not sent: an attended session owns the mind.'});
