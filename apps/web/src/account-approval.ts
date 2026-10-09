export type AccountApproval={id:string;worldId:string;agentLabel:string;name:string;description:string;mode:'create'|'repair';status:'pending'|'creating'|'ready'|'refused'|'cancelled'|'expired';soulId:string|null;expiresAt:number};
export function approvalFromHash(hash:string){return /^#approve\/(ap_[a-f0-9]{32})$/.exec(hash)?.[1]??null;}
export function accountApproval(value:unknown,id:string,worldId:string):AccountApproval|null{
 const a=(value as {approval?:AccountApproval}|null)?.approval;if(!a||a.id!==id||a.worldId!==worldId||!['create','repair'].includes(a.mode)||!['pending','creating','ready','refused','cancelled','expired'].includes(a.status)||typeof a.name!=='string'||a.name.length>32||typeof a.description!=='string'||a.description.length>1200||typeof a.agentLabel!=='string'||a.agentLabel.length>120||!Number.isSafeInteger(a.expiresAt)||a.soulId!==null&&!/^s_[A-Za-z0-9_-]+$/.test(a.soulId)||a.status==='ready'&&!a.soulId)return null;return a;
}
