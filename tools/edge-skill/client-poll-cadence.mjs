/** Receipt backup independently checks canonical phases. Stable native work
 * needs no two-second empty event wait; conditions/dispatch still get a bound. */
export function queuePollDeadlineMs(steps=[]){
 const active=steps.find(s=>!['completed','cancelled','skipped','superseded'].includes(s.status));
 return active&&(active.until||['pending','dispatching','stopping','waiting-condition'].includes(active.status))?8000:20000;
}
